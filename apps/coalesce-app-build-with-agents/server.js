// Build with Agents: a Coalesce workspace app with no dependencies. The watch server runs
// `node server.js` with PORT and WORKSPACE_DIR set and serves it at <app>.localhost.
//
// Each session builds in its own copy of the workspace (like a worktree, but a plain copy, so it
// works without git and includes uncommitted edits). Two copies are taken when a session starts:
// `base`, untouched, and `work`, where the user's own Claude Code writes. Keep applies the
// base→work changes to the real workspace, refusing files that changed there since; Discard
// deletes both copies. Several sessions can run at once.
//
// The agent is the person's own Claude Code or Cortex Code (AGENTS below), run headless once per turn.
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT) || 8455;
const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR || path.resolve(__dirname, "../.."));
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_NAME = "Build with Agents";
// State lives outside the workspace so it never shows up in git or in the Coalesce file watcher.
const STATE_DIR = path.join(
  os.homedir(),
  ".coa",
  "apps",
  "build-with-agents",
  crypto.createHash("sha1").update(WORKSPACE).digest("hex").slice(0, 12)
);
const RUNS_DIR = path.join(STATE_DIR, "runs");
// The person's choices on the Settings and agent pages; shared by every workspace.
const SETTINGS_FILE = path.join(path.dirname(STATE_DIR), "settings.json");

// The coding agents the app can drive. Cortex Code prints the same stream-json as Claude Code and
// loads the same plugin format, so only finding it, its flags and its tool names differ.
const AGENTS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    exe: "claude",
    override: "CLAUDE_PATH",
    authLabel: "Claude Code is signed in",
    authFix: "Run `claude` once in a terminal and sign in.",
  },
  cortex: {
    id: "cortex",
    name: "Cortex Code",
    exe: "cortex",
    override: "CORTEX_PATH",
    // Other tools are also called cortex; this one's --version says "Cortex Code v1.2.46".
    signature: /Cortex Code/i,
    authLabel: "Cortex Code has a Snowflake connection",
    authFix: "Run `cortex` once in a terminal and set up a connection.",
  },
};
// Threads started before there was a choice ran on Claude Code.
const agentOf = (run) => run.agent || "claude";

// The model each agent's last session ran on when the app's Model setting left the choice to it.
const defaultModelFile = (id) => path.join(path.dirname(STATE_DIR), id === "claude" ? "default-model" : `default-model-${id}`);
const defaultModels = {};
for (const id of Object.keys(AGENTS)) {
  try {
    defaultModels[id] = fs.readFileSync(defaultModelFile(id), "utf8").trim();
  } catch {
    // Not seen yet.
  }
}

// Top-level workspace entries the copies and the change list ignore.
const SKIPPED = new Set(["apps", ".git", ".coa", ".claude", ".cortex", "node_modules", ".DS_Store"]);
const TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite", "ToolSearch", "Skill"];
// A thread opens with a plan the person approves before anything is written, so planning turns
// get only the tools that read.
const PLAN_TOOLS = ["Read", "Glob", "Grep", "ToolSearch", "Skill"];
// Cortex Code's names for the same tools. Events use Claude Code's names for both agents.
const TOOL_ALIASES = { read: "Read", write: "Write", edit: "Edit", glob: "Glob", grep: "Grep", system_todo_write: "TodoWrite", tool_search: "ToolSearch", skill: "Skill" };
// Plumbing the person doesn't need a line for. Cortex Code's direct_tool_calling batches other
// calls, and each of those still arrives, and is permission-checked, as a call of its own.
const QUIET_TOOLS = new Set(["ToolSearch", "StructuredOutput", "direct_tool_calling"]);
const cortexNames = (tools) => Object.keys(TOOL_ALIASES).filter((name) => tools.includes(TOOL_ALIASES[name]));
// Headless Cortex Code refuses every tool that isn't allowed, so the allowed list is the boundary.
// These are also taken out of the model's sight so it doesn't spend steps trying them.
const CORTEX_HIDDEN = ["bash", "bash_output", "kill_shell", "sql_execute", "web_fetch", "web_search", "notebook_actions", "data_diff", "fdbt", "task", "ask_user_question", "enter_plan_mode", "exit_plan_mode", "monitor", "cron_create"];
// The guide reaches Cortex Code as a custom agent definition with this name.
const CORTEX_AGENT = "build-with-agents";
// Cortex Code takes the prompt as an argument, and a long spec doesn't fit on every platform's
// command line (Windows allows about 32k characters in all).
const MAX_ARG_PROMPT = 20_000;
// Coalesce Platform Skills, vendored at a pinned release (scripts/update-skills.sh) and loaded as a
// plugin, so they ship and update with the app and work offline.
const SKILLS_DIR = path.join(__dirname, "vendor", "coalesce-platform-skills");
// Opus at medium effort whatever the person's own Claude Code defaults to, so a thread costs the
// same for everyone and a personal switch to a larger model doesn't carry over unnoticed.
// With no agent chosen the app uses whichever is installed (activeAgent). Cortex Code's own default
// model is "auto": Snowflake picks the best one the account can use.
const DEFAULT_SETTINGS = { agent: "", model: "opus", cortexModel: "", effort: "medium", compact: "500k", budgetUsd: 0, maxTurns: 80 };
const SETTING_CHOICES = {
  agent: ["", "claude", "cortex"],
  model: ["", "fable", "opus", "sonnet"],
  cortexModel: ["", "claude-opus-5-5", "claude-sonnet-5-5"],
  effort: ["", "low", "medium", "high", "xhigh", "max"],
  compact: ["500k", "200k", "off"],
  budgetUsd: [0, 2, 5, 10],
  maxTurns: [40, 80, 150],
};
const MAX_FILE_CHARS = 400_000;

const GUIDE = fs.readFileSync(path.join(__dirname, "guide.md"), "utf8");
// Claude Code settings the app owns. Sessions load these and none of the user's own settings
// (`--setting-sources ""`), so a stray hook, plugin or CLAUDE.md on their machine can't change how
// the app behaves. Auth is unaffected: it lives in the keychain, not in settings.
const CLAUDE_SETTINGS = path.join(__dirname, "claude-settings.json");
// Every turn ends with structured output the app renders as an interactive card: a plan while
// planning, a review once the agent has built.
const readSchema = (file) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")));
const REVIEW_SCHEMA = readSchema("review-schema.json");
const PLAN_SCHEMA = readSchema("plan-schema.json");
// A copy installed from the marketplace has `repository` in package.json. Anything else is a
// hand-installed dev copy, which reloads the page when its files change.
const DEV =
  process.env.BUILD_WITH_AGENTS_DEV === "1" ||
  !JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).repository;

// ───────────── helpers ─────────────

const now = () => new Date().toISOString();
const toPosix = (p) => p.split(path.sep).join("/");

function isSkipped(relPath) {
  if (!relPath) return false;
  const parts = toPosix(relPath).split("/");
  return SKIPPED.has(parts[0]) || parts.includes(".DS_Store") || /-plan\.json$/.test(relPath);
}

