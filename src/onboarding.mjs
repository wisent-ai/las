import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const PRODUCT_ID = "las";
const JOURNEY_ID = "first-use";
const JOURNEY_VERSION = "2026-09-05.1";
const JOURNEY_VERSION_ID = "ca4c84fd-3de9-47ce-948d-cce351298e6c";
const FIRST_SUCCESS_FACT = "catalogue_adopted";
const STATE_PATH = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "las", "onboarding.json");
const REQUEST_TIMEOUT_MS = Number("1500");

const COPY = Object.freeze({
  "las.first_use.model.title": "Adopt your existing MCP catalogue",
  "las.first_use.model.body": "Las can discover standard local mcpServers JSON and adopt only entries that match its canonical signed surfaces. It validates every selected configuration before one atomic catalogue write and retains approved environment values without printing them.",
  "las.first_use.adopt.title": "Register the tools you already configured",
  "las.first_use.adopt.body": "Run las adopt to discover supported local MCP configuration, or pass exact configuration files. An identical registration is unchanged; conflicting or unsupported entries refuse the whole import without replacing your current catalogue.",
});
const LOCAL_SCREENS = Object.freeze({
  "catalogue-model": Object.freeze({
    title: COPY["las.first_use.model.title"],
    body: COPY["las.first_use.model.body"],
    actions: Object.freeze(["las onboarding advance"]),
  }),
  "catalogue-adopt": Object.freeze({
    title: COPY["las.first_use.adopt.title"],
    body: COPY["las.first_use.adopt.body"],
    actions: Object.freeze(["las adopt"]),
  }),
});


