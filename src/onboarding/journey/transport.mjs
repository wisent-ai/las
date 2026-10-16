/**
 * Talking to the control plane about one journey: assigning the experiment,
 * fetching the bundle and collecting the events, with the availability that
 * says whether the plane answered at all.
 */

import { JOURNEY_ID, JOURNEY_VERSION, PRODUCT_ID } from "./contract.mjs";
import { isRecord } from "./bundle.mjs";

class StadoTransport {
	constructor(client) {
		this.client = client;
		this.available = true;
		this.diagnostic = { state: "not_requested" };
	}

	failed(operation, error, endpoint = null, httpStatus = null) {
		this.available = false;
		this.diagnostic = {
			state: "unavailable",
			operation,
			endpoint,
			httpStatus,
			observedAt: new Date().toISOString(),
			error: error.message,
		};
		return error;
	}

	async post(operation, body) {
		const baseValue = process.env.STADO_INTEGRATION_API_URL;
		const token = process.env.LAS_STADO_INTEGRATION_TOKEN;
		if (!this.available) throw new Error(this.diagnostic.error);
		if (!baseValue || !token) {
			const missing = [
				...(!baseValue ? ["STADO_INTEGRATION_API_URL"] : []),
				...(!token ? ["LAS_STADO_INTEGRATION_TOKEN"] : []),
			];
			throw this.failed(
				operation,
				new Error(
					`onboarding control plane ${operation} needs ${missing.join(", ")}`,
				),
			);
		}
		let base;
		try {
			base = new URL(baseValue);
		} catch (error) {
			throw this.failed(
				operation,
				new Error(
					`onboarding control plane URL in STADO_INTEGRATION_API_URL is not a URL: ${error.message}`,
					{ cause: error },
				),
			);
		}
		const extra = [
			...(base.protocol !== "https:" ? [`scheme ${base.protocol}`] : []),
			...(base.username || base.password ? ["credentials"] : []),
			...(base.pathname !== "/" ? [`path ${base.pathname}`] : []),
			...(base.search ? [`query ${base.search}`] : []),
			...(base.hash ? [`fragment ${base.hash}`] : []),
		];
		if (extra.length)
			throw this.failed(
				operation,
				new Error(
					`onboarding control plane URL must be an HTTPS origin without credentials, a path, query or fragment; it has ${extra.join(", ")}`,
				),
			);
		const endpoint = new URL(
			`/integration/${encodeURIComponent(this.client)}/onboarding/${PRODUCT_ID}/${operation}`,
			base,
		);
		let httpStatus = null;
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				redirect: "manual",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
			httpStatus = response.status;
			const text = await response.text();
			let envelope;
			try {
				envelope = JSON.parse(text);
			} catch (error) {
				throw new Error(
					`onboarding control plane ${operation} returned invalid JSON (HTTP ${response.status}): ${error.message}; body: ${text}`,
					{ cause: error },
				);
			}
			if (
				!response.ok ||
				!isRecord(envelope) ||
				envelope.ok !== true ||
				!("result" in envelope)
			) {
				throw new Error(
					`onboarding control plane rejected ${operation} (HTTP ${response.status}): ${text}`,
				);
			}
			this.diagnostic = {
				state: "answered",
				operation,
				endpoint: endpoint.href,
				httpStatus,
				observedAt: new Date().toISOString(),
				error: null,
			};
			return envelope.result;
		} catch (error) {
			throw this.failed(
				operation,
				new Error(
					`onboarding control plane ${operation} at ${endpoint.origin}${endpoint.pathname} failed: ${error.message}`,
					{ cause: error },
				),
				endpoint.href,
				httpStatus,
			);
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
