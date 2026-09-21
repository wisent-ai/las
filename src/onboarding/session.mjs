// One attempt at the first-use journey: where it stands, which screen comes
// next, and the events it records about that.
//
// Split out of `journey.mjs`, which had grown past the three-hundred-line
// limit; loading the definition and talking to the control plane stay
// there.

import { randomUUID } from "node:crypto";

const FIRST_INDEX = Number("0");
const ONE = Number("1");
const NONE = Number("0");

export class OnboardingSession {
  /**
   * `deps` is what the journey owns and this class only uses: writing the
   * state file, walking the screen graph, reading a condition, and the two
   * identifiers every event carries.
   */
  constructor(state, bundle, transport, subjectHash, deps) {
    this.state = state;
    this.bundle = bundle;
    this.transport = transport;
    this.subjectHash = subjectHash;
    this.deps = deps;
  }

  get progress() {
    return this.state.progress;
  }

  get screen() {
    return this.bundle.definition.screens.find((screen) => screen.screen_id === this.progress.current_screen_id);
  }

  async save() {
    await this.deps.saveState(this.state);
  }

  event(name, revision, properties = {}, screenId = this.progress.current_screen_id, decision) {
    return {
      event_id: randomUUID(),
      event_name: name,
      attempt_id: this.progress.attempt_id,
      product_id: this.deps.productId,
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
      const event = this.state.pending_events[FIRST_INDEX];
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
    const decision = this.deps.selectNext(this.bundle, current.screen_id, this.state.evidence || {});
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
    this.state.progress = this.deps.newProgress(this.bundle, this.subjectHash, revision);
    await this.emit([
      this.event("onboarding_reset", revision),
      this.event("onboarding_started", revision),
    ]);
  }

  async observeCatalogueAdoption(revision, properties) {
    if (this.progress.status !== "in_progress") return;
    this.state.evidence = { ...(this.state.evidence || {}), [this.deps.firstSuccessFact]: true };
    const events = [];
    if (!this.state.meta?.first_action_recorded) {
      this.state.meta = { ...(this.state.meta || {}), first_action_recorded: true };
      events.push(this.event("onboarding_first_action_completed", revision, properties));
    }
    for (let index = FIRST_INDEX; index < this.bundle.definition.screens.length; index += ONE) {
      const current = this.screen;
      if (current.transitions.length === NONE) break;
      const decision = this.deps.selectNext(this.bundle, current.screen_id, this.state.evidence);
      if (!decision) break;
      if (!this.progress.completed_screen_ids.includes(current.screen_id)) this.progress.completed_screen_ids.push(current.screen_id);
      this.progress.current_screen_id = decision.screen_id;
      events.push(this.event("onboarding_step_completed", revision, properties, current.screen_id, decision));
    }
    const terminal = this.screen;
    if (terminal.transitions.length === NONE && this.state.evidence[this.deps.firstSuccessFact] === true
      && this.deps.evaluate(terminal.completion_evidence, this.state.evidence)) {
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

