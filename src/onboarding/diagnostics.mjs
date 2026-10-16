import { readFileSync } from "node:fs";
import { STATE_PATH } from "./journey/contract.mjs";
import { isRecord } from "./journey/bundle.mjs";

// Read only the last persisted observation; this does not contact the control plane.
export function onboardingControlPlane() {
	try {
		const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		if (!isRecord(state)) throw new Error("onboarding state must be an object");
		return isRecord(state.control_plane)
			? state.control_plane
			: { state: "not_observed" };
	} catch (error) {
		if (error.code === "ENOENT") return { state: "not_observed" };
		return {
			state: "unreadable",
			error: `reading onboarding diagnostics at ${STATE_PATH}: ${error.message}`,
		};
	}
}
