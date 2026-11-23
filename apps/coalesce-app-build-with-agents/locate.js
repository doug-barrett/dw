// Finding a command-line agent the way the person's own terminal would. Kept apart from server.js,
// with the file system, environment and platform passed in, so the Windows rules can be tested on
// any computer.
//
// Windows differs from macOS and Linux in three ways that matter here:
// - A command can be `name.exe`, or a `.cmd`, `.bat` or `.ps1` script, in the order PATHEXT gives.
//   Installers often put only such a script on PATH (Cortex Code's `cortex\bin\cortex.cmd`, npm's
//   `claude.cmd`) and keep the real program elsewhere.
// - Node can't run those scripts directly, and running them through cmd.exe would hand the
//   prompt, which Cortex Code takes as an argument, to cmd.exe's parser. So the app reads the
//   script and runs the program it starts.
// - PATH lives in the registry. A process keeps the PATH it started with, so an agent installed
//   after Coalesce started is only found by reading the registry again.
"use strict";

const path = require("path");

const win = path.win32;
const pathFor = (platform) => (platform === "win32" ? path.win32 : path.posix);

// Windows environment names ignore case, and a copy of process.env keeps whichever case the system
// used ("Path" is common).
function getEnv(env, name) {
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((k) => k.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

// Sets PATH on an environment for a child process. On Windows any "Path" or "path" goes first, so
// the child doesn't get two and pick the stale one.
function withPath(env, value, platform) {
  const out = { ...env };
  if (platform === "win32") for (const k of Object.keys(out)) if (k.toUpperCase() === "PATH") delete out[k];
  out.PATH = value;
  return out;
}

// %NAME% (cmd), $env:NAME and ${env:NAME} (PowerShell). Names that aren't set are left as written.
function expandWindowsVars(text, env) {
  const value = (whole, name) => {
    const v = getEnv(env, name);
    return v === undefined ? whole : v;
  };
  return text
    .replace(/%([A-Za-z_][\w()]*)%/g, value)
    .replace(/\$\{env:([A-Za-z_][\w()]*)\}/gi, value)
    .replace(/\$env:([A-Za-z_]\w*)/gi, value);
}

const RUNNABLE = [".exe", ".com", ".cmd", ".bat", ".ps1"];

// The extensions to try for a bare command name, in PATHEXT's order. PowerShell scripts aren't in
// PATHEXT but PowerShell runs them, so they come last.
function windowsExtensions(pathext) {
  const listed = String(pathext || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => RUNNABLE.includes(e));
  return [...new Set([...listed, ".exe", ".cmd", ".ps1"])];
}

// Store app aliases live here (an old Claude desktop app registers Claude.exe), and running one
// with --version can open a window. No command-line agent installs here.
const WINDOWS_APPS = /[\\/]Microsoft[\\/]WindowsApps[\\/]?$/i;

// Every file a command name could be, directory by directory in PATH order.
function commandCandidates(name, dirs, { platform, pathext } = {}) {
  const p = pathFor(platform);
  const out = [];
  for (const dir of dirs) {
    if (!dir) continue;
    if (platform !== "win32") {
      out.push(p.join(dir, name));
      continue;
    }
    if (WINDOWS_APPS.test(dir)) continue;
    const ext = win.extname(name).toLowerCase();
    if (RUNNABLE.includes(ext)) out.push(win.join(dir, name));
    else for (const e of windowsExtensions(pathext)) out.push(win.join(dir, name + e));
  }
  return dedupe(out, platform);
}

function dedupe(paths, platform) {
  const seen = new Set();
  return paths.filter((x) => {
    const k = platform === "win32" ? x.toLowerCase() : x;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function splitPath(value, platform) {
  return String(value || "")
    .split(platform === "win32" ? ";" : ":")
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

// Where installers put agents when the PATH someone's terminal uses can't be read.
function knownDirs({ platform, env, home }) {
  if (platform !== "win32") return [path.posix.join(home, ".local", "bin"), path.posix.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin"];
  const appData = getEnv(env, "APPDATA") || win.join(home, "AppData", "Roaming");
  const localAppData = getEnv(env, "LOCALAPPDATA") || win.join(home, "AppData", "Local");
  return [
    // Claude Code's PowerShell and CMD installers.
    win.join(home, ".local", "bin"),
    win.join(home, ".claude", "local"),
    // `npm install -g` with npm's default prefix.
    win.join(appData, "npm"),
    // WinGet's links to the programs it installs.
    win.join(localAppData, "Microsoft", "WinGet", "Links"),
    // Cortex Code's PowerShell installer.
    win.join(localAppData, "cortex", "bin"),
    win.join(localAppData, "cortex"),
    win.join(home, "scoop", "shims"),
  ];
}

// Programs kept in versioned folders, newest first: Cortex Code's Windows installer puts
// cortex.exe in %LOCALAPPDATA%\cortex\<version>\.
async function versionedInstalls(root, exe, { readdir, isFile, platform }) {
  const p = pathFor(platform);
  let entries;
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const versions = entries.filter((e) => /^v?\d+(\.\d+)*/.test(e)).sort(compareVersions).reverse();
  const out = [];
  for (const v of versions) {
    const file = p.join(root, v, exe);
    if (await isFile(file)) out.push(file);
  }
  return out;
}

function parseVersion(v) {
  const [withoutBuild, build = ""] = String(v).replace(/^v/i, "").split("+", 2);
  const dash = withoutBuild.indexOf("-");
  const core = dash < 0 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash < 0 ? "" : withoutBuild.slice(dash + 1);
  return { core: core.split("."), pre: pre ? pre.split(".") : [], build: build ? build.split(".") : [] };
}

function compareParts(a, b, missingZero) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? (missingZero ? "0" : "");
    const y = b[i] ?? (missingZero ? "0" : "");
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const core = compareParts(va.core, vb.core, true);
  if (core !== 0) return core;
  // A release sorts after its pre-releases: 1.2.0 after 1.2.0-beta.
  if (va.pre.length !== vb.pre.length && (!va.pre.length || !vb.pre.length)) return va.pre.length ? -1 : 1;
  const pre = compareParts(va.pre, vb.pre, false);
  if (pre !== 0) return pre;
  return compareParts(va.build, vb.build, false);
}

// Programs a launcher script calls on the way to the real one: shells, and Node itself, which
// `resolveCommand` handles on its own.
const NOT_TARGETS = new Set(["cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "where.exe", "node.exe", "node"]);
const SCRIPT_EXT = /\.(c|m)?js$/i;

// The paths a .cmd, .bat or .ps1 launcher names, in the order they appear, with the launcher's own
// folder and environment variables filled in.
function shimPaths(text, shimPath, env) {
  const dir = win.dirname(shimPath);
  const isPs1 = win.extname(shimPath).toLowerCase() === ".ps1";
  const body = String(text).replace(isPs1 ? /^\s*#.*$/gm : /^\s*(?:@?rem(?:\s|$)|::).*$/gim, "");
  const filled = expandWindowsVars(
    body
      // cmd: %~dp0 is the script's folder with a trailing backslash; npm copies it into %dp0%.
      .replace(/%~dp0/gi, () => dir + "\\")
      .replace(/%dp0%/gi, () => dir + "\\")
      // PowerShell: npm's launchers set $basedir to the script's folder.
      .replace(/\$PSScriptRoot\b/gi, () => dir)
      .replace(/\$basedir\b/gi, () => dir),
    env
  );
  const found = [];
  const add = (raw) => {
    // `SET "_prog=C:\...\node.exe"` and `$exe="..."` name a path after an equals sign.
    const s = raw.trim().replace(/^[\w.$]+=/, "");
    if (!/\.(exe|com|cmd|bat|ps1|c?js|mjs)$/i.test(s)) return;
    found.push(win.normalize(win.isAbsolute(s) ? s : win.join(dir, s)));
  };
  // Quoted paths may hold spaces; unquoted ones are taken up to the next space or operator.
  // Match both in one pass so `found` keeps the order they appear in the script.
  const token = /"([^"\r\n]+)"|'([^'\r\n]+)'|((?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/])[^\s"'&|<>()]+)/g;
  let m;
  while ((m = token.exec(filled))) add(m[1] || m[2] || m[3]);
  return found;
}

// Works out what to run for a file found on PATH: { cmd, args } to spawn, or null when it can't be
// run without a shell. `ctx` gives { platform, env, readFile, isFile, findNode }.
async function resolveCommand(file, ctx, depth = 0) {
  if (ctx.platform !== "win32") return { cmd: file, args: [] };
  const ext = win.extname(file).toLowerCase();
  if (ext === ".exe" || ext === ".com") return { cmd: file, args: [] };
  if (!RUNNABLE.includes(ext) || depth > 3) return null;
  const text = await ctx.readFile(file);
  if (text == null) return null;
  const paths = shimPaths(text, file, ctx.env);
  const self = file.toLowerCase();
  // The program a launcher starts is normally the last path it names: npm's put the interpreter
  // first and the script after it, and other launchers name only the program.
  for (const target of [...paths].reverse()) {
    if (target.toLowerCase() === self) continue;
    const base = win.basename(target).toLowerCase();
    if (NOT_TARGETS.has(base)) continue;
    if (!(await ctx.isFile(target))) continue;
    if (SCRIPT_EXT.test(target)) {
      // npm's launchers use a node.exe beside them if there is one, else node from PATH.
      // Checking the launcher's folder directly also covers .ps1 shims (`"$basedir/node$exe"`).
      const sibling = win.join(win.dirname(file), "node.exe");
      let node = null;
      for (const x of [...paths, sibling]) if (!node && win.basename(x).toLowerCase() === "node.exe" && (await ctx.isFile(x))) node = x;
      node ||= await ctx.findNode();
      return node ? { cmd: node, args: [target] } : null;
    }
    const inner = await resolveCommand(target, ctx, depth + 1);
    if (inner) return inner;
  }
  return null;
}

// Every way to run a command, best first, as { cmd, args, foundAt }: an override if one is set, else
// the files PATH leads to, then any versioned installs. Files that can't be run without a shell are
// left out, and so are repeats.
async function findCommands(name, ctx, { dirs = [], override, versionedRoots = [] } = {}) {
  const candidates = override ? [override] : commandCandidates(name, dirs, { platform: ctx.platform, pathext: getEnv(ctx.env, "PATHEXT") });
  if (!override && ctx.platform === "win32") {
    for (const root of versionedRoots) candidates.push(...(await versionedInstalls(root, `${name}.exe`, ctx)));
  }
  const out = [];
  const seen = new Set();
  for (const file of candidates) {
    if (!(await ctx.isFile(file))) continue;
    const run = await resolveCommand(file, ctx);
    if (!run) continue;
    const key = [run.cmd, ...run.args].join("\0");
    const k = ctx.platform === "win32" ? key.toLowerCase() : key;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...run, foundAt: file });
  }
  return out;
}

// PATH as stored in the registry, from `reg query ... /v Path`.
function parseRegQuery(stdout) {
  const m = String(stdout || "").match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/im);
  return m ? m[1] : "";
}

module.exports = {
  getEnv,
  withPath,
  expandWindowsVars,
  windowsExtensions,
  commandCandidates,
  splitPath,
  knownDirs,
  versionedInstalls,
  compareVersions,
  shimPaths,
  resolveCommand,
  findCommands,
  parseRegQuery,
};
