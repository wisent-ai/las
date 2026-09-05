import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { adoptMcpConfigurations, catalogPath, catalogRegistration } from "./catalog.mjs";
import { recordCatalogueAdopted } from "./onboarding.mjs";
import { SURFACES, activeSurfaces, surfaceConfigured } from "./registry.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = Number("8388608");
const MAX_SOURCES = Number("32");
const GUI_ASSETS = new Map([
  ["/", ["./gui/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["./gui/app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["./gui/styles.css", "text/css; charset=utf-8"]],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Type": contentType,
  };
}

function send(response, status, contentType, body) {
  response.writeHead(status, securityHeaders(contentType));
  response.end(body);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value).replaceAll("<", "\\u003c");
  send(response, status, "application/json; charset=utf-8", body);
}

function catalogSnapshot() {
  const active = new Set(activeSurfaces());
  return {
    path: catalogPath(),
    surfaces: SURFACES.map((surface) => {
      const state = catalogRegistration(surface);
      return {
        surface: surface.name,
        summary: surface.summary,
        registration: !state.managed ? "compiled-default" : state.valid ? "adopted" : "absent",
        ...(state.registration ? {
          source: state.registration.sourcePath,
          sourceEntry: state.registration.sourceKey,
        } : {}),
        configured: surfaceConfigured(surface),
        active: active.has(surface),
      };
    }),
  };
}
function catalogReadback() {
  try {
    return { catalog: catalogSnapshot(), catalogError: null };
  } catch (error) {
    return {
      catalog: null,
      catalogError: error instanceof Error ? error.message : String(error),
    };
  }
}


function readRequestJson(request) {
  const declared = request.headers["content-length"];
  if (typeof declared !== "string" || !/^\d+$/.test(declared)) {
    throw Object.assign(new Error("Content-Length is required"), { status: Number("411") });
  }
  if (Number(declared) > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("request exceeds 8 MiB"), { status: Number("413") });
  }
  if (request.headers["content-type"]?.split(";", Number("1"))[Number("0")].trim() !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: Number("415") });
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = Number("0");
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error("request exceeds 8 MiB"), { status: Number("413") }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("request body is not valid JSON"), { status: Number("400") }));
      }
    });
    request.on("error", reject);
  });
}

function guiImportDirectory(sessionId) {
  const root = path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "las", "gui-imports");
  const directory = path.join(root, sessionId);
  mkdirSync(directory, { recursive: true, mode: Number("448") });
  for (const candidate of [root, directory]) {
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(candidate) !== path.resolve(candidate)) {
      throw new Error(`GUI import storage must be a real directory: ${candidate}`);
    }
    chmodSync(candidate, Number("448"));
  }
  return directory;
}

function stageUploads(uploads, sessionId) {
  if (!uploads.length) return [];
  for (const [index, upload] of uploads.entries()) {
    if (!isRecord(upload) || Object.keys(upload).some((key) => key !== "name" && key !== "content")
      || typeof upload.name !== "string" || upload.name.length === Number("0") || upload.name.length > Number("256")
      || typeof upload.content !== "string") {
      throw new Error(`upload ${index + Number("1")} must contain only a file name and text content`);
    }
  }
  const directory = guiImportDirectory(sessionId);
  return uploads.map((upload, index) => {
    const base = path.basename(upload.name).replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(Number("0"), Number("120")) || "mcp.json";
    const target = path.join(directory, `${String(index + Number("1")).padStart(Number("2"), "0")}-${randomUUID()}-${base}`);
    writeFileSync(target, upload.content, { encoding: "utf8", flag: "wx", mode: Number("384") });
    return target;
  });
}

