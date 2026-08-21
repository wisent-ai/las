import { TextDecoder } from "node:util";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function parseStrictJson(bytes, label = "JSON") {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    throw new Error(`${label}: payload is not valid UTF-8`);
  }
  let offset = 0;

  function fail(message) {
    throw new Error(`${label}: ${message} at byte ${Buffer.byteLength(text.slice(0, offset), "utf8")}`);
  }
  function whitespace() {
    while (offset < text.length && /[\u0020\u000a\u000d\u0009]/.test(text[offset])) offset += 1;
  }
  function string() {
    if (text[offset] !== '"') fail("expected string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const char = text[offset];
      if (char === '"') {
        offset += 1;
        try { return JSON.parse(text.slice(start, offset)); } catch { fail("invalid string"); }
      }
      if (char === "\\") {
        offset += 1;
        if (offset >= text.length || !/["\\/bfnrtu]/.test(text[offset])) fail("invalid escape");
        if (text[offset] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) fail("invalid unicode escape");
          offset += 4;
        }
      } else if (char.charCodeAt(0) < 0x20) {
        fail("unescaped control character");
      }
      offset += 1;
    }
    fail("unterminated string");
  }
  function number() {
    const match = text.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("invalid number");
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("non-finite number");
    return value;
  }
  function array() {
    const value = [];
    offset += 1;
    whitespace();
    if (text[offset] === "]") { offset += 1; return value; }
    while (true) {
      value.push(any());
      whitespace();
      if (text[offset] === "]") { offset += 1; return value; }
      if (text[offset] !== ",") fail("expected ',' or ']'");
      offset += 1;
      whitespace();
    }
  }
  function object() {
    const value = Object.create(null);
    const keys = new Set();
    offset += 1;
    whitespace();
    if (text[offset] === "}") { offset += 1; return value; }
    while (true) {
      const key = string();
      if (keys.has(key)) fail(`duplicate member '${key}'`);
      keys.add(key);
      whitespace();
      if (text[offset] !== ":") fail("expected ':'");
      offset += 1;
      value[key] = any();
      whitespace();
      if (text[offset] === "}") { offset += 1; return value; }
      if (text[offset] !== ",") fail("expected ',' or '}'");
      offset += 1;
      whitespace();
    }
  }
  function any() {
    whitespace();
    const char = text[offset];
    if (char === '"') return string();
    if (char === "{") return object();
    if (char === "[") return array();
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return value; }
    }
    if (char === "-" || /[0-9]/.test(char || "")) return number();
    fail("expected value");
  }

  const result = any();
  whitespace();
  if (offset !== text.length) fail("trailing data");
  return result;
}

export function assertExactKeys(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label}: unknown member '${key}'`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label}: missing member '${key}'`);
}
