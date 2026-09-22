/**
 * The bundle this journey is driven from and how it is checked: the canonical
 * form its digest is taken over, the conditions a screen declares, and the
 * identity a definition must carry to be this product s first-use journey.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  FIRST_SUCCESS_FACT,
  JOURNEY_ID,
  JOURNEY_VERSION,
  JOURNEY_VERSION_ID,
  MAX_JOURNEY_SCREENS,
  PRODUCT_ID,
} from "./contract.mjs";
import { LOCAL_SCREENS } from "./screens.mjs";

const FALLBACK_DEFINITION = JSON.parse(readFileSync(new URL("../onboarding_first_use.json", import.meta.url), "utf8"));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalFallback() {
  const canonical_definition = JSON.stringify(canonical(FALLBACK_DEFINITION));
  return {
    journey_version_id: JOURNEY_VERSION_ID,
    definition: FALLBACK_DEFINITION,
    canonical_definition,
    content_sha256: sha256(canonical_definition),
    source_revision: FALLBACK_DEFINITION.source_revision,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCondition(condition) {
  if (!isRecord(condition) || typeof condition.kind !== "string") return false;
  if (condition.kind === "all" || condition.kind === "any") {
    return Array.isArray(condition.conditions) && condition.conditions.every(validateCondition);
  }
  if (condition.kind === "not") return validateCondition(condition.condition);
  return condition.kind === "fact" && typeof condition.fact === "string"
    && ["present", "absent", "eq", "not_eq", "contains", "gt", "gte", "lt", "lte"].includes(condition.operator);
}

function validateBundle(bundle) {
  if (!isRecord(bundle) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bundle.journey_version_id)
    || !/^[0-9a-f]{64}$/.test(bundle.content_sha256) || typeof bundle.canonical_definition !== "string") {
    throw new Error("onboarding bundle envelope is invalid");
  }
  const definition = bundle.definition;
  if (!isRecord(definition) || definition.schema_version !== Number("1") || definition.product_id !== PRODUCT_ID
    || definition.journey_id !== JOURNEY_ID || definition.journey_version !== JOURNEY_VERSION
    || definition.first_success_fact !== FIRST_SUCCESS_FACT || typeof definition.entry_screen_id !== "string") {
    throw new Error("onboarding bundle identity is invalid");
  }
  if (JSON.stringify(canonical(definition)) !== bundle.canonical_definition
    || sha256(bundle.canonical_definition) !== bundle.content_sha256) {
    throw new Error("onboarding bundle integrity is invalid");
  }
  if (!Array.isArray(definition.screens) || definition.screens.length === 0 || definition.screens.length > MAX_JOURNEY_SCREENS) {
    throw new Error("onboarding screen graph is invalid");
  }
  const ids = new Set();
  for (const screen of definition.screens) {
    if (!isRecord(screen) || typeof screen.screen_id !== "string" || !LOCAL_SCREENS[screen.screen_id] || ids.has(screen.screen_id)
      || typeof screen.title_key !== "string" || typeof screen.body_key !== "string"
      || !Array.isArray(screen.actions) || !screen.actions.every((action) => typeof action === "string")
      || !Array.isArray(screen.transitions)
      || (screen.completion_evidence !== undefined && !validateCondition(screen.completion_evidence))) {
      throw new Error("onboarding screen is invalid");
    }
    ids.add(screen.screen_id);
  }
  if (!ids.has(definition.entry_screen_id)) throw new Error("onboarding entry screen is missing");
  for (const screen of definition.screens) {
    if (screen.fallback_screen_id !== undefined && !ids.has(screen.fallback_screen_id)) throw new Error("onboarding fallback is missing");
    for (const transition of screen.transitions) {
      if (!isRecord(transition) || !ids.has(transition.next_screen_id) || typeof transition.reason_code !== "string"
        || typeof transition.priority !== "number" || (transition.condition !== undefined && !validateCondition(transition.condition))) {
        throw new Error("onboarding transition is invalid");
      }
    }
  }
  return bundle;
}


export { canonical, canonicalFallback, isRecord, sha256, validateBundle, validateCondition };
