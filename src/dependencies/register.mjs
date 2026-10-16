// What each Wisent product needs from another one, and what a machine
// without that other product gets: the register in `register.json`, read
// and queried here, and its evidence checked against the source it cites.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCitation } from "./source-path.mjs";
import { changeFile } from "./store.mjs";

export { RegisterBusy } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src/dependencies -> las/src -> las -> the Wisent workspace root shared
// by every sibling product repository.
const WORKSPACE = path.resolve(HERE, "..", "..", "..");

function invalid(index, reason) {
	return new Error(`dependency register entry ${index}: ${reason}`);
}

function text(entry, index, field) {
	if (typeof entry[field] !== "string" || !entry[field].trim())
		throw invalid(index, `${field} must be a non-empty string`);
}

function validated(document) {
	if (!document || typeof document !== "object" || Array.isArray(document))
		throw new Error("dependency register must be an object");
	if (!Array.isArray(document.dependencies))
		throw new Error("dependency register has no dependencies list");
	if (
		!document.outcomes ||
		typeof document.outcomes !== "object" ||
		Array.isArray(document.outcomes)
	)
		throw new Error("dependency register outcomes must be an object");
	const outcomes = Object.keys(document.outcomes);
	document.dependencies.forEach((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			throw invalid(index, "entry must be an object");
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
			if (!cited || typeof cited !== "object" || Array.isArray(cited))
				throw invalid(index, "each evidence item must be an object");
			text(cited, index, "at");
			text(cited, index, "contains");
			// `at` is `<repository>/<file>:<line>`, the way the source is cited
			// everywhere else; it is split once here for the readers below.
			const located = /^(?<repository>[^/]+)\/(?<file>.+):(?<line>\d+)$/.exec(
				cited.at,
			);
			if (!located)
				throw invalid(
					index,
					"each evidence item needs at (<repository>/<file>:<line>) and contains",
				);
			const { repository, file, line } = located.groups;
			// A line number counts from the first line: it is a whole number of at
			// least the smallest positive one.
			if (
				!Number.isSafeInteger(Number(line)) ||
				Number(line) < Number.MIN_VALUE
			)
				throw invalid(
					index,
					`evidence line must be a whole line number from the first line on: ${cited.at}`,
				);
			return { ...cited, repository, file, line: Number(line) };
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

/** One cited line read again (source-path.mjs verifyCitation). */
const verify = (cited) => verifyCitation(WORKSPACE, cited);

/**
 * Every cited line checked; `ok` is false when any quote changed. Quotes that
 * only moved hold and are listed under `moved` with the line they are on now.
 */
export function checkDependencyEvidence(register) {
	const stale = [];
	const moved = [];
	const citations = register.dependencies.flatMap((entry) =>
		entry.evidence.map((cited) => ({ entry, cited })),
	);
	for (const { entry, cited } of citations) {
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
	return {
		ok: !stale.length,
		workspace: WORKSPACE,
		checked: citations.length,
		stale,
		moved,
	};
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
		const at = position >= 0 ? position : document.dependencies.length;
		document.dependencies[at] = entry;
		const checked = validated(JSON.parse(JSON.stringify(document)));
		const recorded = checked.dependencies[at];
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
		const named = (existing) =>
			existing.product === product &&
			existing.requires === requires &&
			existing.feature === feature;
		if (!document.dependencies.some(named))
			return { write: false, answer: { removed: false } };
		document.dependencies = document.dependencies.filter(
			(existing) => !named(existing),
		);
		validated(JSON.parse(JSON.stringify(document)));
		return { write: true, answer: { removed: true } };
	});
}

/** Read, change and write the register as one step (store.mjs changeFile). */
function changeRegister(change) {
	return changeFile(path.join(HERE, "register.json"), validated, change);
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
