/**
 * What each screen of this journey says, and the actions it offers.
 *
 * The words are held here rather than fetched, so an offline first run reads
 * the same sentences a connected one does, and the bundle is checked against
 * this table: a screen the product cannot render is not a screen it accepts.
 */

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

export { COPY, LOCAL_SCREENS };
