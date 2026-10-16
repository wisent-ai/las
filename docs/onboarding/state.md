# First use and retained state

`las onboarding` starts the shipped first-use journey and `las onboarding
advance` reaches the durable action, `las adopt`. A successful import or an
identical retained registration records `catalogue_adopted`; reading the
screens or running `las list` does not. `las onboarding reset` discards the
recorded journey progress so the same idempotent adoption can complete a new
attempt. `status` only inspects progress. `skip` preserves the current catalogue;
before a first adoption, compiled defaults remain eligible, while an existing
durable catalogue keeps governing eligibility.

The optional onboarding control-plane transport waits for the actual response
however long it takes. A URL that does not parse is refused with the parser's
cause; it must be an HTTPS origin, and credentials, a non-root path, a query or
a fragment are refused by name rather than silently discarded.
HTTP redirects are not followed. Their status and response body remain a named
control-plane failure instead of sending journey data to another destination.
It accepts only an object envelope with `ok: true` and `result`. Failures retain
operation, endpoint, observed HTTP status, parser cause and complete malformed
or rejected body. Local progress remains independent of remote synchronization.

Onboarding CLI and MCP responses expose `control_plane`, including the last
operation, endpoint, observed HTTP status, timestamp and error. An answered
transport is not proof that the journey completed. Local progress and queued
events persist the same observation under `control_plane` in the state file,
including when remote synchronization fails. The GUI's Canonical catalogue
section shows this saved observation under **Onboarding control plane**.
Opening that panel does not send a new request; `not_observed` is not healthy,
and unreadable state is reported with its file and cause.

`node tests/onboarding/state.mjs` qualifies retained-state admission through
the real CLI of the declared revision. Declare `LAS_TEST_SOURCE_REVISION`,
`LAS_TEST_SUCCESS_EXIT` and `LAS_TEST_REFUSAL_EXIT`; the journey takes that
commit's `src/` and `package.json` out of git into its run directory, so other
uncommitted files in the checkout neither reach it nor stop it, and refuses to
run when the journey or `tests/source.mjs` differs from the commit. It creates
local onboarding state and requires malformed
JSON, unsupported schema, invalid installation identity, pending-event queue,
evidence or metadata containers, and actual filesystem read errors to refuse
without replacing retained data. Both status and advance must preserve invalid
bytes; recovery restores the original installation identity.
Optional control-plane configuration is absent. Commands, exit statuses,
complete output, source revision and the original state remain under
`.build/onboarding-state/`; only the run-owned home and state are removed.
This journey does not qualify remote synchronization, catalogue adoption or
graphical rendering.
