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

function invalid(index, reason) {
  return new Error(`dependency register entry ${index}: ${reason}`);
}

function text(entry, index, field) {
  if (typeof entry[field] !== "string" || !entry[field].trim()) throw invalid(index, `${field} must be a non-empty string`);
}

function validated(document) {
  if (!Array.isArray(document.dependencies)) throw new Error("dependency register has no dependencies list");
  const outcomes = Object.keys(document.outcomes ?? {});
  document.dependencies.forEach((entry, index) => {
    text(entry, index, "product");
    text(entry, index, "requires");
    text(entry, index, "feature");
    text(entry, index, "how");
    text(entry, index, "detail");
    if (!outcomes.includes(entry.whenAbsent)) throw invalid(index, `whenAbsent must be one of the register's outcomes: ${outcomes.join(", ")}`);
    if (entry.whenAbsent === "alternative") text(entry, index, "alternative");
    if (!Array.isArray(entry.evidence) || !entry.evidence.length) throw invalid(index, "evidence must cite at least one source line");
    entry.evidence = entry.evidence.map((cited) => {
      // `at` is `<repository>/<file>:<line>`, the way the source is cited
      // everywhere else; it is split once here for the readers below.
      const located = /^([^/]+)\/(.+):([1-9]\d*)$/.exec(cited.at ?? "");
      if (!located || !cited.contains) throw invalid(index, "each evidence item needs at (<repository>/<file>:<line>) and contains");
      return { ...cited, repository: located[1], file: located[2], line: Number(located[3]) };
    });
  });
  return document;
}

/** The register, validated. */
export function dependencyRegister() {
  return validated(JSON.parse(fs.readFileSync(path.join(HERE, "register.json"), "utf8")));
}

/** Every product the register names, on either side. */
export function registeredProducts(register) {
  return [...new Set(register.dependencies.flatMap((entry) => [entry.product, entry.requires]))].sort();
}

/**
 * The entries a query selects: `products` the dependent products (all when
 * empty), `requires` one required product or null, `without` the products
 * this machine does not have — only entries that need one of them.
 */
export function selectDependencies(register, query) {
  const known = new Set(registeredProducts(register));
  const named = [...query.products, ...(query.requires ? [query.requires] : []), ...query.without];
  for (const name of named) {
    if (!known.has(name)) throw new Error(`no product '${name}' in the dependency register; known: ${[...known].join(", ")}`);
  }
  return register.dependencies.filter((entry) =>
    (!query.products.length || query.products.includes(entry.product))
    && (!query.requires || entry.requires === query.requires)
    && (!query.without.length || query.without.includes(entry.requires)));
}

/**
 * One cited line read again: whether it still says what the register quotes.
 * A quote no longer at its line but on exactly one other line of the same
 * file is reported with `movedTo`, the line it is on now; only that case can
 * be repaired without reading the code again.
 */
function verify(cited) {
  const file = path.join(WORKSPACE, cited.repository, cited.file);
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch (error) {
    return { ...cited, ok: false, observed: `the file cannot be read: ${error.message}` };
  }
  const observed = lines[cited.line - 1];
  if (observed !== undefined && observed.includes(cited.contains)) return { ...cited, ok: true };
  const found = lines.flatMap((line, index) => (line.includes(cited.contains) ? [index + 1] : []));
  if (found.length === 1) return { ...cited, ok: false, movedTo: found[0], observed: `the quote moved to line ${found[0]}` };
  const where = found.length ? `the quote is on ${found.length} lines (${found.join(", ")})` : "the quote is nowhere in the file";
  if (observed === undefined) return { ...cited, ok: false, observed: `the file has only ${lines.length} lines; ${where}` };
  return { ...cited, ok: false, observed: `the line reads ${JSON.stringify(observed.trim())}; ${where}` };
}

/** Every cited line checked; `ok` is false when any one moved or changed. */
export function checkDependencyEvidence(register) {
  const stale = [];
  let checked = 0;
  for (const entry of register.dependencies) {
    for (const cited of entry.evidence) {
      checked += 1;
      const result = verify(cited);
      if (!result.ok) stale.push({ product: entry.product, requires: entry.requires, feature: entry.feature, ...result });
    }
  }
  return { ok: stale.length === 0, workspace: WORKSPACE, checked, stale };
}

/**
 * Rewrite the line of every citation whose quote moved to exactly one other
 * line of its file, and answer what was moved and what still needs a person
 * to read the code again. The quote, the entry and its outcome are never
 * changed: a changed quote means the behaviour may have changed.
 */
export function moveDependencyLines() {
  const file = path.join(HERE, "register.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  const register = validated(JSON.parse(JSON.stringify(document)));
  const moved = [];
  const remaining = [];
  register.dependencies.forEach((entry, entryIndex) => {
    entry.evidence.forEach((cited, citedIndex) => {
      const result = verify(cited);
      if (result.ok) return;
      if (result.movedTo) {
        const at = `${cited.repository}/${cited.file}:${result.movedTo}`;
        document.dependencies[entryIndex].evidence[citedIndex].at = at;
        moved.push({ from: `${cited.repository}/${cited.file}:${cited.line}`, to: at, contains: cited.contains });
      } else {
        remaining.push({ product: entry.product, requires: entry.requires, feature: entry.feature, ...result });
      }
    });
  });
  if (moved.length) fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n");
  return { moved, remaining };
}

/** What the GUI shows: the register narrowed to the products this machine
 * does not have (all entries when none), every product it names, and the
 * evidence check, so a stale entry is visible beside it. */
export function dependenciesWithout(without) {
  const register = dependencyRegister();
  return {
    outcomes: register.outcomes,
    products: registeredProducts(register),
    dependencies: selectDependencies(register, { products: [], requires: null, without }),
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
    ...entry.evidence.map((cited) => `  source: ${cited.repository}/${cited.file}:${cited.line}`),
  ].join("\n");
}
