import fs from "node:fs";
import path from "node:path";

function contained(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/** Resolve only a file belonging to the repository named in the citation. */
export function citationPath(workspace, repository, file) {
	if (
		!repository ||
		repository === "." ||
		repository === ".." ||
		path.basename(repository) !== repository
	)
		throw new Error(
			`citation repository must name a workspace child: ${JSON.stringify(repository)}`,
		);
	if (!file || path.isAbsolute(file))
		throw new Error(
			`citation file must be relative to ${repository}: ${JSON.stringify(file)}`,
		);
	const root = fs.realpathSync(workspace);
	const declaredRepository = path.join(root, repository);
	const declaredFile = path.resolve(declaredRepository, file);
	if (!contained(declaredRepository, declaredFile))
		throw new Error(
			`citation file escapes ${repository}: ${JSON.stringify(file)}`,
		);
	const actualRepository = fs.realpathSync(declaredRepository);
	if (actualRepository !== declaredRepository)
		throw new Error(
			`citation repository ${repository} resolves outside its declared directory: ${actualRepository}`,
		);
	const actualFile = fs.realpathSync(declaredFile);
	if (!contained(actualRepository, actualFile))
		throw new Error(
			`citation file escapes ${repository} through a symbolic link: ${JSON.stringify(file)} resolves to ${actualFile}`,
		);
	return actualFile;
}

/**
 * One cited line read again: whether the file still says what the register
 * quotes. A quote no longer at its line but on exactly one other line of the
 * same file still holds — the code says the same thing, only lower or higher
 * — and is answered with `movedTo`, the line it is on now, so readers and
 * `--move-lines` use that line. A quote that changed, vanished or now stands
 * on several lines does not hold: only a person reading the code can say
 * whether the dependency still behaves as recorded. A file that cannot be
 * read does not hold either, and the answer keeps why.
 */
export function verifyCitation(workspace, cited) {
	let lines;
	let unreadable;
	try {
		const file = citationPath(workspace, cited.repository, cited.file);
		lines = fs.readFileSync(file, "utf8").split("\n");
	} catch (error) {
		unreadable = error;
	}
	if (unreadable)
		return {
			...cited,
			ok: false,
			observed: `the file cannot be read: ${unreadable.message}`,
		};
	// Numbered from one, as a citation counts lines: the slot before the first
	// line holds nothing a quote can be found in.
	const numbered = [undefined, ...lines];
	const observed = numbered[cited.line];
	if (observed !== undefined && observed.includes(cited.contains))
		return { ...cited, ok: true };
	const found = numbered.flatMap((line, number) =>
		line?.includes(cited.contains) ? [number] : [],
	);
	const [only, ...others] = found;
	if (only !== undefined && !others.length)
		return {
			...cited,
			ok: true,
			movedTo: only,
			observed: `the quote moved to line ${only}`,
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