function exec(cmd, args, { env, timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error) });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function readText(file) {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
}

// ───────────── agents ─────────────

// An app launched from the Dock doesn't inherit the shell's PATH, so ask a login shell for it and
// add the usual install locations. The login shell is slow, so ask once and again only on a recheck.
let pathPromise;
function resolvePath(force = false) {
  if (!pathPromise || force) pathPromise = readPath();
  return pathPromise;
}
async function readPath() {
  const parts = [];
  if (process.platform !== "win32") {
    const shell = process.env.SHELL || "/bin/zsh";
    const r = await exec(shell, ["-ilc", 'printf "__P__%s__P__" "$PATH"'], { timeout: 6000 });
    const m = r.stdout.match(/__P__(.*?)__P__/s);
    if (m) parts.push(...m[1].split(path.delimiter));
  }
  parts.push(...(process.env.PATH || "").split(path.delimiter));
  const home = os.homedir();
  parts.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin");
  return [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

// Ignoring the user's settings also drops their `env` block, which is where Bedrock, Vertex,
// gateway and proxy setups usually live. Carry over only those keys.
const PROVIDER_ENV = /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_SKIP_|AWS_|GOOGLE_|VERTEX_|CLOUD_ML_|HTTPS?_PROXY$|NO_PROXY$|NODE_EXTRA_CA_CERTS$)/i;
async function providerEnv() {
  const raw = await readText(path.join(os.homedir(), ".claude", "settings.json"));
  try {
    const env = (raw && JSON.parse(raw).env) || {};
    return Object.fromEntries(Object.entries(env).filter(([k, v]) => PROVIDER_ENV.test(k) && typeof v === "string"));
  } catch {
    return {};
  }
}

const agentPromises = {};
function findAgent(id, force = false) {
  if (!agentPromises[id] || force) agentPromises[id] = locateAgent(AGENTS[id]);
  return agentPromises[id];
}

// The agent new threads use: the person's choice, or else one that's installed and signed in, or
// failing that just installed, Claude Code first each time. So installing a second agent doesn't
// move someone off the one that works. A thread stays on the agent it started with, since its
// conversation lives in that agent's sessions.
async function activeAgent(force = false) {
  const [settings, ...found] = await Promise.all([readSettings(), findAgent("claude", force), findAgent("cortex", force)]);
  if (settings.agent) return found.find((a) => a.id === settings.agent);
  return found.find((a) => a.found && a.account?.loggedIn) || found.find((a) => a.found) || found[0];
}

async function locateAgent(agent) {
  const PATH = await resolvePath();
  const env = { ...process.env, ...(agent.id === "claude" ? await providerEnv() : {}), PATH, COALESCE_APP: "build-with-agents" };
  delete env.ELECTRON_RUN_AS_NODE;
  // If Coalesce was started from inside a Claude Code session, that session's variables (its id,
  // plugin dirs, messaging socket) would leak into ours. Keep only the ones that choose a provider.
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (/^CLAUDE_CODE_/.test(k) && !PROVIDER_ENV.test(k) && k !== "CLAUDE_CODE_OAUTH_TOKEN") delete env[k];
  const exe = process.platform === "win32" ? `${agent.exe}.exe` : agent.exe;
  const candidates = process.env[agent.override]
    ? [process.env[agent.override]]
    : PATH.split(path.delimiter).map((dir) => path.join(dir, exe));
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    const [r, auth] = await Promise.all([
      exec(candidate, ["--version"], { env, timeout: 20_000 }),
      exec(candidate, agent.id === "cortex" ? ["connections", "list"] : ["auth", "status"], { env, timeout: 20_000 }),
    ]);
    if (r.code !== 0 || (agent.signature && !agent.signature.test(r.stdout))) continue;
    // "2.1.5 (Claude Code)" and "Cortex Code v1.2.46".
    const version = (r.stdout.match(/\d+(?:\.\d+)+/) || [r.stdout.trim()])[0];
    const account = agent.id === "cortex" ? cortexAccount(auth, env) : claudeAccount(auth);
    return { ...agent, found: true, path: candidate, version, env, account };
  }
  return { ...agent, found: false, env };
}

function claudeAccount(auth) {
  try {
    return JSON.parse(auth.stdout);
  } catch {
    // Older versions print text; treat a zero exit as signed in.
    return { loggedIn: auth.code === 0 };
  }
}

// Cortex Code signs in through a Snowflake connection. Having an active one is as far as the app
// checks: trying it could open a browser for single sign-on. A connection that doesn't work shows
// up as an error in the thread. Setup is only held up when there is plainly no connection at all;
// if the list can't be read, or the connection may come from somewhere else (SNOWFLAKE_*
// variables), the check says so and lets the person carry on.
function cortexAccount(list, env) {
  let listed;
  try {
    listed = JSON.parse(list.stdout) || {};
  } catch {
    return { loggedIn: false, unsure: true };
  }
  const connections = listed.connections || {};
  const connection = connections[listed.active_connection];
  if (connection) return { loggedIn: true, connection: listed.active_connection, snowflakeAccount: connection.account, user: connection.user };
  return { loggedIn: false, unsure: Object.keys(connections).length > 0 || Boolean(env.SNOWFLAKE_ACCOUNT) };
}

// A claude.ai login on Anthropic's own API bills against a plan (Pro, Max, Team, Enterprise), so
// per-thread dollar figures would be estimates nobody pays. API keys, Console logins, Bedrock and
// Vertex bill by usage, where those figures are real.
function billsByUsage(account) {
  return !(account?.authMethod === "claude.ai" && (account.apiProvider || "firstParty") === "firstParty");
}

// ───────────── skills and connectors ─────────────

// The vendored plugin's name, version and skills, read from the files Claude loads.
async function skillsInfo() {
  try {
    const manifest = JSON.parse(await fsp.readFile(path.join(SKILLS_DIR, ".claude-plugin", "plugin.json"), "utf8"));
    const dirs = await fsp.readdir(path.join(SKILLS_DIR, "skills"));
    const items = [];
    for (const dir of dirs.sort()) {
      const text = await readText(path.join(SKILLS_DIR, "skills", dir, "SKILL.md"));
      const front = text?.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
      const description = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
      items.push({ name: dir, description });
    }
    return { name: manifest.displayName || manifest.name, version: manifest.version, homepage: manifest.homepage, items };
  } catch {
    return null;
  }
}

