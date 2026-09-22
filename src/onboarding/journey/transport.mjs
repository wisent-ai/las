/**
 * Talking to the control plane about one journey: assigning the experiment,
 * fetching the bundle and collecting the events, with the availability that
 * says whether the plane answered at all.
 */

import { JOURNEY_ID, JOURNEY_VERSION, PRODUCT_ID, REQUEST_TIMEOUT_MS } from "./contract.mjs";

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

export { StadoTransport };
