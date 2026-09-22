/**
 * What this journey is, and the bounds it is read within: the product and
 * journey it belongs to, the version whose definition it must match, the fact
 * that counts as first success, and where the local state is kept.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const PRODUCT_ID = "las";
export const JOURNEY_ID = "first-use";
export const JOURNEY_VERSION = "2026-09-05.1";
export const JOURNEY_VERSION_ID = "ca4c84fd-3de9-47ce-948d-cce351298e6c";
export const FIRST_SUCCESS_FACT = "catalogue_adopted";
export const STATE_PATH = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "las", "onboarding.json");
// The control plane gets a second and a half to record an event; a journey graph has at most
// 128 screens; the state file and its directory are owner-only.
export const REQUEST_TIMEOUT_MS = 1500;
export const MAX_JOURNEY_SCREENS = 128;
export const OWNER_ONLY_DIRECTORY = 0o700;
export const OWNER_ONLY_FILE = 0o600;
export const JSON_INDENT = 2;