// The person's MCP servers and claude.ai connectors, as `claude mcp list` reports them. It
// health-checks every server, which takes a while, so the answer is cached for a few minutes.
let connectorsCache = null;
async function listConnectors(force) {
  if (connectorsCache && !force && Date.now() - connectorsCache.at < 5 * 60_000) return connectorsCache.value;
  const claude = await findAgent("claude");
  if (!claude.found) return { items: [], error: "Claude Code isn't installed." };
  const r = await exec(claude.path, ["mcp", "list"], { env: claude.env, timeout: 90_000 });
  const items = [];
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(.+?): (\S.*?) - (✔|✓|✗|✘|!|⏸)\s*(.*)$/);
    if (!m) continue;
    const [, rawName, target, mark, status] = m;
    const viaClaudeAi = rawName.startsWith("claude.ai ");
    items.push({
      name: rawName.replace(/^claude\.ai /, ""),
      source: viaClaudeAi ? "claude.ai" : "local",
      target: viaClaudeAi ? "" : target,
      state: mark === "✔" || mark === "✓" ? "connected" : mark === "!" ? "auth" : mark === "⏸" ? "pending" : "failed",
      status: status.trim(),
    });
  }
  const value = { items, error: r.code === 0 ? "" : (r.stderr || "").trim().slice(0, 300) };
  connectorsCache = { at: Date.now(), value };
  return value;
}

// ───────────── settings ─────────────

