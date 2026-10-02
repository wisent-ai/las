// One answer, two forms from the same data: the JSON document machines read,
// or with `--text` one `path: value` line per leaf field for a person —
// nested keys joined with dots, list items indexed, an empty list as `[]`,
// a null as `-`.

export function renderLines(value, path = "", lines = []) {
  if (Array.isArray(value)) {
    if (value.length === 0) lines.push(`${path}: []`);
    value.forEach((item, index) => renderLines(item, `${path}[${index}]`, lines));
    return lines;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, field] of Object.entries(value)) {
      renderLines(field, path ? `${path}.${key}` : key, lines);
    }
    return lines;
  }
  lines.push(`${path}: ${value === null || value === undefined ? "-" : String(value)}`);
  return lines;
}

/** Print one answer to stdout, as JSON or as lines for a person. */
export function printAnswer(value, text) {
  if (text) {
    process.stdout.write(renderLines(value).map((line) => `${line}\n`).join(""));
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Take the global `--text` out of the arguments and say whether it was there. */
export function takeTextSwitch(argv) {
  const text = argv.includes("--text");
  return { text, rest: argv.filter((word) => word !== "--text") };
}
