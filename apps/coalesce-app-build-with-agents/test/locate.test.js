// Agent lookup on Windows, run on any computer: the file system is a map of Windows paths.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const locate = require("../locate");

const HOME = "C:\\Users\\pat";
const LOCAL = `${HOME}\\AppData\\Local`;
const ROAMING = `${HOME}\\AppData\\Roaming`;
const ENV = { Path: "C:\\Windows\\System32", PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.JS", LOCALAPPDATA: LOCAL, APPDATA: ROAMING, USERPROFILE: HOME, ComSpec: "C:\\Windows\\system32\\cmd.exe" };

// A Windows file system: paths match without regard to case, like NTFS.
function fakeWindows(files, { env = ENV, node = null } = {}) {
  const byKey = new Map(Object.entries(files).map(([p, text]) => [p.toLowerCase(), text]));
  return {
    platform: "win32",
    env,
    isFile: async (p) => byKey.has(p.toLowerCase()),
    readFile: async (p) => (byKey.has(p.toLowerCase()) ? byKey.get(p.toLowerCase()) : null),
    readdir: async (dir) => {
      const prefix = dir.toLowerCase().replace(/\\$/, "") + "\\";
      const names = new Set();
      for (const p of Object.keys(files)) if (p.toLowerCase().startsWith(prefix)) names.add(p.slice(prefix.length).split("\\")[0]);
      if (!names.size) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...names];
    },
    findNode: async () => node,
  };
}

// What npm 10's cmd-shim writes for a package whose bin is a JavaScript file.
const NPM_CMD = (script) => `@ECHO off\r
GOTO start\r
:find_dp0\r
SET dp0=%~dp0\r
EXIT /b\r
:start\r
SETLOCAL\r
CALL :find_dp0\r
\r
IF EXIST "%dp0%\\node.exe" (\r
  SET "_prog=%dp0%\\node.exe"\r
) ELSE (\r
  SET "_prog=node"\r
  SET PATHEXT=%PATHEXT:;.JS;=;%\r
)\r
\r
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r
`;

// And the PowerShell version beside it.
const NPM_PS1 = (script) => `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/${script.replace(/\\/g, "/")}" $args
  } else {
    & "$basedir/node$exe"  "$basedir/${script.replace(/\\/g, "/")}" $args
  }
  $ret=$LASTEXITCODE
} else {
  & "node$exe"  "$basedir/${script.replace(/\\/g, "/")}" $args
  $ret=$LASTEXITCODE
}
exit $ret
`;

const find = (name, fs, dirs, opts = {}) => locate.findCommands(name, fs, { dirs, ...opts });

test("PATHEXT order, with PowerShell scripts last and non-programs left out", () => {
  assert.deepEqual(locate.windowsExtensions(".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF"), [".com", ".exe", ".bat", ".cmd", ".ps1"]);
  assert.deepEqual(locate.windowsExtensions(".CMD;.EXE"), [".cmd", ".exe", ".ps1"]);
  assert.deepEqual(locate.windowsExtensions(undefined), [".com", ".exe", ".bat", ".cmd", ".ps1"]);
});

test("candidates go directory by directory, skip Store app aliases and repeat no path", () => {
  const dirs = ["C:\\A", `${LOCAL}\\Microsoft\\WindowsApps`, "c:\\a", "D:\\Tools\\"];
  const got = locate.commandCandidates("claude", dirs, { platform: "win32", pathext: ".EXE;.CMD" });
  assert.deepEqual(got, ["C:\\A\\claude.exe", "C:\\A\\claude.cmd", "C:\\A\\claude.ps1", "D:\\Tools\\claude.exe", "D:\\Tools\\claude.cmd", "D:\\Tools\\claude.ps1"]);
});

test("macOS and Linux look for the bare name, as before", async () => {
  assert.deepEqual(locate.commandCandidates("cortex", ["/a", "/b"], { platform: "darwin" }), ["/a/cortex", "/b/cortex"]);
  assert.deepEqual(await locate.resolveCommand("/a/cortex", { platform: "linux" }), { cmd: "/a/cortex", args: [] });
});

