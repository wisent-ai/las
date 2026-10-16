// The register file's one writer: read, change and write it as one step no
// other writer can interleave with, in the release formatter's indentation.

import fs from "node:fs";

/** Another process is changing the register right now. */
export class RegisterBusy extends Error {}

/**
 * Read `file`, check it with `validate`, let `change` alter the document and
 * answer, and write it back when `change` says so. Two `dependencies set`
 * runs that each read the file and wrote their own copy back used to keep
 * only the last one's entry; now the second finds the first's lock and is
 * refused with the holder's pid instead of overwriting it. A lock whose
 * process has exited is taken over, since nothing can release it any more.
 * The new document replaces the old one by rename, so a reader never sees
 * half a file.
 */
export function changeFile(file, validate, change) {
	const lock = `${file}.lock`;
	const held = takeLock(lock);
	try {
		const document = JSON.parse(fs.readFileSync(file, "utf8"));
		// Refuse malformed persisted state before a mutator dereferences entries.
		validate(JSON.parse(JSON.stringify(document)));
		const { write, answer } = change(document);
		if (write) {
			const next = `${file}.${process.pid}.next`;
			const output = fs.openSync(next, "wx");
			try {
				// Tab-indented, as the release formatter (Biome's defaults over
				// src/) writes this file: indented another way, every change of
				// one entry rewrote the whole register and failed the fmt gate.
				fs.writeFileSync(output, `${JSON.stringify(document, null, "\t")}\n`);
				fs.renameSync(next, file);
			} finally {
				try {
					fs.closeSync(output);
				} finally {
					fs.rmSync(next, { force: true });
				}
			}
		}
		return answer;
	} finally {
		try {
			fs.closeSync(held);
		} finally {
			fs.rmSync(lock, { force: true });
		}
	}
}

/** Create `lock` holding this process's pid; refuse if it already exists. */
function createLock(lock) {
	const held = fs.openSync(lock, "wx");
	try {
		fs.writeSync(held, `${process.pid}\n`);
	} catch (error) {
		try {
			fs.closeSync(held);
		} finally {
			fs.rmSync(lock, { force: true });
		}
		throw error;
	}
	return held;
}

function takeLock(lock) {
	try {
		return createLock(lock);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const declaredHolder = fs.readFileSync(lock, "utf8").trim();
	const holder = Number(declaredHolder);
	if (
		!Number.isSafeInteger(holder) ||
		holder < Number.MIN_VALUE ||
		String(holder) !== declaredHolder
	) {
		throw new RegisterBusy(
			`the dependency register lock has no complete holder identity (${lock}); it may still be initializing and will not be removed`,
		);
	}
	if (processRuns(holder)) {
		throw new RegisterBusy(
			`the dependency register is being changed by process ${holder} (${lock}); run this change after it ends`,
		);
	}
	fs.rmSync(lock, { force: true });
	return createLock(lock);
}

// Whether process `pid` exists, asked with the null signal, which checks the
// process and sends nothing: https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html
function processRuns(pid) {
	try {
		process.kill(pid, 0); // https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html
		return true;
	} catch (error) {
		if (error.code === "EPERM") return true;
		if (error.code === "ESRCH") return false;
		throw new Error(
			`cannot inspect dependency register holder ${pid}: ${error.message}`,
			{ cause: error },
		);
	}
}