const FALLBACK_DEFINITION = JSON.parse(readFileSync(new URL("./onboarding_first_use.json", import.meta.url), "utf8"));

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
  if (!Array.isArray(definition.screens) || definition.screens.length === Number("0") || definition.screens.length > Number("128")) {
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
  await mkdir(dirname(STATE_PATH), { recursive: true, mode: Number("448") });
  const temporary = `${STATE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, Number("2")) + "\n", { mode: Number("384") });
  await rename(temporary, STATE_PATH);
}

class StadoTransport {
  constructor(client) {
    this.client = client;
    this.available = true;
  }

  async post(operation, body) {
    const baseValue = process.env.STADO_INTEGRATION_API_URL;
    const token = process.env.LAS_STADO_INTEGRATION_TOKEN;
    if (!this.available || !baseValue || !token) throw new Error("onboarding control plane is unavailable");
    let base;
    try {
      base = new URL(baseValue);
      if (base.protocol !== "https:" || base.username || base.password) throw new Error("invalid origin");
    } catch {
      this.available = false;
      throw new Error("onboarding control plane URL is invalid");
    }
    const endpoint = new URL(`/integration/${encodeURIComponent(this.client)}/onboarding/${PRODUCT_ID}/${operation}`, base);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const envelope = await response.json();
      if (!response.ok || !isRecord(envelope) || envelope.ok !== true || !("result" in envelope)) {
        throw new Error("onboarding control plane rejected the request");
      }
      return envelope.result;
    } catch (error) {
      this.available = false;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  readBundle() {
    return this.post("bundle.read", {
      product_id: PRODUCT_ID,
      journey_id: JOURNEY_ID,
      journey_version: JOURNEY_VERSION,
      if_none_match: null,
    });
  }

  readRemoteState(progress) {
    return this.post("state.read", {
      product_id: PRODUCT_ID,
      attempt_id: progress.attempt_id,
      subject_hash: progress.subject_hash,
    });
  }

  assignExperiment(subjectHash) {
    return this.post("experiments.assign", {
      product_id: PRODUCT_ID,
      journey_id: JOURNEY_ID,
      journey_version: JOURNEY_VERSION,
      subject_hash: subjectHash,
      scope_kind: "device",
      surface: this.client,
    });
  }

  collectEvent(event) {
    return this.post("events.collect", event);
  }
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

class OnboardingSession {
  constructor(state, bundle, transport, subjectHash) {
    this.state = state;
    this.bundle = bundle;
    this.transport = transport;
    this.subjectHash = subjectHash;
  }

  get progress() {
    return this.state.progress;
  }

  get screen() {
    return this.bundle.definition.screens.find((screen) => screen.screen_id === this.progress.current_screen_id);
  }

  async save() {
    await saveState(this.state);
  }

  event(name, revision, properties = {}, screenId = this.progress.current_screen_id, decision) {
    return {
      event_id: randomUUID(),
      event_name: name,
      attempt_id: this.progress.attempt_id,
      product_id: PRODUCT_ID,
      journey_version_id: this.progress.journey_version_id,
      subject_hash: this.subjectHash,
      scope_kind: "device",
      screen_id: screenId,
      occurred_at: new Date().toISOString(),
      evidence_revision: revision,
      experiment_id: this.progress.experiment_id,
      variant_id: this.progress.variant_id,
      selected_next_screen_id: decision?.screen_id,
      reason_code: decision?.reason_code,
      properties,
      answers: this.progress.answers,
    };
  }

  async emit(events) {
    const queued = Array.isArray(this.state.pending_events) ? this.state.pending_events : [];
    const ids = new Set(queued.map((event) => event.event_id));
    for (const event of events) if (!ids.has(event.event_id)) queued.push(event);
    this.state.pending_events = queued;
    await this.save();
    await this.flush();
  }

  async flush() {
    while (this.state.pending_events.length) {
      const event = this.state.pending_events[Number("0")];
      try {
        await this.transport.collectEvent(event);
      } catch {
        return;
      }
      this.state.pending_events.shift();
      await this.save();
    }
  }

  async expose(revision) {
    if (this.progress.status !== "completed" && this.progress.status !== "skipped") {
      await this.emit([this.event("onboarding_step_viewed", revision)]);
    }
  }

  async advance(revision) {
    if (this.progress.status !== "in_progress") return null;
    const current = this.screen;
    const decision = selectNext(this.bundle, current.screen_id, this.state.evidence || {});
    if (!decision) return null;
    this.progress.current_screen_id = decision.screen_id;
    if (!this.progress.completed_screen_ids.includes(current.screen_id)) this.progress.completed_screen_ids.push(current.screen_id);
    this.progress.evidence_revision = revision;
    await this.emit([this.event("onboarding_step_completed", revision, {}, current.screen_id, decision)]);
    return decision;
  }

  async skip(revision) {
    if (this.progress.status === "completed") return;
    this.progress.status = "skipped";
    this.progress.evidence_revision = revision;
    await this.emit([this.event("onboarding_step_skipped", revision)]);
  }

  async reset(revision) {
    this.state.evidence = {};
    this.state.meta = {};
    this.state.progress = newProgress(this.bundle, this.subjectHash, revision);
    await this.emit([
      this.event("onboarding_reset", revision),
      this.event("onboarding_started", revision),
    ]);
  }

  async observeCatalogueAdoption(revision, properties) {
    if (this.progress.status !== "in_progress") return;
    this.state.evidence = { ...(this.state.evidence || {}), [FIRST_SUCCESS_FACT]: true };
    const events = [];
    if (!this.state.meta?.first_action_recorded) {
      this.state.meta = { ...(this.state.meta || {}), first_action_recorded: true };
      events.push(this.event("onboarding_first_action_completed", revision, properties));
    }
    for (let index = Number("0"); index < this.bundle.definition.screens.length; index += Number("1")) {
      const current = this.screen;
      if (current.transitions.length === Number("0")) break;
      const decision = selectNext(this.bundle, current.screen_id, this.state.evidence);
      if (!decision) break;
      if (!this.progress.completed_screen_ids.includes(current.screen_id)) this.progress.completed_screen_ids.push(current.screen_id);
      this.progress.current_screen_id = decision.screen_id;
      events.push(this.event("onboarding_step_completed", revision, properties, current.screen_id, decision));
    }
    const terminal = this.screen;
    if (terminal.transitions.length === Number("0") && this.state.evidence[FIRST_SUCCESS_FACT] === true
      && evaluate(terminal.completion_evidence, this.state.evidence)) {
      if (!this.progress.completed_screen_ids.includes(terminal.screen_id)) this.progress.completed_screen_ids.push(terminal.screen_id);
      this.progress.status = "completed";
      events.push(this.event("onboarding_step_completed", revision, properties, terminal.screen_id));
      events.push(this.event("onboarding_first_success_observed", revision, properties, terminal.screen_id));
      events.push(this.event("onboarding_completed", revision, properties, terminal.screen_id));
    }
    this.progress.evidence_revision = revision;
    await this.emit(events);
  }
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
  const session = new OnboardingSession(state, bundle, transport, subjectHash);
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
