const tokenKey = "las.gui.token";
const locationUrl = new URL(window.location.href);
const suppliedToken = locationUrl.searchParams.get("token");
if (suppliedToken) {
  window.sessionStorage.setItem(tokenKey, suppliedToken);
  locationUrl.searchParams.delete("token");
  window.history.replaceState(null, "", `${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`);
}
const sessionToken = window.sessionStorage.getItem(tokenKey);

const form = document.querySelector("#adopt-form");
const submitButton = document.querySelector("#submit-button");
const requestStatus = document.querySelector("#request-status");
const pathsPanel = document.querySelector("#paths-panel");
const uploadsPanel = document.querySelector("#uploads-panel");
const sourcePaths = document.querySelector("#source-paths");
const sourceFiles = document.querySelector("#source-files");
const fileSummary = document.querySelector("#file-summary");
const resultSection = document.querySelector("#result-section");
const resultStatus = document.querySelector("#result-status");
const resultSummary = document.querySelector("#result-summary");
const resultGroups = document.querySelector("#result-groups");
const catalogPath = document.querySelector("#catalog-path");
const catalogBody = document.querySelector("#catalog-body");

function selectedMode() {
  return form.elements.mode.value;
}

function updateMode() {
  const mode = selectedMode();
  pathsPanel.hidden = mode !== "paths";
  uploadsPanel.hidden = mode !== "uploads";
}

function setBusy(busy, message) {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Validating…" : "Validate and adopt";
  requestStatus.textContent = message;
}

function badge(value, truthy) {
  const span = document.createElement("span");
  span.className = `table-badge ${truthy ? "positive" : "muted"}`;
  span.textContent = value;
  return span;
}

function renderCatalog(catalog) {
  catalogPath.textContent = catalog.path;
  catalogBody.replaceChildren();
  for (const row of catalog.surfaces) {
    const tr = document.createElement("tr");
    const surface = document.createElement("th");
    surface.scope = "row";
    const name = document.createElement("strong");
    name.textContent = row.surface;
    const summary = document.createElement("small");
    summary.textContent = row.summary;
    surface.append(name, summary);

    const registration = document.createElement("td");
    registration.append(badge(row.registration, row.registration === "adopted"));
    const configured = document.createElement("td");
    configured.append(badge(row.configured ? "yes" : "no", row.configured));
    const active = document.createElement("td");
    active.append(badge(row.active ? "yes" : "no", row.active));
    const source = document.createElement("td");
    if (row.source) {
      const sourcePath = document.createElement("span");
      sourcePath.className = "source-path";
      sourcePath.textContent = row.source;
      const sourceEntry = document.createElement("small");
      sourceEntry.textContent = `entry: ${row.sourceEntry}`;
      source.append(sourcePath, sourceEntry);
    } else {
      source.textContent = "—";
    }
    tr.append(surface, registration, configured, active, source);
    catalogBody.append(tr);
  }
}

function renderCatalogError(message) {
  catalogPath.textContent = message;
  catalogBody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = Number("5");
  cell.textContent = `Catalogue readback refused: ${message}`;
  row.append(cell);
  catalogBody.append(row);
}

function resultText(item) {
  const parts = [];
  if (item.surface) parts.push(item.surface);
  if (item.action) parts.push(item.action);
  if (item.entry) parts.push(`entry ${item.entry}`);
  if (item.source) parts.push(item.source);
  if (Array.isArray(item.sources)) parts.push(item.sources.join(" ↔ "));
  if (item.reason) parts.push(item.reason);
  return parts.join(" · ") || "No additional detail";
}

function renderResult(result) {
  resultSection.hidden = false;
  resultStatus.textContent = result.status;
  resultStatus.dataset.status = result.status;
  const counts = ["imported", "unchanged", "conflicting", "rejected"]
    .map((key) => `${result[key].length} ${key}`)
    .join(" · ");
  resultSummary.textContent = `${counts}. Catalogue: ${result.catalogPath}`;
  resultGroups.replaceChildren();

  for (const key of ["imported", "unchanged", "conflicting", "rejected"]) {
    const section = document.createElement("section");
    section.className = "result-group";
    const heading = document.createElement("h3");
    heading.textContent = `${key[0].toUpperCase()}${key.slice(1)} (${result[key].length})`;
    section.append(heading);
    if (result[key].length) {
      const list = document.createElement("ul");
      for (const item of result[key]) {
        const entry = document.createElement("li");
        entry.textContent = resultText(item);
        list.append(entry);
      }
      section.append(list);
    } else {
      const empty = document.createElement("p");
      empty.textContent = "None";
      section.append(empty);
    }
    resultGroups.append(section);
  }
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function api(path, options = {}) {
  if (!sessionToken) throw new Error("This page has no Las GUI session token. Reopen the exact URL printed by `las gui`.");
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.catalogError || `Las GUI request failed with HTTP ${response.status}`);
  return payload;
}

async function readUploads() {
  return Promise.all([...sourceFiles.files].map(async (file) => ({ name: file.name, content: await file.text() })));
}

form.addEventListener("change", (event) => {
  if (event.target.name === "mode") updateMode();
  if (event.target === sourceFiles) {
    const files = [...sourceFiles.files];
    fileSummary.textContent = files.length
      ? files.map((file) => `${file.name} (${file.size.toLocaleString()} bytes)`).join(", ")
      : "No files selected.";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Reading and validating the selected configuration…");
  try {
    const mode = selectedMode();
    const paths = mode === "paths"
      ? sourcePaths.value.split("\n").map((value) => value.trim()).filter(Boolean)
      : [];
    const uploads = mode === "uploads" ? await readUploads() : [];
    if (mode === "paths" && !paths.length) throw new Error("Enter at least one configuration path.");
    if (mode === "uploads" && !uploads.length) throw new Error("Select at least one JSON configuration file.");
    const payload = await api("/api/adopt", {
      method: "POST",
      body: JSON.stringify({ mode, paths, uploads, replace: document.querySelector("#replace").checked }),
    });
    renderResult(payload.result);
    if (payload.catalog) renderCatalog(payload.catalog);
    else renderCatalogError(payload.catalogError || "catalogue readback failed");
    const accepted = payload.result.status === "imported" || payload.result.status === "unchanged";
    setBusy(false, payload.catalog
      ? (accepted
        ? `Adoption ${payload.result.status}. The canonical catalogue readback is current.`
        : `Adoption ${payload.result.status}. Nothing from this batch was written.`)
      : `Adoption ${payload.result.status}. Catalogue readback refused: ${payload.catalogError}`);
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error));
  }
});

updateMode();
setBusy(true, "Reading the current canonical catalogue…");
api("/api/catalog")
  .then(({ catalog }) => {
    renderCatalog(catalog);
    setBusy(false, "Ready. The current catalogue is shown below.");
  })
  .catch((error) => {
    setBusy(false, error instanceof Error ? error.message : String(error));
  });
