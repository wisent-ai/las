import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { OnboardingSession } from "./session.mjs";


import {
  FIRST_SUCCESS_FACT,
  JOURNEY_ID,
  JOURNEY_VERSION,
  JOURNEY_VERSION_ID,
  JSON_INDENT,
  OWNER_ONLY_DIRECTORY,
  OWNER_ONLY_FILE,
  PRODUCT_ID,
  STATE_PATH,
} from "./journey/contract.mjs";
import {
  canonicalFallback,
  isRecord,
  sha256,
  validateBundle,
} from "./journey/bundle.mjs";
import { StadoTransport } from "./journey/transport.mjs";
import { COPY, LOCAL_SCREENS } from "./journey/screens.mjs";


async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (isRecord(parsed) && parsed.schema_version === Number("1")) return parsed;
  } catch {
    // Missing or damaged local state falls back to a fresh, valid store.
  }
  return { schema_version: Number("1"), installation_id: randomUUID(), pending_events: [], evidence: {}, meta: {} };
}

async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  const temporary = `${STATE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, JSON_INDENT) + "\n", { mode: OWNER_ONLY_FILE });
  await rename(temporary, STATE_PATH);
}


function evaluate(condition, evidence) {
  if (!condition) return true;
  if (condition.kind === "all") return condition.conditions.every((entry) => evaluate(entry, evidence));
  if (condition.kind === "any") return condition.conditions.some((entry) => evaluate(entry, evidence));
  if (condition.kind === "not") return !evaluate(condition.condition, evidence);
  const actual = evidence[condition.fact];
  if (condition.operator === "present") return actual !== undefined && actual !== null;
  if (condition.operator === "absent") return actual === undefined || actual === null;
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "not_eq") return actual !== condition.value;
  if (condition.operator === "contains") return Array.isArray(actual) && actual.includes(condition.value);
  if (typeof actual !== "number" || typeof condition.value !== "number") return false;
  if (condition.operator === "gt") return actual > condition.value;
  if (condition.operator === "gte") return actual >= condition.value;
  if (condition.operator === "lt") return actual < condition.value;
  if (condition.operator === "lte") return actual <= condition.value;
  return false;
}

function selectNext(bundle, currentScreenId, evidence) {
  const current = bundle.definition.screens.find((screen) => screen.screen_id === currentScreenId);
  if (!current) return null;
  if (current.completion_evidence && !evaluate(current.completion_evidence, evidence)) return null;
  const transition = [...current.transitions]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => evaluate(candidate.condition, evidence));
  if (transition) return { screen_id: transition.next_screen_id, reason_code: transition.reason_code };
  if (current.fallback_screen_id) return { screen_id: current.fallback_screen_id, reason_code: "fallback_evidence_unavailable" };
  return null;
}

function validProgress(progress, bundle, subjectHash) {
  return isRecord(progress) && progress.product_id === PRODUCT_ID && progress.journey_version_id === bundle.journey_version_id
    && progress.subject_hash === subjectHash && typeof progress.attempt_id === "string"
    && bundle.definition.screens.some((screen) => screen.screen_id === progress.current_screen_id)
    && Array.isArray(progress.completed_screen_ids) && Array.isArray(progress.answers);
}


function newProgress(bundle, subjectHash, revision) {
  return {
    attempt_id: randomUUID(),
    product_id: PRODUCT_ID,
    journey_version_id: bundle.journey_version_id,
    subject_hash: subjectHash,
    scope_kind: "device",
    current_screen_id: bundle.definition.entry_screen_id,
    completed_screen_ids: [],
    status: "in_progress",
    evidence_revision: revision,
    answers: [],
  };
}

async function openSession(client, { start = true } = {}) {
  const state = await loadState();
  if (typeof state.installation_id !== "string") state.installation_id = randomUUID();
  if (!Array.isArray(state.pending_events)) state.pending_events = [];
  if (!isRecord(state.evidence)) state.evidence = {};
  if (!isRecord(state.meta)) state.meta = {};
  const subjectHash = sha256(`las:${state.installation_id}`);
  const transport = new StadoTransport(client);
  let bundle;
  try {
    bundle = validateBundle(await transport.readBundle());
    state.bundle = bundle;
  } catch {
    try {
      bundle = validateBundle(state.bundle);
    } catch {
      bundle = validateBundle(canonicalFallback());
    }
  }
  if (!start && !validProgress(state.progress, bundle, subjectHash)) return null;
  const revision = new Date().toISOString();
  const existing = validProgress(state.progress, bundle, subjectHash);
  if (!existing) {
    state.progress = newProgress(bundle, subjectHash, revision);
    state.evidence = {};
    state.meta = {};
  }
  const session = new OnboardingSession(state, bundle, transport, subjectHash, {
    saveState,
    selectNext,
    evaluate,
    newProgress,
    productId: PRODUCT_ID,
    firstSuccessFact: FIRST_SUCCESS_FACT,
  });
  await session.save();
  if (existing) {
    try { await transport.readRemoteState(session.progress); } catch { /* Local state remains authoritative offline. */ }
  }
  if (bundle.definition.experiment_contract && !session.progress.variant_id) {
    try {
      const assignment = await transport.assignExperiment(subjectHash);
      if (isRecord(assignment)) {
        session.progress.experiment_id = typeof assignment.experimentId === "string" ? assignment.experimentId : bundle.definition.experiment_contract.experiment_id;
        session.progress.variant_id = typeof assignment.variant === "string" ? assignment.variant : undefined;
        await session.save();
      }
    } catch {
      // The canonical journey remains usable without an experiment assignment.
    }
  }
  if (!existing) await session.emit([session.event("onboarding_started", revision)]);
  else await session.flush();
  return session;
}

function view(session) {
  const screen = session.screen;
  const local = LOCAL_SCREENS[screen.screen_id];
  return {
    product_id: PRODUCT_ID,
    journey_id: JOURNEY_ID,
    journey_version: JOURNEY_VERSION,
    status: session.progress.status,
    title: local.title,
    body: local.body,
    actions: local.actions,
    current_screen_id: screen.screen_id,
    completed_screen_ids: session.progress.completed_screen_ids,
  };
}

export async function runOnboardingAction(action = "show", { client = "cli" } = {}) {
  if (!["show", "status", "advance", "skip", "reset"].includes(action)) throw new Error(`unknown onboarding action '${action}'`);
  const session = await openSession(client, { start: action !== "status" });
  if (!session) {
    return {
      product_id: PRODUCT_ID,
      journey_id: JOURNEY_ID,
      journey_version: JOURNEY_VERSION,
      status: "not_started",
      title: COPY["las.first_use.model.title"],
      body: COPY["las.first_use.model.body"],
      actions: ["las onboarding"],
    };
  }
  const revision = new Date().toISOString();
  if (action === "reset") await session.reset(revision);
  else if (action === "skip") await session.skip(revision);
  else if (action === "advance") await session.advance(revision);
  if (action === "show" || action === "reset" || action === "advance") await session.expose(revision);
  return view(session);
}

export async function recordCatalogueAdopted({ client = "cli", surfaceCount, catalogPath } = {}) {
  try {
    const state = await loadState();
    if (!isRecord(state.progress) || state.progress.status !== "in_progress") return false;
    const session = await openSession(client, { start: false });
    if (!session) return false;
    const revision = new Date().toISOString();
    await session.observeCatalogueAdoption(revision, {
      first_success_fact: FIRST_SUCCESS_FACT,
      command: "las adopt",
      surface_count: surfaceCount,
      catalog_path: catalogPath,
    });
    return session.progress.status === "completed";
  } catch {
    // Onboarding persistence or transport must never turn a successful catalogue import into a failure.
    return false;
  }
}

export const LAS_ONBOARDING_TOOL = Object.freeze({
  name: "las__onboarding",
  description: "Run Las first-use onboarding; completion requires a real las adopt operation to persist supported existing MCP configuration.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["show", "status", "advance", "skip", "reset"], default: "show" },
    },
    additionalProperties: false,
  },
});
