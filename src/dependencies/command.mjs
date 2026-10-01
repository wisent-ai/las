// `las dependencies`: the register of what each Wisent product needs from
// another one, printed for a person or as JSON, and `las dependencies check`,
// which reads every cited source line again.

import {
  checkDependencyEvidence,
  dependencyRegister,
  describeDependency,
  selectDependencies,
} from "./register.mjs";

export const DEPENDENCIES_USAGE = [
  "las dependencies [product...] [--requires PRODUCT] [--without PRODUCT[,PRODUCT...]] [--json]",
  "las dependencies check [--json]",
].join("\n");

class UsageError extends Error {}

function value(args, index, flag) {
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) throw new UsageError(`${flag} needs a product name`);
  return next;
}

function parse(args) {
  const query = { products: [], requires: null, without: [], json: false, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") query.json = true;
    else if (argument === "--requires") query.requires = value(args, index++, argument);
    else if (argument === "--without") query.without.push(...value(args, index++, argument).split(",").filter(Boolean));
    else if (argument.startsWith("-")) throw new UsageError(`unknown dependencies option '${argument}'`);
    else if (argument === "check" && index === 0) query.check = true;
    else query.products.push(argument);
  }
  if (query.check && (query.products.length || query.requires || query.without.length)) {
    throw new UsageError("dependencies check takes only --json");
  }
  return query;
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
    query = parse(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`las: ${error.message}\nusage:\n${DEPENDENCIES_USAGE}\n`);
    process.exitCode = 2;
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
