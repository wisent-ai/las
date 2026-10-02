// The inverse of adoption: drop the durable registrations of the named
// surfaces, so Las launches those children from the signed registry alone
// again. A surface the catalogue does not hold is refused by name with the
// ones it does, and nothing is written for a refused call.

import { SCHEMA_VERSION, catalogPath, loadCatalog, writeCatalog } from "../catalog.mjs";

export function forgetRegistrations(surfaceNames) {
  const catalog = loadCatalog();
  const result = { status: "rejected", catalogPath: catalogPath(), forgotten: [], rejected: [] };
  if (!surfaceNames.length) {
    result.rejected.push({ reason: "name at least one surface to forget" });
    return result;
  }
  if (catalog === null) {
    result.rejected.push({ reason: "no durable catalogue exists yet; nothing was adopted" });
    return result;
  }
  const held = catalog.registrations.map((registration) => registration.surface);
  for (const name of surfaceNames) {
    if (!held.includes(name)) {
      result.rejected.push({
        surface: name,
        reason: held.length
          ? `the catalogue holds no registration for ${name}; it holds ${held.join(", ")}`
          : `the catalogue holds no registration for ${name}; it is empty`,
      });
    }
  }
  if (result.rejected.length) return result;
  writeCatalog({
    schemaVersion: SCHEMA_VERSION,
    registrations: catalog.registrations.filter((registration) => !surfaceNames.includes(registration.surface)),
  });
  result.forgotten = surfaceNames.map((surface) => ({ surface }));
  result.status = "forgotten";
  return result;
}
