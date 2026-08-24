# Onboarding

Las ships one guided first-use journey — `first-use`, version
`2026-08-04.1` — that explains the federation model and completes when the
user makes one real catalogue query. Everything here is implemented in
`src/onboarding.mjs`; the journey is reachable as `las onboarding` on the CLI
and as the `las__onboarding` tool over MCP.

## The journey

Two screens, in order:

1. **`catalogue-model`** — "Understand Las federation". Explanation screen;
   its only action is `las onboarding advance`.
2. **`catalogue-query`** — "Run your first catalogue query". Completes on
   evidence, not on a click: the fact `catalog_query_completed` must become
   true, which happens only when a real catalogue query succeeds — `las list`
   on the CLI or `tools/list` on the MCP server. Both code paths call
   `recordCatalogueQueryCompleted` after answering.

Captured journey (fresh state):

```text
$ las onboarding
Understand Las federation
…
Status: in_progress
Next: las onboarding advance

$ las onboarding advance
Run your first catalogue query
…
Status: in_progress
Next: las list

$ las list          # output elided — the query itself is the evidence
$ las onboarding status
Run your first catalogue query
…
Status: completed
```

## Actions

`las onboarding [action]` and the MCP tool accept exactly `show` (default),
`status`, `advance`, `skip`, `reset`. Refusals:

- `las: unknown onboarding action '<action>'` (exit 1);
- `las: onboarding accepts at most one action` (exit 1);
- over MCP, any argument key other than `action`, or a non-string action:
  `-32600 invalid onboarding arguments`.

`status` is the one action that never starts the journey: with no valid
progress on disk it reports `status: "not_started"` without writing state.
`skip` marks the attempt skipped (unless already completed); `reset` discards
evidence and starts a new attempt with a fresh `attempt_id`.

## State

Progress persists at `$XDG_STATE_HOME/las/onboarding.json` (default
`~/.local/state/las/onboarding.json`), written atomically (temp file + rename,
directory `0700`, file `0600`). Captured after a completed journey:

```json
{
 "schema_version": 1,
 "progress": {
  "status": "completed",
  "current_screen_id": "catalogue-query",
  "completed_screen_ids": ["catalogue-model", "catalogue-query"]
 },
 "evidence": { "catalog_query_completed": true },
 "pending_events": [
  "onboarding_started", "onboarding_step_viewed", "onboarding_step_completed",
  "onboarding_step_viewed", "onboarding_first_action_completed",
  "onboarding_step_completed", "onboarding_first_success_observed",
  "onboarding_completed"
 ]
}
```

(Event entries are full objects; only their names are shown above.) The file
also carries a random `installation_id`, hashed (`sha256("las:<id>")`) into
the `subject_hash` used by every event — no username or hostname is recorded.
A missing or damaged state file falls back to a fresh valid store; it is
advisory product state, and a persistence failure never turns a successful
catalogue query into a failure (`recordCatalogueQueryCompleted` swallows all
errors and returns `false`).

## The journey definition is validated like everything else

The screen graph comes from a bundle — fetched from the control plane when
configured, else the last cached bundle, else the canonical fallback compiled
into the module. Whatever the source, `validateBundle` enforces envelope
integrity (UUID `journey_version_id`, SHA-256 of the canonical definition
matching `content_sha256`), identity (product `las`, journey `first-use`,
version `2026-08-04.1`), and graph sanity (1–128 screens, known screen ids
only — a bundle can reorder or re-gate the two local screens but cannot
inject a new one, because titles and bodies render only from the local copy
deck). Failures: `onboarding bundle envelope is invalid`, `… identity is
invalid`, `… integrity is invalid`, `onboarding screen graph is invalid`,
`onboarding screen is invalid`, `onboarding entry screen is missing`,
`onboarding fallback is missing`, `onboarding transition is invalid`.

## Telemetry is queued, never blocking

Events append to `pending_events` locally first, then flush one at a time to
the control plane — only when both `STADO_INTEGRATION_API_URL` (HTTPS, no
credentials in the URL) and `LAS_STADO_INTEGRATION_TOKEN` are set. Requests
post to `/integration/<cli|mcp>/onboarding/las/<operation>` with a
1500 ms timeout; operations are `bundle.read`, `state.read`,
`experiments.assign`, `events.collect`. A missing, invalid, or failing
control plane leaves events queued and the journey fully usable offline
(`onboarding control plane is unavailable` / `… URL is invalid` / `… rejected
the request` are internal transport errors, never user-facing failures). All
captured runs in these docs executed offline: the state file above shows the
full event queue that would have been flushed.

## Not to be confused with

Onboarding a *user* (this page) is unrelated to onboarding a *surface* —
minting a signed release that admits it, which is
[walkthrough-onboard-a-surface](../walkthrough-onboard-a-surface.md).
