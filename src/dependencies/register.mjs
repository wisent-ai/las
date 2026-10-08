// What each Wisent product needs from another one, and what a machine
// without that other product gets: the register in `register.json`, read
// and queried here, and its evidence checked against the source it cites.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src/dependencies -> las/src -> las -> the Wisent workspace root shared
// by every sibling product repository.
const WORKSPACE = path.resolve(HERE, "..", "..", "..");

/** Another process is changing the register right now. */
export class RegisterBusy extends Error {}

function invalid(index, reason) {
	return new Error(`dependency register entry ${index}: ${reason}`);
}

function text(entry, index, field) {
	if (typeof entry[field] !== "string" || !entry[field].trim())
		throw invalid(index, `${field} must be a non-empty string`);
}

function validated(document) {
	if (!Array.isArray(document.dependencies))
		throw new Error("dependency register has no dependencies list");
	const outcomes = Object.keys(document.outcomes ?? {});
	document.dependencies.forEach((entry, index) => {
		text(entry, index, "product");
		text(entry, index, "requires");
		text(entry, index, "feature");
		text(entry, index, "how");
		text(entry, index, "detail");
		if (!outcomes.includes(entry.whenAbsent))
			throw invalid(
				index,
				`whenAbsent must be one of the register's outcomes: ${outcomes.join(", ")}`,
			);
		if (entry.whenAbsent === "alternative") text(entry, index, "alternative");
		if (!Array.isArray(entry.evidence) || !entry.evidence.length)
			throw invalid(index, "evidence must cite at least one source line");
		entry.evidence = entry.evidence.map((cited) => {
			// `at` is `<repository>/<file>:<line>`, the way the source is cited
			// everywhere else; it is split once here for the readers below.
			const located = /^([^/]+)\/(.+):([1-9]\d*)$/.exec(cited.at ?? "");
			if (!located || !cited.contains)
				throw invalid(
					index,
					"each evidence item needs at (<repository>/<file>:<line>) and contains",
				);
			return {
				...cited,
				repository: located[1],
				file: located[2],
				line: Number(located[3]),
			};
		});
	});
	return document;
}

/** The register, validated. */
export function dependencyRegister() {
	return validated(
		JSON.parse(fs.readFileSync(path.join(HERE, "register.json"), "utf8")),
	);
}

/** Every product the register names, on either side. */
export function registeredProducts(register) {
	return [
		...new Set(
			register.dependencies.flatMap((entry) => [entry.product, entry.requires]),
		),
	].sort();
}

/**
 * The entries a query selects: `products` the dependent products (all when
 * empty), `requires` one required product or null, `without` the products
 * this machine does not have — only entries that need one of them.
 */
export function selectDependencies(register, query) {
	const known = new Set(registeredProducts(register));
	const named = [
		...query.products,
		...(query.requires ? [query.requires] : []),
		...query.without,
	];
	for (const name of named) {
		if (!known.has(name))
			throw new Error(
				`no product '${name}' in the dependency register; known: ${[...known].join(", ")}`,
			);
	}
	return register.dependencies.filter(
		(entry) =>
			(!query.products.length || query.products.includes(entry.product)) &&
			(!query.requires || entry.requires === query.requires) &&
			(!query.without.length || query.without.includes(entry.requires)),
	);
}

/**
 * One cited line read again: whether the file still says what the register
 * quotes. A quote no longer at its line but on exactly one other line of the
 * same file still holds — the code says the same thing, only lower or higher
 * — and is answered with `movedTo`, the line it is on now, so readers and
 * `--move-lines` use that line. A quote that changed, vanished or now stands
 * on several lines does not hold: only a person reading the code can say
 * whether the dependency still behaves as recorded.
 */
function verify(cited) {
	const file = path.join(WORKSPACE, cited.repository, cited.file);
	let lines;
	try {
		lines = fs.readFileSync(file, "utf8").split("\n");
	} catch (error) {
		return {
			...cited,
			ok: false,
			observed: `the file cannot be read: ${error.message}`,
		};
	}
	const observed = lines[cited.line - 1];
	if (observed !== undefined && observed.includes(cited.contains))
		return { ...cited, ok: true };
	const found = lines.flatMap((line, index) =>
		line.includes(cited.contains) ? [index + 1] : [],
	);
	if (found.length === 1)
		return {
			...cited,
			ok: true,
			movedTo: found[0],
			observed: `the quote moved to line ${found[0]}`,
		};
	const where = found.length
		? `the quote is on ${found.length} lines (${found.join(", ")})`
		: "the quote is nowhere in the file";
	if (observed === undefined)
		return {
			...cited,
			ok: false,
			observed: `the file has only ${lines.length} lines; ${where}`,
		};
	return {
		...cited,
		ok: false,
		observed: `the line reads ${JSON.stringify(observed.trim())}; ${where}`,
	};
}

/**
 * Every cited line checked; `ok` is false when any quote changed. Quotes that
 * only moved hold and are listed under `moved` with the line they are on now.
 */
export function checkDependencyEvidence(register) {
	const stale = [];
	const moved = [];
	let checked = 0;
	for (const entry of register.dependencies) {
		for (const cited of entry.evidence) {
			checked += 1;
			const result = verify(cited);
			const located = {
				product: entry.product,
				requires: entry.requires,
				feature: entry.feature,
				...result,
			};
			if (!result.ok) stale.push(located);
			else if (result.movedTo) moved.push(located);
		}
	}
	return { ok: stale.length === 0, workspace: WORKSPACE, checked, stale, moved };
}

