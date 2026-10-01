// `las dependencies`: the register of what each Wisent product needs from
// another one, printed for a person or as JSON; `las dependencies check`,
// which reads every cited source line again and, with `--move-lines`,
// follows quotes that only moved to another line; and `las dependencies
// set`, which records one entry only when its citations hold.

import {
  checkDependencyEvidence,
  dependencyRegister,
  describeDependency,
  moveDependencyLines,
  recordDependency,
  selectDependencies,
} from "./register.mjs";

export const DEPENDENCIES_USAGE = [
  "las dependencies [product...] [--requires PRODUCT] [--without PRODUCT[,PRODUCT...]] [--json]",
  "las dependencies check [--move-lines] [--json]",
  "las dependencies set <product> <requires> --feature TEXT --how TEXT --when-absent OUTCOME --detail TEXT",
  "    [--alternative TEXT] --at <repository>/<file>:<line> --contains TEXT [--at … --contains …]",
].join("\n");

class UsageError extends Error {}

function value(args, index, flag) {
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) throw new UsageError(`${flag} needs a product name`);
  return next;
}

function parse(args) {
  const query = { products: [], requires: null, without: [], json: false, check: false, moveLines: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") query.json = true;
    else if (argument === "--move-lines") query.moveLines = true;
    else if (argument === "--requires") query.requires = value(args, index++, argument);
    else if (argument === "--without") query.without.push(...value(args, index++, argument).split(",").filter(Boolean));
    else if (argument.startsWith("-")) throw new UsageError(`unknown dependencies option '${argument}'`);
    else if (argument === "check" && index === 0) query.check = true;
    else query.products.push(argument);
  }
  if (query.check && (query.products.length || query.requires || query.without.length)) {
    throw new UsageError("dependencies check takes only --move-lines and --json");
  }
  if (query.moveLines && !query.check) throw new UsageError("--move-lines belongs to dependencies check");
  return query;
}

/** `set <product> <requires> …`: one entry, each `--at` paired with the
 * `--contains` after it. */
function parseSet(args) {
  const [product, requires, ...rest] = args;
  if (!product || !requires || product.startsWith("-") || requires.startsWith("-")) {
    throw new UsageError("dependencies set needs <product> <requires>");
  }
  const entry = { product, requires };
  const evidence = [];
  const named = { "--feature": "feature", "--how": "how", "--when-absent": "whenAbsent", "--detail": "detail", "--alternative": "alternative" };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const text = rest[index + 1];
    if (text === undefined) throw new UsageError(`${flag} needs a value`);
    if (flag === "--at") evidence.push({ at: text });
    else if (flag === "--contains") {
      const last = evidence[evidence.length - 1];
      if (!last || last.contains !== undefined) throw new UsageError("each --contains follows its own --at");
      last.contains = text;
    } else if (Object.hasOwn(named, flag)) entry[named[flag]] = text;
    else throw new UsageError(`unknown dependencies set option '${flag}'`);
  }
  return { ...entry, evidence };
}

function printRecorded(result, json) {
  if (json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else if (result.recorded) process.stdout.write(`${result.replaced ? "replaced" : "added"} the entry\n`);
  else {
    for (const cited of result.refused) {
      process.stderr.write(`las: not recorded: ${cited.repository}/${cited.file}:${cited.line} should contain ${JSON.stringify(cited.contains)}; ${cited.observed}\n`);
    }
  }
  if (!result.recorded) process.exitCode = 1;
}

function printMoved(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    for (const move of result.moved) process.stdout.write(`moved ${move.from} -> ${move.to} (${JSON.stringify(move.contains)})\n`);
    if (!result.moved.length) process.stdout.write("no citation only moved; nothing was rewritten\n");
    for (const cited of result.remaining) {
      process.stdout.write(`still stale, read the code again: ${cited.product} -> ${cited.requires} (${cited.feature}): ${cited.repository}/${cited.file}:${cited.line} should contain ${JSON.stringify(cited.contains)}; ${cited.observed}\n`);
    }
  }
  if (result.remaining.length) process.exitCode = 1;
}

function printCheck(report, json) {
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (report.ok) {
    process.stdout.write(`all ${report.checked} cited source lines still say what the register quotes (workspace ${report.workspace})\n`);
  } else {
    process.stdout.write(`${report.stale.length} of ${report.checked} cited source lines no longer say what the register quotes:\n`);
    for (const cited of report.stale) {
      process.stdout.write(`  ${cited.product} -> ${cited.requires} (${cited.feature}): ${cited.repository}/${cited.file}:${cited.line} should contain ${JSON.stringify(cited.contains)}; ${cited.observed}\n`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

export async function cmdDependencies(args) {
  let query;
  try {
    if (args[0] === "set") {
      const entry = parseSet(args.slice(1).filter((argument) => argument !== "--json"));
      let result;
      try {
        result = recordDependency(entry);
      } catch (error) {
        process.stderr.write(`las: ${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      printRecorded(result, args.includes("--json"));
      return;
    }
    query = parse(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`las: ${error.message}\nusage:\n${DEPENDENCIES_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (query.check && query.moveLines) {
    printMoved(moveDependencyLines(), query.json);
    return;
  }
  const register = dependencyRegister();
  if (query.check) {
    printCheck(checkDependencyEvidence(register), query.json);
    return;
  }
  let selected;
  try {
    selected = selectDependencies(register, query);
  } catch (error) {
    process.stderr.write(`las: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (query.json) {
    process.stdout.write(JSON.stringify({ outcomes: register.outcomes, dependencies: selected }, null, 2) + "\n");
    return;
  }
  if (!selected.length) {
    process.stdout.write("no registered dependency matches\n");
    return;
  }
  process.stdout.write(selected.map(describeDependency).join("\n\n") + "\n");
}
