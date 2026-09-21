// The federated surfaces las knows: where each child lives, how it is
// launched, and which environment names it may see.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; the signed-release checks and the tool
// authorisation that read this table stay there.

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// las/src/registry -> las/src -> las -> the Wisent workspace root shared by
// every sibling project.
const ROOT = path.resolve(HERE, "..", "..", "..");


// One entry per federated surface. `command`+`args` launch that surface's MCP
// server; `cwd` is its project root; `summary` is a one-line human hint.
export const SURFACES = [
  {
    name: "weles",
    command: process.execPath,
    args: [path.join(ROOT, "weles", "dist", "mcp.js")],
    cwd: path.join(ROOT, "weles"),
    summary: "Anti-detect browser automation. Runs only on its dedicated host.",
    envAllowlist: [],
  },
  {
    name: "skarbiec",
    command: path.join(
      ROOT,
      "entitlements-rotator",
      "target",
      "release",
      "skarbiec-entitlements-router",
    ),
    args: ["mcp"],
    cwd: path.join(ROOT, "entitlements-rotator"),
    summary: "Credential capability broker. Opaque grants only; redemption is workload-bound over AF_UNIX.",
    allowTools: ["health", "capability_available", "capability_request"],
    envAllowlist: [
      "SKARBIEC_CAP_POLICY",
      "SKARBIEC_CAP_POLICY_SIG",
      "SKARBIEC_CAP_TRUST_ROOT",
      "SKARBIEC_WORKLOAD_REGISTRY",
      "SKARBIEC_WORKLOAD_REGISTRY_SIG",
      "SKARBIEC_CAP_STATE",
      "SKARBIEC_CAP_SOCKET",
      "SKARBIEC_WORM_RECEIPT_DIR",
      "SKARBIEC_WORM_CHECKPOINT",
      "SKARBIEC_WORM_RECEIPT_COMMAND",
      "SKARBIEC_MCP_AGENT_ID",
    ],
  },
  {
    name: "tama",
    command: process.execPath,
    args: [path.join(ROOT, "hooks-rotator", "src", "mcp-server.mjs")],
    cwd: path.join(ROOT, "hooks-rotator"),
    summary: "Adaptive hook enforcement. Catalog, source inspection, validation, and documentation; runtime policy remains fail-safe.",
    allowTools: [
      "list_hooks",
      "show_hook",
      "read_hook_source",
      "validate_hooks",
      "render_hook_docs",
    ],
    envAllowlist: [],
  },
  {
    name: "stado",
    command: "/usr/bin/python3",
    args: ["-m", "stado.mcp.server"],
    cwd: path.join(ROOT, "wisent-compute"),
    summary: "GPU job queue. Read-only status, cost, quota, schedules.",
    envAllowlist: [
      "COMPUTE_API_URL",
      "GCP_PROJECT",
      "GCP_REGION",
      "GCP_REGIONS",
      "WC_BUCKET",
      "WC_PROVIDERS",
      "WC_STORAGE_BACKEND",
    ],
  },
  {
    name: "lem",
    command: path.join(ROOT, "lem-desktop", ".build", "debug", "LemMCP"),
    args: [],
    cwd: path.join(ROOT, "lem-desktop"),
    summary: "Research-paper manager. Read-only registry + provenance.",
    envAllowlist: [],
  },
  {
    name: "echo",
    command: process.execPath,
    args: [path.join(ROOT, "echo", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "echo"),
    summary: "Growth/content dashboard. Read-only Supabase reads.",
    envAllowlist: ["NEXT_PUBLIC_SUPABASE_URL"],
  },
  {
    name: "most",
    command: "/usr/bin/python3",
    args: [path.join(ROOT, "most", "most_agent", "mcp_server.py")],
    cwd: path.join(ROOT, "most"),
    summary: "iMessage/RCS/SMS bridge. Read-only health + diagnostics.",
    envAllowlist: ["MOST_BASE_URL"],
  },
  {
    name: "probierz",
    command: process.execPath,
    args: [path.join(ROOT, "probierz", "agent", "mcp.mjs")],
    cwd: path.join(ROOT, "probierz"),
    summary: "Cross-platform test toolkit. Discovery (surfaces/specs) + toolchain check/setup + change-driven ci: select targets a change affects, run the ready ones (recording video/trace/screenshots), analyze the verdict.",
    envAllowlist: [
      "ANDROID_HOME",
      "ANDROID_SDK_ROOT",
      "APPIUM_HOME",
      "APP_IOS",
      "BUNDLE_ID",
      "IOS_DEVICE",
      "IOS_VERSION",
      "PLAYWRIGHT_BROWSERS_PATH",
    ],
  },
  {
    name: "byk",
    command: path.join(ROOT, "swiatowid", ".build", "debug", "oko-mcp"),
    args: [],
    cwd: path.join(ROOT, "swiatowid"),
    summary: "Founder strategy tool (Oko). Read-only org roster, auto-goals, velocity.",
    envAllowlist: [],
  },
  {
    name: "brama",
    command: path.join(ROOT, "brama", "target", "debug", "brama"),
    args: ["mcp"],
    cwd: path.join(ROOT, "brama"),
    summary: "Multi-provider LLM gateway (formerly model-router). Read-only hardware detect + model list.",
    envAllowlist: [],
  },
  {
    name: "warsztat",
    command: path.join(ROOT, "singularity", "target", "debug", "singularity-repo-mcp"),
    args: [],
    cwd: path.join(ROOT, "singularity"),
    summary: "Policy-gated repository proposals. Never merge, deploy, or restart.",
    allowTools: [
      "workspace_create",
      "workspace_read",
      "workspace_apply_patch",
      "workspace_diff",
      "workspace_seal",
      "workspace_check",
      "commit_create",
      "branch_publish",
      "pull_request_open",
      "proposal_status",
    ],
    envAllowlist: ["LAS_ONLY", "LAS_SKIP"],
  },
  {
    name: "finance",
    command: path.join(ROOT, "singularity", "target", "release", "singularity-finance-mcp"),
    args: [],
    cwd: path.join(ROOT, "singularity"),
    summary: "Policy-bound finance lifecycle with isolated signed execution.",
    envAllowlist: [
      "SINGULARITY_FINANCE_POLICY_FILE",
      "SINGULARITY_FINANCE_ENABLE_LEASE_FILE",
      "SINGULARITY_FINANCE_STATE_DIR",
      "SINGULARITY_FINANCE_VERIFY_KEY_HEX",
      "SINGULARITY_FINANCE_BINARY_SHA256",
      "SINGULARITY_FINANCE_EXECUTOR",
      "SINGULARITY_FINANCE_CUSTODY_URL",
      "SINGULARITY_FINANCE_CUSTODY_TOKEN_FILE",
    ],
  },
];

for (const surface of SURFACES) {
  Object.freeze(surface.args);
  Object.freeze(surface.envAllowlist);
  if (surface.allowTools) Object.freeze(surface.allowTools);
  Object.freeze(surface);
}
Object.freeze(SURFACES);
