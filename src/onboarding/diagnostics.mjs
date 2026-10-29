import { readFileSync } from "node:fs";
import { STATE_PATH } from "./journey/contract.mjs";
import { isRecord } from "./journey/bundle.mjs";

// What a failed read of the persisted observation says: no state file yet is
// not observed; any other failure is unreadable with its cause.
function readFailure(error) {
	if (error.code === "ENOENT") return { state: "not_observed" };
	return {
		state: "unreadable",
		error: `reading onboarding diagnostics at ${STATE_PATH}: ${error.message}`,
	};
}

// Read only the last persisted observation; this does not contact the control plane.
export function onboardingControlPlane() {
	try {
		const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		if (!isRecord(state)) throw new Error("onboarding state must be an object");
		// No observation yet is said as such; one that is recorded in another
		// shape is unreadable, never reported as not observed.
		if (state.control_plane === undefined) return { state: "not_observed" };
		if (!isRecord(state.control_plane)) {
			throw new Error(
				`control_plane must be an object, found ${JSON.stringify(state.control_plane)}`,
			);
		}
		return state.control_plane;
	} catch (error) {
		return readFailure(error);
	}
}