test("Cortex Code: a cortex.cmd launcher on PATH leads to the versioned cortex.exe", async () => {
  const exe = `${LOCAL}\\cortex\\1.2.46\\cortex.exe`;
  for (const launcher of [
    // Exact format written by https://ai.snowflake.com/static/cc-scripts/install.ps1
    `@"${exe}" %*\r\n`,
    `@echo off\r\n"%~dp0..\\1.2.46\\cortex.exe" %*\r\n`,
    `@"%LOCALAPPDATA%\\cortex\\1.2.46\\cortex.exe" %*`,
    `@echo off\r\nset CORTEX_HOME=%LOCALAPPDATA%\\cortex\r\n%LOCALAPPDATA%\\cortex\\1.2.46\\cortex.exe %*`,
  ]) {
    const fs = fakeWindows({ [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: launcher, [exe]: "" });
    const [first] = await find("cortex", fs, ["C:\\Windows\\System32", `${LOCAL}\\cortex\\bin`]);
    assert.deepEqual(first, { cmd: exe, args: [], foundAt: `${LOCAL}\\cortex\\bin\\cortex.cmd` }, launcher);
  }
});

test("Cortex Code: a launcher the app can't follow falls back to the newest versioned cortex.exe", async () => {
  const fs = fakeWindows({
    [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: "@echo off\r\ncall :run %*\r\n",
    [`${LOCAL}\\cortex\\1.9.2\\cortex.exe`]: "",
    [`${LOCAL}\\cortex\\1.10.0\\cortex.exe`]: "",
    [`${LOCAL}\\cortex\\bin\\notes.txt`]: "",
  });
  const runs = await find("cortex", fs, [`${LOCAL}\\cortex\\bin`], { versionedRoots: [`${LOCAL}\\cortex`] });
  assert.deepEqual(
    runs.map((r) => r.cmd),
    [`${LOCAL}\\cortex\\1.10.0\\cortex.exe`, `${LOCAL}\\cortex\\1.9.2\\cortex.exe`]
  );
});

test("Cortex Code: nothing on PATH at all still finds the install", async () => {
  const fs = fakeWindows({ [`${LOCAL}\\cortex\\1.2.46\\cortex.exe`]: "" });
  const [first] = await find("cortex", fs, ["C:\\Windows\\System32"], { versionedRoots: [`${LOCAL}\\cortex`] });
  assert.equal(first.cmd, `${LOCAL}\\cortex\\1.2.46\\cortex.exe`);
});

test("Claude Code from npm: claude.cmd runs its script with the node.exe on PATH", async () => {
  const script = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
  const fs = fakeWindows(
    { [`${ROAMING}\\npm\\claude.cmd`]: NPM_CMD(script), [`${ROAMING}\\npm\\${script}`]: "" },
    { node: "C:\\Program Files\\nodejs\\node.exe" }
  );
  const [first] = await find("claude", fs, [`${ROAMING}\\npm`]);
  assert.deepEqual(first, { cmd: "C:\\Program Files\\nodejs\\node.exe", args: [`${ROAMING}\\npm\\${script}`], foundAt: `${ROAMING}\\npm\\claude.cmd` });
});

test("Claude Code from npm: a node.exe beside the launcher wins", async () => {
  const script = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
  const fs = fakeWindows(
    { [`D:\\npm-global\\claude.cmd`]: NPM_CMD(script), [`D:\\npm-global\\${script}`]: "", "D:\\npm-global\\node.exe": "" },
    { node: "C:\\Program Files\\nodejs\\node.exe" }
  );
  const [first] = await find("claude", fs, ["D:\\npm-global"]);
  assert.deepEqual([first.cmd, ...first.args], ["D:\\npm-global\\node.exe", `D:\\npm-global\\${script}`]);
});

test("Claude Code from npm: with no Node anywhere, the launcher is skipped rather than run through cmd.exe", async () => {
  const script = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
  const fs = fakeWindows({ [`${ROAMING}\\npm\\claude.cmd`]: NPM_CMD(script), [`${ROAMING}\\npm\\${script}`]: "" });
  assert.deepEqual(await find("claude", fs, [`${ROAMING}\\npm`]), []);
});

test("Claude Code from npm: a launcher for the native claude.exe runs that directly", async () => {
  const exe = `${ROAMING}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
  const fs = fakeWindows({ [`${ROAMING}\\npm\\claude.cmd`]: `@ECHO off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`, [exe]: "" });
  const [first] = await find("claude", fs, [`${ROAMING}\\npm`]);
  assert.deepEqual([first.cmd, ...first.args], [exe]);
});

test("Claude Code from npm: the PowerShell launcher works when it's the only one", async () => {
  const script = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
  const fs = fakeWindows({ [`D:\\npm\\claude.ps1`]: NPM_PS1(script), [`D:\\npm\\${script}`]: "" }, { node: "C:\\nodejs\\node.exe" });
  const [first] = await find("claude", fs, ["D:\\npm"]);
  assert.deepEqual([first.cmd, ...first.args], ["C:\\nodejs\\node.exe", `D:\\npm\\${script}`]);
});

test("Claude Code from npm: the PowerShell launcher uses a sibling node.exe and ignores variable case", async () => {
  const script = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
  const ps1 = NPM_PS1(script).replace(/\$basedir/g, "$BaseDir");
  const fs = fakeWindows(
    { [`D:\\npm\\claude.ps1`]: ps1, [`D:\\npm\\${script}`]: "", "D:\\npm\\node.exe": "" },
    { node: "C:\\nodejs\\node.exe" }
  );
  const [first] = await find("claude", fs, ["D:\\npm"]);
  assert.deepEqual([first.cmd, ...first.args], ["D:\\npm\\node.exe", `D:\\npm\\${script}`]);
});

test("a launcher's quoted target wins over earlier bare paths and comments", async () => {
  const exe = `${LOCAL}\\cortex\\1.2.46\\cortex.exe`;
  const helper = "C:\\tools\\helper.exe";
  const oldExe = `${LOCAL}\\cortex\\1.0.0\\cortex.exe`;
  const cmdShim = `@echo off\r\nREM previously ${oldExe}\r\nif exist ${helper} set OK=1\r\n"${exe}" %*\r\n`;
  const ps1Shim = `# ${oldExe}\n$path = "$psscriptroot\\..\\1.2.46\\cortex.exe"\n& $path @args\n# ${helper}\n`;
  const fs = fakeWindows({
    [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: cmdShim,
    [`${LOCAL}\\cortex\\bin\\cortex.ps1`]: ps1Shim,
    [exe]: "",
    [helper]: "",
    [oldExe]: "",
  });
  assert.deepEqual(await locate.resolveCommand(`${LOCAL}\\cortex\\bin\\cortex.cmd`, fs), { cmd: exe, args: [] });
  assert.deepEqual(await locate.resolveCommand(`${LOCAL}\\cortex\\bin\\cortex.ps1`, fs), { cmd: exe, args: [] });
});

test("a launcher in a folder whose path contains $ still expands properly", async () => {
  const exe = "C:\\$tools\\bin\\cortex.exe";
  const fs = fakeWindows({ "C:\\$tools\\bin\\cortex.cmd": `@"%~dp0cortex.exe" %*\r\n`, [exe]: "" });
  const [first] = await find("cortex", fs, ["C:\\$tools\\bin"]);
  assert.equal(first.cmd, exe);
});

test("Claude Code outside the standard place: any PATH folder, in PATH order", async () => {
  const fs = fakeWindows({ "E:\\Apps\\Claude\\claude.exe": "", [`${HOME}\\.local\\bin\\claude.exe`]: "" });
  const runs = await find("claude", fs, ["C:\\Windows\\System32", "E:\\Apps\\Claude", `${HOME}\\.local\\bin`]);
  assert.deepEqual(runs.map((r) => r.cmd), ["E:\\Apps\\Claude\\claude.exe", `${HOME}\\.local\\bin\\claude.exe`]);
});

test("a launcher that only calls another launcher is followed", async () => {
  const exe = `${LOCAL}\\cortex\\2.0.1\\cortex.exe`;
  const fs = fakeWindows({
    "C:\\shims\\cortex.bat": `@call "%LOCALAPPDATA%\\cortex\\bin\\cortex.cmd" %*`,
    [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: `@"%~dp0..\\2.0.1\\cortex.exe" %*`,
    [exe]: "",
  });
  const [first] = await find("cortex", fs, ["C:\\shims"]);
  assert.equal(first.cmd, exe);
});

test("a launcher whose program is missing leads nowhere", async () => {
  const fs = fakeWindows({ [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: `@"%~dp0..\\1.2.46\\cortex.exe" %*` });
  assert.equal(await locate.resolveCommand(`${LOCAL}\\cortex\\bin\\cortex.cmd`, fs), null);
});

test("an override path that is itself a launcher is followed too", async () => {
  const exe = "F:\\cortex\\cortex.exe";
  const fs = fakeWindows({ "F:\\cortex\\run.cmd": `@"%~dp0cortex.exe" %*`, [exe]: "" });
  const runs = await find("cortex", fs, ["C:\\nowhere"], { override: "F:\\cortex\\run.cmd" });
  assert.deepEqual(runs.map((r) => r.cmd), [exe]);
});

test("the same program reached two ways is tried once", async () => {
  const exe = `${LOCAL}\\cortex\\1.2.46\\cortex.exe`;
  const fs = fakeWindows({ [`${LOCAL}\\cortex\\bin\\cortex.cmd`]: `@"%~dp0..\\1.2.46\\cortex.exe" %*`, [exe]: "" });
  const runs = await find("cortex", fs, [`${LOCAL}\\cortex\\bin`], { versionedRoots: [`${LOCAL}\\cortex`] });
  assert.equal(runs.length, 1);
});

test("PATH from the registry, with its variables filled in", () => {
  const stdout = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;%LOCALAPPDATA%\\cortex\\bin;D:\\Tools\r\n\r\n";
  const raw = locate.parseRegQuery(stdout);
  assert.equal(raw, "%USERPROFILE%\\.local\\bin;%LOCALAPPDATA%\\cortex\\bin;D:\\Tools");
  assert.deepEqual(locate.splitPath(locate.expandWindowsVars(raw, ENV), "win32"), [`${HOME}\\.local\\bin`, `${LOCAL}\\cortex\\bin`, "D:\\Tools"]);
  assert.equal(locate.parseRegQuery("ERROR: The system was unable to find the specified registry key or value."), "");
  assert.equal(locate.expandWindowsVars("%NOT_SET%\\x;$env:localappdata\\y", ENV), `%NOT_SET%\\x;${LOCAL}\\y`);
});

test("one PATH for the child process, whatever case Windows used", () => {
  const env = locate.withPath({ Path: "C:\\old", path: "C:\\older", HOME: "x" }, "C:\\new", "win32");
  assert.deepEqual(env, { HOME: "x", PATH: "C:\\new" });
  assert.equal(locate.getEnv({ LocalAppData: "Z" }, "LOCALAPPDATA"), "Z");
});

test("the usual Windows install folders are searched", () => {
  const dirs = locate.knownDirs({ platform: "win32", env: ENV, home: HOME });
  for (const d of [`${HOME}\\.local\\bin`, `${ROAMING}\\npm`, `${LOCAL}\\cortex\\bin`, `${LOCAL}\\Microsoft\\WinGet\\Links`]) assert.ok(dirs.includes(d), d);
});

test("versions sort as numbers", () => {
  const sorted = ["1.10.0", "1.9.2", "v2.0.0", "1.10.0-beta.1", "1.2", "1.2.1", "1.2.0-rc.1", "1.2.46+10", "1.2.46+2"].sort(locate.compareVersions);
  assert.deepEqual(sorted, ["1.2.0-rc.1", "1.2", "1.2.1", "1.2.46+2", "1.2.46+10", "1.9.2", "1.10.0-beta.1", "1.10.0", "v2.0.0"]);
});