function adoptionSources(body, sessionId) {
  if (!isRecord(body) || Object.keys(body).some((key) => !["mode", "paths", "uploads", "replace"].includes(key))) {
    throw new Error("request must contain only mode, paths, uploads, and replace");
  }
  if (!["discover", "paths", "uploads"].includes(body.mode)) throw new Error("mode must be discover, paths, or uploads");
  if (typeof body.replace !== "boolean") throw new Error("replace must be boolean");
  if (!Array.isArray(body.paths) || !Array.isArray(body.uploads)) throw new Error("paths and uploads must be arrays");
  if (body.paths.length + body.uploads.length > MAX_SOURCES) throw new Error("at most 32 source files may be selected");
  if (body.paths.some((source) => typeof source !== "string" || source.length === Number("0") || source.length > Number("4096"))) {
    throw new Error("every source path must be a non-empty path of at most 4096 characters");
  }
  if (body.mode === "discover") {
    if (body.paths.length || body.uploads.length) throw new Error("discovery mode does not accept explicit sources");
    return [];
  }
  if (body.mode === "paths") {
    if (!body.paths.length || body.uploads.length) throw new Error("path mode requires at least one path and no uploads");
    return body.paths;
  }
  if (!body.uploads.length || body.paths.length) throw new Error("upload mode requires at least one upload and no paths");
  return stageUploads(body.uploads, sessionId);
}

function authorized(request, authority, origin, token, mutation) {
  if (request.headers.host !== authority) return "Host does not match this Las GUI session";
  if (request.headers.authorization !== `Bearer ${token}`) return "session token is missing or invalid";
  if (mutation && request.headers.origin !== origin) return "Origin does not match this Las GUI session";
  return null;
}

export async function startLasGui({ port = Number("0") } = {}) {
  if (!Number.isInteger(port) || port < Number("0") || port > Number("65535")) {
    throw new Error("GUI port must be an integer from 0 through 65535");
  }
  const token = randomBytes(Number("32")).toString("base64url");
  const sessionId = randomUUID();
  let authority;
  let origin;

  const server = createServer((request, response) => {
    void (async () => {
      if (!authority || request.headers.host !== authority) {
        sendJson(response, Number("421"), { error: "Host does not match this Las GUI session" });
        return;
      }
      const url = new URL(request.url || "/", origin);
      if (url.origin !== origin) {
        sendJson(response, Number("421"), { error: "Request target does not match this Las GUI session" });
        return;
      }
      if (request.method === "GET" && GUI_ASSETS.has(url.pathname)) {
        const [asset, contentType] = GUI_ASSETS.get(url.pathname);
        send(response, Number("200"), contentType, readFileSync(new URL(asset, import.meta.url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/catalog") {
        const refusal = authorized(request, authority, origin, token, false);
        if (refusal) {
          sendJson(response, Number("403"), { error: refusal });
          return;
        }
        const readback = catalogReadback();
        sendJson(response, readback.catalog ? Number("200") : Number("409"), readback);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/adopt") {
        const refusal = authorized(request, authority, origin, token, true);
        if (refusal) {
          sendJson(response, Number("403"), { error: refusal });
          return;
        }
        const body = await readRequestJson(request);
        const sources = adoptionSources(body, sessionId);
        const result = adoptMcpConfigurations(SURFACES, { sources, replace: body.replace });
        if (result.status === "imported" || result.status === "unchanged") {
          await recordCatalogueAdopted({
            client: "gui",
            surfaceCount: result.imported.length + result.unchanged.length,
            catalogPath: result.catalogPath,
          });
        }
        sendJson(response, Number("200"), { result, ...catalogReadback() });
        return;
      }
      sendJson(response, Number("404"), { error: "route not found" });
    })().catch((error) => {
      if (response.headersSent || response.destroyed) return;
      sendJson(response, Number.isInteger(error?.status) ? error.status : Number("400"), {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(port, LOOPBACK_HOST);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("GUI server did not expose a TCP address");
  }
  authority = `${LOOPBACK_HOST}:${address.port}`;
  origin = `http://${authority}`;
  return { server, url: `${origin}/?token=${encodeURIComponent(token)}` };
}