/**
 * Rewrite the line of every citation whose quote moved to exactly one other
 * line of its file, and answer what was moved and what still needs a person
 * to read the code again. The quote, the entry and its outcome are never
 * changed: a changed quote means the behaviour may have changed.
 */
export function moveDependencyLines() {
	return changeRegister((document) => {
		const register = validated(JSON.parse(JSON.stringify(document)));
		const moved = [];
		const remaining = [];
		register.dependencies.forEach((entry, entryIndex) => {
			entry.evidence.forEach((cited, citedIndex) => {
				const result = verify(cited);
				if (result.movedTo) {
					const at = `${cited.repository}/${cited.file}:${result.movedTo}`;
					document.dependencies[entryIndex].evidence[citedIndex].at = at;
					moved.push({
						from: `${cited.repository}/${cited.file}:${cited.line}`,
						to: at,
						contains: cited.contains,
					});
				} else if (!result.ok) {
					remaining.push({
						product: entry.product,
						requires: entry.requires,
						feature: entry.feature,
						...result,
					});
				}
			});
		});
		return { write: moved.length > 0, answer: { moved, remaining } };
	});
}

/**
 * Record one entry: the entry with the same product, required product and
 * feature is replaced, otherwise the entry is added. It is written only when
 * it is valid and every citation it carries says what it quotes now, so the
 * register never holds a claim its own check would refuse. Answers whether
 * it replaced or added, or the citations that refused it.
 */
export function recordDependency(entry) {
	return changeRegister((document) => {
		const position = document.dependencies.findIndex(
			(existing) =>
				existing.product === entry.product &&
				existing.requires === entry.requires &&
				existing.feature === entry.feature,
		);
		if (position >= 0) document.dependencies[position] = entry;
		else document.dependencies.push(entry);
		const checked = validated(JSON.parse(JSON.stringify(document)));
		const recorded =
			checked.dependencies[
				position >= 0 ? position : checked.dependencies.length - 1
			];
		// A citation recorded now must name the line its quote is on.
		const refused = recorded.evidence
			.map(verify)
			.filter((cited) => !cited.ok || cited.movedTo);
		if (refused.length)
			return { write: false, answer: { recorded: false, refused } };
		return { write: true, answer: { recorded: true, replaced: position >= 0 } };
	});
}

/**
 * Drop the entry with this product, required product and feature: the way an
 * entry leaves when the dependency it describes is gone or another entry now
 * says it. Answers whether such an entry existed; nothing else is touched.
 */
export function removeDependency({ product, requires, feature }) {
	return changeRegister((document) => {
		const position = document.dependencies.findIndex(
			(existing) =>
				existing.product === product &&
				existing.requires === requires &&
				existing.feature === feature,
		);
		if (position < 0) return { write: false, answer: { removed: false } };
		document.dependencies.splice(position, 1);
		validated(JSON.parse(JSON.stringify(document)));
		return { write: true, answer: { removed: true } };
	});
}

/**
 * Read, change and write the register as one step no other writer can
 * interleave with. Two `dependencies set` runs that each read the file and
 * wrote their own copy back used to keep only the last one's entry; now the
 * second finds the first's lock and is refused with the holder's pid instead
 * of overwriting it. A lock whose process has exited is taken over, since
 * nothing can release it any more. The new document replaces the old one by
 * rename, so a reader never sees half a file.
 */
function changeRegister(change) {
	const file = path.join(HERE, "register.json");
	const lock = `${file}.lock`;
	const held = takeLock(lock);
	try {
		const document = JSON.parse(fs.readFileSync(file, "utf8"));
		const { write, answer } = change(document);
		if (write) {
			const next = `${file}.${process.pid}.next`;
			fs.writeFileSync(next, JSON.stringify(document, null, 2) + "\n");
			fs.renameSync(next, file);
		}
		return answer;
	} finally {
		fs.closeSync(held);
		fs.rmSync(lock, { force: true });
	}
}

function takeLock(lock) {
	try {
		const held = fs.openSync(lock, "wx");
		fs.writeSync(held, `${process.pid}\n`);
		return held;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const holder = Number.parseInt(fs.readFileSync(lock, "utf8"), 10);
	if (Number.isInteger(holder) && processRuns(holder)) {
		throw new RegisterBusy(
			`the dependency register is being changed by process ${holder} (${lock}); run this change after it ends`,
		);
	}
	fs.rmSync(lock, { force: true });
	const held = fs.openSync(lock, "wx");
	fs.writeSync(held, `${process.pid}\n`);
	return held;
}

function processRuns(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/** What the GUI shows: the register narrowed to the products this machine
 * does not have (all entries when none), every product it names, and the
 * evidence check, so a stale entry is visible beside it. */
export function dependenciesWithout(without) {
	const register = dependencyRegister();
	return {
		outcomes: register.outcomes,
		products: registeredProducts(register),
		dependencies: selectDependencies(register, {
			products: [],
			requires: null,
			without,
		}),
		evidence: checkDependencyEvidence(register),
	};
}

/** One entry as the lines a person reads. */
export function describeDependency(entry) {
	return [
		`${entry.product} -> ${entry.requires}: ${entry.feature}`,
		`  how: ${entry.how}`,
		`  without ${entry.requires}: ${entry.whenAbsent} — ${entry.detail}`,
		...(entry.alternative ? [`  alternative: ${entry.alternative}`] : []),
		...entry.evidence.map(
			(cited) => `  source: ${cited.repository}/${cited.file}:${cited.line}`,
		),
	].join("\n");
}