async function readSettings() {
  try {
    const saved = JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8"));
    const out = { ...DEFAULT_SETTINGS };
    for (const [k, choices] of Object.entries(SETTING_CHOICES)) if (choices.includes(saved[k])) out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(patch) {
  const next = await readSettings();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SETTING_CHOICES[k]) throw httpError(400, `Unknown setting ${k}.`);
    if (!SETTING_CHOICES[k].includes(v)) throw httpError(400, `Unsupported value for ${k}.`);
    next[k] = v;
  }
  await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// The app's Claude Code settings plus the person's compaction choice, as a JSON string for --settings.
async function claudeSettingsJson(settings) {
  const base = JSON.parse(await fsp.readFile(CLAUDE_SETTINGS, "utf8"));
  if (settings.compact === "off") base.autoCompactEnabled = false;
  else base.autoCompactWindow = settings.compact === "200k" ? 200000 : 500000;
  return JSON.stringify(base);
}

// ───────────── workspace ─────────────

async function workspaceSummary() {
  let files = [];
  try {
    files = await fsp.readdir(path.join(WORKSPACE, "nodes"));
  } catch {
    // No nodes yet.
  }
  const counts = new Map();
  const names = [];
  for (const file of files) {
    const m = file.match(/^([^-]+)-(.+)\.(sql|yml)$/);
    if (!m || file.endsWith(".meta.yml")) continue;
    names.push({ location: m[1], name: m[2] });
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let nodeTypes = [];
  try {
    nodeTypes = (await fsp.readdir(path.join(WORKSPACE, "nodeTypes"), { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch {
    // None.
  }
  const hasLocations =
    (await readText(path.join(WORKSPACE, "workspace.yml")))?.includes("locations") ||
    Boolean(await readText(path.join(WORKSPACE, "locations.yml")));
  return {
    name: path.basename(WORKSPACE),
    path: WORKSPACE,
    nodeCount: names.length,
    nodeTypeCount: nodeTypes.length,
    hasLocations: Boolean(hasLocations),
    locations: [...counts].map(([name, count]) => ({ name, count })),
    nodeList: names,
  };
}

async function walk(root, rel = "", out = new Map()) {
  let entries;
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (isSkipped(childRel)) continue;
    if (entry.isDirectory()) await walk(root, childRel, out);
    else if (entry.isFile()) out.set(toPosix(childRel), path.join(root, childRel));
  }
  return out;
}

// Installed packages live in the workspace's .coa cache (the package files plus their index). The copies need them so package node types
// resolve (for Claude to read and for validation); the change list still ignores .coa.
const PACKAGE_CACHE = path.join(".coa", "cache");
// Clones are copy-on-write where the disk supports it (APFS, btrfs) and plain copies elsewhere.
const CLONE = fs.constants.COPYFILE_FICLONE;
async function copyWorkspace(dest) {
  await fsp.cp(WORKSPACE, dest, {
    recursive: true,
    mode: CLONE,
    filter: (src) => !isSkipped(path.relative(WORKSPACE, src)),
  });
  await fsp.cp(path.join(WORKSPACE, PACKAGE_CACHE), path.join(dest, PACKAGE_CACHE), { recursive: true, mode: CLONE }).catch(() => {});
}

function lineCounts(before, after) {
  // Multiset line difference: cheap, and close enough for "+12 −3" badges.
  const bag = new Map();
  for (const line of before.split("\n")) bag.set(line, (bag.get(line) || 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const n = bag.get(line) || 0;
    if (n > 0) bag.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of bag.values()) removed += n;
  return { added, removed };
}

// ───────────── sessions ─────────────

const runs = new Map();

const runDir = (id) => path.join(RUNS_DIR, id);
const baseDir = (id) => path.join(runDir(id), "base");
const workDir = (id) => path.join(runDir(id), "work");
const beforeDir = (id) => path.join(runDir(id), "before-add");
// Where a turn's prompt goes when it's too long to pass to Cortex Code as an argument: inside the
// agent's working directory, in the folder the change list ignores.
const promptFile = (id) => path.join(workDir(id), ".cortex", "prompt.md");

function plain(text) {
  return text.replace(/\*\*|`|^#+\s*|^>\s*/gm, "").replace(/\s+/g, " ").trim();
}

// What the home page shows for a session without loading its events.
function summarize(run) {
  const todos = run.todos || [];
  const active = todos.find((t) => t.status === "in_progress");
  let activity = active ? active.activeForm || active.content : "";
  let preview = "";
  for (let i = run.events.length - 1; i >= 0; i--) {
    const e = run.events[i];
    if (!activity && e.type === "tool") activity = e.writes ? `Writing ${e.target.replace(/^nodes\//, "")}` : "Reading your workspace…";
    if (e.type === "review") {
      preview = e.review.headline || "";
      break;
    }
    if (e.type === "text") {
      preview = plain(e.text).slice(0, 220);
      break;
    }
    if (e.type === "error") {
      preview = e.text.slice(0, 220);
      break;
    }
  }
  return {
    activity: activity || "Starting",
    preview,
    done: todos.filter((t) => t.status === "completed").length,
    total: todos.length,
  };
}

function publicRun(run) {
  const { events, child, clients, refreshTimer, sawResult, stderrTail, pendingTools, stopping, baseIssues, disposed, turnStarted, ...rest } = run;
  return { ...rest, running: Boolean(child), summary: summarize(run) };
}

// A deleted thread writes nothing, so a late timer or turn can't bring its folder back.
async function saveRun(run) {
  if (run.disposed) return;
  await fsp.mkdir(runDir(run.id), { recursive: true });
  const { summary, ...rest } = publicRun(run);
  await fsp.writeFile(path.join(runDir(run.id), "run.json"), JSON.stringify(rest, null, 2));
}

const sseFrame = (event) => `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;

function emit(run, event) {
  const full = { seq: run.events.length, ts: now(), ...event };
  run.events.push(full);
  // Synchronous so lines land in seq order; concurrent async appends can reorder them.
  if (!run.disposed) fs.appendFileSync(path.join(runDir(run.id), "events.jsonl"), JSON.stringify(full) + "\n");
  const payload = sseFrame(full);
  for (const res of run.clients) res.write(payload);
  return full;
}

async function setStatus(run, status) {
  run.status = status;
  run.updatedAt = now();
  emit(run, { type: "status", status, running: Boolean(run.child), phase: run.phase, fixing: Boolean(run.fixing) });
  await saveRun(run);
}

async function computeChanges(run) {
  const [before, after] = await Promise.all([walk(baseDir(run.id)), walk(workDir(run.id))]);
  const changes = [];
  for (const rel of new Set([...before.keys(), ...after.keys()])) {
    const a = before.has(rel) ? await fsp.readFile(before.get(rel), "utf8") : null;
    const b = after.has(rel) ? await fsp.readFile(after.get(rel), "utf8") : null;
    if (a === b) continue;
    const status = a === null ? "added" : b === null ? "deleted" : "modified";
    changes.push({ path: rel, status, ...lineCounts(a || "", b || "") });
  }
  changes.sort((x, y) => x.path.localeCompare(y.path));
  return changes;
}

function scheduleChangeRefresh(run, delay = 250) {
  clearTimeout(run.refreshTimer);
  run.refreshTimer = setTimeout(async () => {
    if (run.status === "kept" || run.status === "discarded" || run.disposed) return;
    try {
      const changes = await computeChanges(run);
      if (run.disposed) return;
      run.changes = changes;
      emit(run, { type: "changes", changes: run.changes });
      await saveRun(run);
    } catch (error) {
      console.error("change refresh failed", error);
    }
  }, delay);
}

function titleFromSpec(spec) {
  const heading = spec.match(/^#+\s*(.+)$/m);
  const first = (heading ? heading[1] : spec.split("\n").find((l) => l.trim()) || "Untitled pipeline").trim();
  return first.length > 64 ? first.slice(0, 61).trimEnd() + "…" : first;
}

function relTo(run, p) {
  if (!p) return "";
  const rel = path.isAbsolute(p) ? path.relative(workDir(run.id), p) : p;
  return toPosix(rel);
}

function describeTool(run, name, input = {}) {
  switch (name) {
    case "Read":
      return { verb: "Read", target: relTo(run, input.file_path) };
    case "Write":
      return { verb: "Wrote", target: relTo(run, input.file_path), writes: true };
    case "Edit":
      return { verb: "Edited", target: relTo(run, input.file_path), writes: true };
    case "Glob":
      return { verb: "Listed", target: input.pattern || "" };
    case "Grep":
      return { verb: "Searched for", target: input.pattern || "" };
    case "Skill":
      return { verb: "Used skill", target: String(input.skill || input.command || "").replace(/^coalesce-platform-skills:/, "") };
    default:
      return { verb: name, target: "" };
  }
}

// Records the model a turn ran on. With no model chosen in the app, it's also the one the person's
// agent defaults to, which the Model setting shows.
function noteModel(run, model) {
  // Cortex Code starts on "auto" and names the model it picked when the turn ends.
  if (!model || model === "auto") return;
  run.model = model;
  const id = agentOf(run);
  if (run.usedDefaultModel && model !== defaultModels[id]) {
    defaultModels[id] = model;
    fsp.writeFile(defaultModelFile(id), model).catch(() => {});
  }
}

function isJsonObject(text) {
  if (!/^\s*\{[\s\S]*\}\s*$/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function handleAgentMessage(run, msg) {
  if (msg.type === "system" && msg.subtype === "init") {
    noteModel(run, msg.model);
    // Counted once the agent has started the session, so a turn that fails before that (bad
    // model, missing auth) doesn't make the next one --resume a session that doesn't exist.
    run.turnCount = (run.turnCount || 0) + 1;
    saveRun(run);
    return;
  }
  if (msg.type === "assistant" && msg.message && Array.isArray(msg.message.content)) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text.trim()) {
        // Cortex Code also sends the structured output as a message; the card shows that.
        if (agentOf(run) !== "cortex" || !isJsonObject(block.text)) emit(run, { type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const name = TOOL_ALIASES[block.name] || block.name;
        if (name === "TodoWrite") {
          run.todos = (block.input.todos || []).map((t) => ({ content: t.content, status: t.status, activeForm: t.activeForm }));
          emit(run, { type: "todos", todos: run.todos });
        } else if (name === "Read" && path.resolve(workDir(run.id), block.input?.file_path || "") === promptFile(run.id)) {
          // The agent picking up its own instructions isn't progress worth a line.
        } else if (!QUIET_TOOLS.has(name)) {
          const d = describeTool(run, name, block.input);
          run.pendingTools.set(block.id, d);
          emit(run, { type: "tool", id: block.id, tool: name, ...d });
        }
      }
    }
    return;
  }
  if (msg.type === "user" && msg.message && Array.isArray(msg.message.content)) {
    for (const block of msg.message.content) {
      if (block.type !== "tool_result") continue;
      const d = run.pendingTools.get(block.tool_use_id);
      run.pendingTools.delete(block.tool_use_id);
      if (block.is_error) {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        emit(run, { type: "tool-error", id: block.tool_use_id, text: text.slice(0, 400) });
      }
      if (d && d.writes) scheduleChangeRefresh(run);
    }
    return;
  }
  if (msg.type === "result") {
    run.sawResult = true;
    // The model that wrote the most, in case a helper model is listed beside it.
    const byOutput = Object.entries(msg.modelUsage || {}).sort((a, b) => (b[1]?.outputTokens || 0) - (a[1]?.outputTokens || 0));
    if (agentOf(run) === "cortex") noteModel(run, byOutput[0]?.[0]);
    // Cortex Code reports no cost: its usage is billed as Snowflake credits.
    run.costUsd = (run.costUsd || 0) + (msg.total_cost_usd || 0);
    if (msg.structured_output && typeof msg.structured_output === "object") {
      const kind = run.phase === "plan" ? "plan" : "review";
      // A request typed without a heading is named by the first plan, not by its cut-off first line.
      const named = msg.structured_output.title?.trim();
      if (kind === "plan" && !run.plan && named && !/^#+\s*\S/m.test(run.spec)) run.title = named.slice(0, 64);
      run[kind] = msg.structured_output;
      emit(run, { type: "review", kind, review: msg.structured_output, title: run.title });
    }
    // Ending on structured output, Cortex Code counts only its last round, so its turn is timed
    // here and its step count left out.
    const cortex = agentOf(run) === "cortex";
    emit(run, {
      type: "result",
      ok: !msg.is_error,
      subtype: msg.subtype,
      costUsd: msg.total_cost_usd,
      turns: cortex ? undefined : msg.num_turns,
      durationMs: cortex ? Date.now() - run.turnStarted : msg.duration_ms,
      text: msg.is_error ? msg.result || (msg.errors || []).join(" ") : undefined,
    });
  }
}

// phase and fixing are written to the run only once the agent starts, so a turn that fails to start
// leaves the thread as it was.
async function startTurn(run, prompt, { phase = run.phase, fixing = false } = {}) {
  const agent = await findAgent(agentOf(run));
  if (!agent.found) throw httpError(424, `${agent.name} isn't installed or couldn't be found.`);
  const settings = await readSettings();
  const planning = phase === "plan";
  const cortex = agent.id === "cortex";
  const args = cortex ? await cortexArgs(run, prompt, settings, planning) : await claudeArgs(run, settings, planning, agent);

  run.usedDefaultModel = !(cortex ? settings.cortexModel : settings.model);
  run.pendingTools = new Map();
  run.sawResult = false;
  run.stopping = false;
  run.stderrTail = "";
  run.turnStarted = Date.now();
  const child = spawn(agent.path, args, { cwd: workDir(run.id), env: agent.env, stdio: ["pipe", "pipe", "pipe"] });
  run.child = child;
  run.phase = phase;
  run.fixing = fixing;
  // Every listener goes on before the first await: an unhandled 'error' (spawn ENOENT, or EPIPE when
  // the agent exits before reading the prompt) would crash the server.
  child.stdin.on("error", () => {});
  child.stdin.end(cortex ? "" : prompt);

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Not a message. Cortex Code prints some failures here as plain text (an unsupported
        // version, say), so keep it for the error the thread shows.
        run.stderrTail = (run.stderrTail + line + "\n").slice(-2000);
        continue;
      }
      // A message in a shape the handler doesn't expect is skipped, not left to take the server down.
      try {
        handleAgentMessage(run, msg);
      } catch (error) {
        console.error("skipping a message the app couldn't read", error);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    run.stderrTail = (run.stderrTail + chunk).slice(-2000);
  });
  const finish = async (code) => {
    if (run.child !== child) return;
    run.child = null;
    if (run.stopping) {
      emit(run, { type: "notice", text: planning ? "Stopped. Reply to have the agent plan again." : "Stopped. What the agent wrote so far is kept in this thread for you to review." });
    } else if (!run.sawResult) {
      const detail = run.stderrTail.trim().split("\n").slice(-3).join(" ");
      emit(run, { type: "error", text: `${agent.name} exited (code ${code}) before finishing.${detail ? " " + detail : ""}` });
    }
    const finished = run.sawResult && !run.stopping;
    run.stopping = false;
    // A plan waits for the person; nothing was written, so there's nothing to validate.
    if (planning) {
      await setStatus(run, "plan");
      return;
    }
    scheduleChangeRefresh(run, 0);
    // Check the nodes with Coalesce's own validator. Problems go back to the agent once per reply;
    // if they survive that, the person sees them next to the review.
    const check = finished ? await validateRun(run).catch(() => null) : null;
    // Stop pressed while the validator ran: report what it found, but don't start a fix round.
    const stopped = run.stopping;
    run.stopping = false;
    if (check) {
      const fixing = check.issues.length > 0 && !run.fixing && !stopped;
      emit(run, { type: "validation", issues: check.issues, fixing });
      if (fixing) {
        try {
          await startTurn(run, `Coalesce's validator (coa validate) found problems in the nodes you wrote:\n${check.issues.map((i) => `- ${i.id}: ${[i.node, i.column].filter(Boolean).join(".")}`).join("\n")}\n\nIts full output follows. Problems in nodes you didn't write were there before; leave those alone.\n\n${check.report}\n\nFix the problems in your nodes, then return the updated review.`, { fixing: true });
          return;
        } catch (error) {
          console.error("fix round failed to start", error);
        }
      }
    }
    await setStatus(run, "review");
  };
  child.on("close", finish);
  child.on("error", (error) => {
    run.stderrTail += String(error);
    finish(-1);
  });
  await setStatus(run, "running");
}

async function claudeArgs(run, settings, planning, claude) {
  const tools = (planning ? PLAN_TOOLS : TOOLS).join(",");
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--setting-sources", "",
    "--settings", await claudeSettingsJson(settings),
    "--strict-mcp-config",
    "--plugin-dir", SKILLS_DIR,
    "--permission-mode", "acceptEdits",
    "--max-turns", String(settings.maxTurns),
    "--append-system-prompt", GUIDE,
    "--json-schema", planning ? PLAN_SCHEMA : REVIEW_SCHEMA,
    "--tools", tools,
    "--allowedTools", tools,
  ];
  // The first turn fixes the session id, so the session is ours to find from the start; later turns
  // resume it. The name tags it in `claude --resume` pickers, and the working directory (under
  // ~/.coa/apps/build-with-agents) groups every app session in one Claude Code project.
  if (settings.model) args.push("--model", settings.model);
  if (settings.effort) args.push("--effort", settings.effort);
  if (settings.budgetUsd && billsByUsage(claude.account)) args.push("--max-budget-usd", String(settings.budgetUsd));
  if (run.turnCount) args.push("--resume", run.sessionId);
  else args.push("--session-id", run.sessionId, "--name", `${APP_NAME}: ${run.title}`);
  return args;
}

// Cortex Code takes the same schema, plugin and session flags as Claude Code. What differs: the
// prompt is an argument, the guide arrives as a custom agent definition (there is no flag for extra
// system instructions), and the person's own skills, plugins and MCP servers are each switched off
// by a flag of their own.
async function cortexArgs(run, prompt, settings, planning) {
  // Written every turn so a thread picks up the guide of the app version it resumes on. It lives
  // in the thread's copy, under a folder the change list ignores.
  const definition = path.join(workDir(run.id), ".cortex", "agents", `${CORTEX_AGENT}.md`);
  await fsp.mkdir(path.dirname(definition), { recursive: true });
  await fsp.writeFile(definition, `---\nname: ${CORTEX_AGENT}\ndescription: "The agent behind ${APP_NAME}."\n---\n\n${GUIDE}`);
  if (prompt.length > MAX_ARG_PROMPT) {
    await fsp.writeFile(promptFile(run.id), prompt);
    prompt = `Your instructions for this turn are in ${promptFile(run.id)}. Read that file now and follow it.`;
  }
  const allowed = cortexNames(planning ? PLAN_TOOLS : TOOLS);
  const hidden = [...CORTEX_HIDDEN, ...cortexNames(TOOLS).filter((name) => !allowed.includes(name))];
  const args = [
    // One argument with "=", so a prompt that starts with a dash isn't read as a flag.
    `--print=${prompt}`,
    "--output-format", "stream-json",
    "--setting-sources", "",
    "--no-mcp",
    "--only-explicit-skills",
    "--only-explicit-plugins",
    "--plugin-dir", SKILLS_DIR,
    "--agent", CORTEX_AGENT,
    "--max-turns", String(settings.maxTurns),
    "--json-schema", planning ? PLAN_SCHEMA : REVIEW_SCHEMA,
    "--allowed-tools", allowed.join(","),
    "--disallowed-tools", hidden.join(","),
  ];
  if (settings.cortexModel) args.push("--model", settings.cortexModel);
  if (settings.effort) args.push("--effort", settings.effort);
  if (run.turnCount) args.push("--resume", run.sessionId);
  else args.push("--session-id", run.sessionId, "--session-name", `${APP_NAME}: ${run.title}`);
  return args;
}

// ───────────── validation ─────────────

// Under `coa serve` the app's parent process is coa itself; otherwise look for it on the PATH.
// COA_BIN overrides both.
async function parentCoa() {
  const args = (await exec("ps", ["-o", "args=", "-p", String(process.ppid)])).stdout.trim().split(/\s+/);
  const script = args.find((a) => /(^|\/)coa(\.js)?$/.test(a));
  if (!script || path.isAbsolute(script)) return script || null;
  const cwd = ((await exec("lsof", ["-a", "-d", "cwd", "-p", String(process.ppid), "-Fn"])).stdout.match(/^n(.+)$/m) || [])[1];
  return cwd ? path.resolve(cwd, script) : null;
}

let coaPromise;
// A miss isn't remembered, so installing coa takes effect without restarting the app.
const findCoa = () => (coaPromise ||= locateCoa().then((coa) => coa || (coaPromise = null)));
async function locateCoa() {
  const env = { ...process.env, PATH: await resolvePath() };
  for (const candidate of [process.env.COA_BIN, await parentCoa().catch(() => null), "coa"]) {
    if (!candidate) continue;
    const cmd = candidate.endsWith(".js") ? [process.execPath, candidate] : [candidate];
    const r = await exec(cmd[0], [...cmd.slice(1), "--version"], { env, timeout: 15_000 });
    if (r.code === 0) return { cmd, env, version: r.stdout.trim().split("\n").pop() };
  }
  return null;
}

async function coaValidate(dir, json = true) {
  const coa = await findCoa();
  if (!coa) return null;
  const r = await exec(coa.cmd[0], [...coa.cmd.slice(1), "validate", "-d", dir, ...(json ? ["--json"] : [])], { env: coa.env, timeout: 60_000 });
  if (!json) return (r.stdout + r.stderr).trim();
  const data = JSON.parse(r.stdout).data;
  const issues = (data.occurrences || []).map((o) => ({
    id: o.conditionId,
    node: o.target?.nodeName || "",
    column: o.target?.columnName || "",
    blocks: (o.impacts || []).some((i) => i.outcome === "blocked"),
  }));
  for (const f of data.schemaValidation?.results || []) {
    if (f.valid === false || f.status === "failed") issues.push({ id: "fileFormatInvalid", node: path.basename(f.file || f.path || ""), column: "", blocks: true });
  }
  return issues;
}

// Problems in the thread's copy that the workspace didn't already have when the thread started.
async function validateRun(run) {
  const [baseIssues, now] = await Promise.all([run.baseIssues || coaValidate(baseDir(run.id)), coaValidate(workDir(run.id))]);
  run.baseIssues = baseIssues;
  if (!run.baseIssues || !now) return null;
  const key = (i) => `${i.id}|${i.node}|${i.column}`;
  const before = new Set(run.baseIssues.map(key));
  const issues = now.filter((i) => !before.has(key(i)));
  return { issues, report: issues.length ? (await coaValidate(workDir(run.id), false)).slice(0, 6000) : "" };
}

async function createRun(spec) {
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + crypto.randomBytes(3).toString("hex");
  const run = {
    id,
    agent: (await activeAgent()).id,
    title: titleFromSpec(spec),
    spec,
    status: "running",
    createdAt: now(),
    updatedAt: now(),
    sessionId: crypto.randomUUID(),
    turnCount: 0,
    costUsd: 0,
    todos: [],
    changes: [],
    events: [],
    clients: new Set(),
    child: null,
  };
  runs.set(id, run);
  try {
    await fsp.mkdir(runDir(id), { recursive: true });
    await Promise.all([copyWorkspace(baseDir(id)), copyWorkspace(workDir(id))]);
    // Validate the starting copy while the agent plans, so the first build's check only runs once.
    run.baseIssues = coaValidate(baseDir(id)).catch(() => null);
    emit(run, { type: "user", text: spec, kind: "spec" });
    const prompt = `Plan the pipeline this spec describes, in the Coalesce workspace in the current directory. Read what you need, but don't write anything yet: the person approves the plan first.\n\n<spec>\n${spec}\n</spec>`;
    await startTurn(run, prompt, { phase: "plan" });
  } catch (error) {
    // Don't leave a thread stuck at "running" with no agent behind it.
    runs.delete(id);
    await fsp.rm(runDir(id), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return run;
}

// A reply revises the plan while there is one to approve, and asks for changes once it's built.
async function followUp(run, text) {
  if (run.child) throw httpError(409, "The agent is still working.");
  if (run.status !== "review" && run.status !== "plan") throw httpError(409, "This thread is closed.");
  emit(run, { type: "user", text, kind: "message" });
  await startTurn(run, run.phase === "plan" ? `${text}\n\nRevise the plan; don't write anything yet.` : text);
}

async function approvePlan(run, changes) {
  if (run.child) throw httpError(409, "The agent is still working.");
  if (run.status !== "plan") throw httpError(409, "There's no plan waiting for approval.");
  emit(run, { type: "user", text: changes || "", kind: "approve" });
  const prompt = `The plan is approved${changes ? ", with these changes" : ""}. Build it now.${changes ? `\n\n${changes}` : ""}`;
  await startTurn(run, prompt, { phase: "build" });
}

async function copyInto(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

// Puts a workspace file back the way it was before the thread was applied: the saved original if
// the thread replaced one, otherwise nothing.
function restoreOriginal(run, rel, replaced) {
  const target = path.join(WORKSPACE, rel);
  return replaced.includes(rel) ? copyInto(path.join(beforeDir(run.id), rel), target) : fsp.rm(target, { force: true });
}

async function keepRun(run, force) {
  if (run.child) throw httpError(409, "Stop the agent before adding the changes.");
  if (run.status !== "review") throw httpError(409, "This thread is closed.");
  const changes = await computeChanges(run);
  // A file the user changed in the workspace since this thread started is a conflict.
  const files = await Promise.all(changes.map(async (c) => {
    const [inWorkspace, base, work] = await Promise.all([
      readText(path.join(WORKSPACE, c.path)),
      readText(path.join(baseDir(run.id), c.path)),
      readText(path.join(workDir(run.id), c.path)),
    ]);
    return { rel: c.path, exists: inWorkspace !== null, conflict: inWorkspace !== base && inWorkspace !== work };
  }));
  const conflicts = files.filter((f) => f.conflict).map((f) => f.rel);
  if (conflicts.length && !force) {
    throw Object.assign(httpError(409, "Some files changed in your workspace since this thread started."), { conflicts });
  }
  // Save what the workspace had so the add can be undone.
  await fsp.rm(beforeDir(run.id), { recursive: true, force: true });
  const replaced = files.filter((f) => f.exists).map((f) => f.rel);
  for (const rel of replaced) await copyInto(path.join(WORKSPACE, rel), path.join(beforeDir(run.id), rel));
  // All or nothing: if a copy fails partway, put back what was already applied.
  const applied = [];
  try {
    for (const c of changes) {
      const target = path.join(WORKSPACE, c.path);
      applied.push(c.path);
      if (c.status === "deleted") {
        await fsp.rm(target, { force: true });
      } else {
        await copyInto(path.join(workDir(run.id), c.path), target);
      }
    }
  } catch (error) {
    for (const rel of applied) await restoreOriginal(run, rel, replaced).catch(() => {});
    throw error;
  }
  run.changes = changes;
  emit(run, { type: "changes", changes });
  run.added = { at: now(), replaced };
  emit(run, { type: "notice", text: `Applied ${changes.length} file${changes.length === 1 ? "" : "s"} to your workspace. Nothing is committed yet.` });
  await setStatus(run, "kept");
}

// Paths under the workspace that git sees as changed or new, or null when the workspace isn't in a
// git repository (or git isn't installed).
async function uncommittedPaths(paths) {
  const git = (...args) => exec("git", ["-C", WORKSPACE, ...args], { timeout: 8000 });
  const prefix = await git("rev-parse", "--show-prefix");
  if (prefix.code !== 0) return null;
  const status = await git("status", "--porcelain", "-z", "--no-renames", "-uall", "--", ...(paths.length ? paths : ["."]));
  if (status.code !== 0) return null;
  const root = prefix.stdout.trim();
  return new Set(status.stdout.split("\0").filter(Boolean).map((entry) => {
    const rel = entry.slice(3);
    return rel.startsWith(root) ? rel.slice(root.length) : rel;
  }));
}

// Where an added thread's files stand in the workspace now. A file is "edited" when it no longer
// matches what Claude wrote, "committed" when it matches and git has nothing pending for it.
async function landing(run) {
  if (run.status !== "kept") throw httpError(409, "This thread's files aren't in the workspace.");
  const dirty = await uncommittedPaths((run.changes || []).map((c) => c.path));
  const files = await Promise.all((run.changes || []).map(async (c) => {
    const [inWorkspace, work] = await Promise.all([readText(path.join(WORKSPACE, c.path)), readText(path.join(workDir(run.id), c.path))]);
    const state = inWorkspace !== work ? "edited" : dirty && !dirty.has(c.path) ? "committed" : "uncommitted";
    return { path: c.path, state };
  }));
  const count = (state) => files.filter((f) => f.state === state).length;
  return {
    git: Boolean(dirty),
    uncommitted: count("uncommitted"),
    edited: count("edited"),
    // Undo needs the saved originals and files nobody has touched or committed since.
    canUndo: Boolean(run.added) && files.every((f) => f.state === "uncommitted"),
  };
}

async function undoAdd(run) {
  const state = await landing(run);
  if (!state.canUndo) throw httpError(409, "These files were committed or edited after they were added, so they can't be removed automatically.");
  for (const c of run.changes) await restoreOriginal(run, c.path, run.added.replaced);
  delete run.added;
  emit(run, { type: "notice", text: "Removed from your workspace. The thread is open again." });
  await setStatus(run, "review");
}

async function discardRun(run) {
  if (run.child) throw httpError(409, "Stop the agent before discarding.");
  if (run.status !== "review" && run.status !== "plan") throw httpError(409, "This thread is closed.");
  await Promise.all([
    fsp.rm(baseDir(run.id), { recursive: true, force: true }),
    fsp.rm(workDir(run.id), { recursive: true, force: true }),
  ]);
  emit(run, { type: "notice", text: "Discarded. Your workspace was never changed." });
  await setStatus(run, "discarded");
}

// Removes the thread from the app: its history, plan and private copy. Files it already added
// stay in the workspace; deleting a thread never touches the workspace.
async function deleteRun(run) {
  if (run.child || run.status === "running") throw httpError(409, "Stop the agent before deleting this thread.");
  run.disposed = true;
  clearTimeout(run.refreshTimer);
  for (const client of run.clients) client.end();
  runs.delete(run.id);
  await fsp.rm(runDir(run.id), { recursive: true, force: true });
}

async function readChange(run, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (isSkipped(safe)) throw httpError(400, "Not a workspace file.");
  if (run.status === "discarded") throw httpError(410, "This session was discarded.");
  const read = async (file) => {
    const text = await readText(file);
    return text && text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) : text;
  };
  return {
    path: toPosix(safe),
    before: await read(path.join(baseDir(run.id), safe)),
    after: await read(path.join(workDir(run.id), safe)),
  };
}

async function loadRuns() {
  let ids = [];
  try {
    ids = await fsp.readdir(RUNS_DIR);
  } catch {
    return;
  }
  await Promise.all(ids.map(async (id) => {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(runDir(id), "run.json"), "utf8"));
      const lines = ((await readText(path.join(runDir(id), "events.jsonl"))) || "").split("\n");
      // Skip a line cut short by a crash, and repair order and seq for files written by older versions.
      const events = lines
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
        .sort((a, b) => a.seq - b.seq)
        .map((e, seq) => ({ ...e, seq }));
      const run = { ...meta, events, clients: new Set(), child: null };
      runs.set(id, run);
      if (run.status === "running") {
        const planning = run.phase === "plan";
        emit(run, { type: "error", text: planning ? "The app restarted while the agent was planning. Reply to have it plan again." : "The app restarted while the agent was working. Review what was written, or reply to continue." });
        run.status = planning ? "plan" : "review";
        await saveRun(run);
      }
    } catch (error) {
      console.error("skipping unreadable session", id, error.message);
    }
  }));
}

// ───────────── setup checks ─────────────

function setupChecks(agent, ws) {
  const account = agent.account || {};
  const signedIn = agent.found && account.loggedIn;
  const via = account.connection ? [account.user, account.snowflakeAccount].filter(Boolean).join(" on ") : account.email || account.authMethod || account.apiProvider;
  const unsure = Boolean(agent.found && !signedIn && account.unsure);
  return [
    {
      id: "agent",
      label: `${agent.name} is installed`,
      ok: agent.found,
      detail: agent.found ? `Version ${agent.version}` : "Install it, then check again.",
      help: agent.found ? "" : "install",
    },
    {
      id: "auth",
      label: agent.authLabel,
      ok: Boolean(signedIn),
      optional: unsure || undefined,
      detail: signedIn ? (via ? `As ${via}` : "Signed in") : unsure ? "Couldn't confirm one. If `cortex` works in your terminal, carry on." : agent.found ? agent.authFix : `Needs ${agent.name} first.`,
      help: signedIn || unsure ? "" : "login",
    },
    {
      id: "nodes",
      label: "The workspace has sources to build from",
      ok: ws.nodeCount > 0,
      detail: ws.nodeCount ? `${ws.nodeCount} nodes in ${ws.name}` : "Add your source tables in Coalesce first.",
      help: ws.nodeCount ? "" : "sources",
    },
    {
      id: "locations",
      label: "Storage locations are set",
      ok: ws.hasLocations,
      detail: ws.hasLocations ? (ws.locations.map((l) => l.name).join(", ") || "Set") : "Add them in Build Settings › Storage Locations.",
      help: ws.hasLocations ? "" : "locations",
    },
    {
      id: "nodeTypes",
      label: "Node types are available",
      ok: ws.nodeTypeCount > 0,
      optional: true,
      detail: ws.nodeTypeCount ? `${ws.nodeTypeCount} in the workspace` : "Install a node type package from Build Settings › Packages.",
      help: ws.nodeTypeCount ? "" : "nodeTypes",
    },
  ];
}

// ───────────── HTTP ─────────────

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw httpError(413, "Too large.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw httpError(400, "Invalid JSON.");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: "Not found" });
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function streamEvents(req, res, run, after) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const lastId = Number(req.headers["last-event-id"]);
  const from = Number.isFinite(lastId) ? lastId + 1 : after;
  for (const event of run.events.slice(from)) res.write(sseFrame(event));
  run.clients.add(res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    run.clients.delete(res);
  });
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = p.match(/^\/api\/runs\/([\w-]+)(?:\/([\w-]+))?$/);
  const run = m ? runs.get(m[1]) : undefined;
  if (m && !run) throw httpError(404, "No such session.");

  if (p === "/api/status" && req.method === "GET") {
    const recheck = url.searchParams.has("recheck");
    if (recheck) resolvePath(true);
    const [agent, ws] = await Promise.all([activeAgent(recheck), workspaceSummary()]);
    const [claude, cortex] = await Promise.all([findAgent("claude"), findAgent("cortex")]);
    const checks = setupChecks(agent, ws);
    const a = agent.account;
    return sendJson(res, 200, {
      dev: DEV,
      ready: checks.every((c) => c.ok || c.optional),
      checks,
      agent: {
        id: agent.id,
        name: agent.name,
        found: agent.found,
        version: agent.version,
        signedIn: Boolean(a && a.loggedIn),
        unsure: Boolean(a && a.unsure),
        account: !a
          ? null
          : agent.id === "cortex"
            ? { connection: a.connection, snowflakeAccount: a.snowflakeAccount, user: a.user }
            : { email: a.email, plan: a.subscriptionType, method: a.authMethod, provider: a.apiProvider, org: a.orgName },
      },
      agents: [claude, cortex].map((x) => ({ id: x.id, name: x.name, found: x.found })),
      // Only Claude Code reports dollar costs, so this is about its account whichever agent is in use.
      billing: billsByUsage(claude.account) ? "usage" : "plan",
      defaultModel: defaultModels[agent.id] || "",
      storage: STATE_DIR,
      workspace: ws,
    });
  }
  if (p === "/api/skills" && req.method === "GET") return sendJson(res, 200, await skillsInfo());
  if (p === "/api/connectors" && req.method === "GET") return sendJson(res, 200, await listConnectors(url.searchParams.has("refresh")));
  if (p === "/api/settings" && req.method === "GET") return sendJson(res, 200, await readSettings());
  if (p === "/api/settings" && req.method === "PUT") return sendJson(res, 200, await writeSettings(await readBody(req)));
  if (p === "/api/runs" && req.method === "GET") {
    const list = [...runs.values()].map(publicRun).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, list);
  }
  if (p === "/api/runs" && req.method === "POST") {
    const { spec } = await readBody(req);
    if (!spec || !spec.trim()) throw httpError(400, "Describe what you want to build first.");
    return sendJson(res, 201, publicRun(await createRun(spec.trim())));
  }
  if (run && !m[2] && req.method === "GET") return sendJson(res, 200, { ...publicRun(run), events: run.events });
  if (run && !m[2] && req.method === "DELETE") {
    await deleteRun(run);
    return sendJson(res, 200, { ok: true });
  }
  if (run && m[2] === "events" && req.method === "GET") return streamEvents(req, res, run, Number(url.searchParams.get("after")) || 0);
  if (run && m[2] === "messages" && req.method === "POST") {
    const { text } = await readBody(req);
    if (!text || !text.trim()) throw httpError(400, "Write a message first.");
    await followUp(run, text.trim());
    return sendJson(res, 202, publicRun(run));
  }
  if (run && m[2] === "approve" && req.method === "POST") {
    const { changes } = await readBody(req);
    await approvePlan(run, typeof changes === "string" ? changes.trim() : "");
    return sendJson(res, 202, publicRun(run));
  }
  if (run && m[2] === "stop" && req.method === "POST") {
    if (run.child) {
      run.stopping = true;
      run.child.kill("SIGTERM");
    } else if (run.status === "running") {
      // Between turns (the validator is running): keeps the fix round from starting.
      run.stopping = true;
    }
    return sendJson(res, 202, publicRun(run));
  }
  if (run && m[2] === "keep" && req.method === "POST") {
    const { force } = await readBody(req);
    await keepRun(run, Boolean(force));
    return sendJson(res, 200, publicRun(run));
  }
  if (run && m[2] === "landing" && req.method === "GET") return sendJson(res, 200, await landing(run));
  if (run && m[2] === "undo" && req.method === "POST") {
    await undoAdd(run);
    return sendJson(res, 200, publicRun(run));
  }
  if (run && m[2] === "discard" && req.method === "POST") {
    await discardRun(run);
    return sendJson(res, 200, publicRun(run));
  }
  if (run && m[2] === "file" && req.method === "GET") {
    return sendJson(res, 200, await readChange(run, url.searchParams.get("path") || ""));
  }
  if (DEV && p === "/api/dev/ping") return sendJson(res, 200, { ok: true });
  if (DEV && p === "/api/dev/reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" });
    res.write(": dev\n\n");
    devClients.add(res);
    req.on("close", () => devClients.delete(res));
    return;
  }
  if (p.startsWith("/api/")) throw httpError(404, "Not found.");
  return serveStatic(res, p);
}

const devClients = new Set();
function watchForDev() {
  let timer;
  let restart = false;
  fs.watch(__dirname, { recursive: true }, (_event, file) => {
    if (!file || /(^|\/)\./.test(file)) return;
    restart ||= !file.startsWith("public");
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (restart) {
        if ([...runs.values()].some((r) => r.child)) {
          // Don't kill a session mid-build; pick the change up on the next edit.
          console.log("server files changed; not restarting while an agent is working");
          restart = false;
          return;
        }
        // The proxy doesn't pass our socket closing on to the browser, so say it first.
        for (const res of devClients) res.write("event: restart\ndata: {}\n\n");
        console.log("server files changed; exiting so the next request restarts the app");
        setTimeout(() => process.exit(0), 100);
        return;
      }
      for (const res of devClients) res.write("event: reload\ndata: {}\n\n");
    }, 120);
  });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!error.status) console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message, conflicts: error.conflicts });
    else res.end();
  });
});

loadRuns().then(() => {
  // Loopback only: this app writes files. Listen on both families, since the watch server's proxy
  // targets "localhost", which can resolve to either.
  server.listen(PORT, "127.0.0.1", () => console.log(`build-with-agents on ${PORT} for ${WORKSPACE}`));
  const v6 = http.createServer(server.listeners("request")[0]);
  v6.on("error", () => {});
  v6.listen(PORT, "::1");
  activeAgent();
  if (DEV) watchForDev();
});
