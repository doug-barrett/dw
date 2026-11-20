"use strict";

// ───────────── state ─────────────
const S = {
  view: "home",        // home | builder | plans | builds | applied | session | setup | settings | agent
  status: null,        // { ready, checks, agent, agents, workspace }
  settings: null,      // the person's app and agent choices
  skills: undefined,   // the Coalesce skills sessions load (undefined until fetched)
  connectors: undefined, // the person's MCP servers and connectors (undefined until fetched)
  runs: [],
  run: null,           // the open session, with events
  stream: null,        // EventSource for the open session
  file: null,          // { path, before, after } open in the changes pane
  fresh: new Set(),    // paths that changed in the last refresh, for a brief highlight
  turnsOpen: new Set(), // finished turns whose work log the person has unfolded
  landing: null,       // where an added thread's files stand in the workspace (committed, edited…)
  conflicts: null,     // paths that block Keep, from the server
  drafts: {},          // per session: answers to the latest review card, before sending
  error: "",
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICON = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  bang: '<path d="M8 3.5v5.5M8 12v.5"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  send: '<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>',
  folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  home: '<path d="M2.5 7.5L8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5z"/>',
  gear: '<g transform="scale(.6667)" style="stroke-width:2.3"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>',
  shield: '<path d="M8 1.8l5 1.9v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4z"/><path d="M5.8 8l1.6 1.6 2.9-3.1"/>',
  pencil: '<path d="M10.8 2.7l2.5 2.5L6 12.5l-3.2.7.7-3.2z"/><path d="M9.3 4.2l2.5 2.5"/>',
  doc: '<path d="M4 2.5h5.5L12.5 5.5V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M6 8h4.5M6 10.5h4.5M6 5.5h2"/>',
  layers: '<path d="M8 2.5l5.5 3L8 8.5l-5.5-3z"/><path d="M2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3"/>',
  clip: '<path d="M13 7.5l-5 5a3.2 3.2 0 0 1-4.5-4.5l5.3-5.3a2.1 2.1 0 0 1 3 3L6.5 11a1.1 1.1 0 0 1-1.5-1.5l4.8-4.8"/>',
  trash: '<path d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8.5a.5.5 0 0 0 .5.5h5.8a.5.5 0 0 0 .5-.5l.6-8.5M6.8 7v4M9.2 7v4"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1 1 0 0 0 10 2.5H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICON[name]}</svg>`;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status, data });
  return data;
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

// ───────────── formatting ─────────────
function md(src) {
  const blocks = [];
  const text = esc(src).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  const out = [];
  let list = null;
  let para = [];
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) {
      flushPara(); flushList();
      out.push(line.trim());
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h4>${inline(m[1])}</h4>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(m[1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

const SQL_KW = new Set("select from where join left right inner outer full cross on and or not as group by order having with union all distinct case when then else end is null in between like limit qualify over partition rows range preceding following current row lateral flatten coalesce cast true false asc desc exists interval".split(" "));
function highlightSql(line) {
  const re = /(--.*$)|('(?:[^']|'')*')|("(?:[^"])*")|(\{\{[^}]*\}\})|(@[A-Za-z_]\w*)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Za-z_]+)\b/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index));
    const [tok] = m;
    if (m[1]) out += `<span class="c">${esc(tok)}</span>`;
    else if (m[2] || m[3]) out += `<span class="s">${esc(tok)}</span>`;
    else if (m[4]) out += `<span class="r">${esc(tok)}</span>`;
    else if (m[5]) out += `<span class="a">${esc(tok)}</span>`;
    else if (m[6]) out += `<span class="u">${esc(tok)}</span>`;
    else if (m[7]) out += SQL_KW.has(tok.toLowerCase()) ? `<span class="k">${esc(tok)}</span>` : `<span class="f">${esc(tok)}</span>`;
    else if (m[8] && SQL_KW.has(tok.toLowerCase())) out += `<span class="k">${esc(tok)}</span>`;
    else out += esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(line.slice(last));
}

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Markdown for a single line, without the paragraph around it.
const mdLine = (src) => md(src).replace(/^<p>|<\/p>$/g, "");

// Dollar figures only mean something when Claude Code bills by usage. On a subscription plan they're
// estimates nobody pays, so the app leaves them out. Cortex Code reports none: it bills Snowflake credits.
const billedByUsage = () => S.status?.billing !== "plan";
const agentId = () => S.status?.agent?.id || "claude";
const agentName = () => S.status?.agent?.name || "Claude Code";
const money = (n) => (n && billedByUsage() ? `$${n.toFixed(2)}` : "");
const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

function nodeFromPath(p) {
  const m = p.match(/^nodes\/([^-/]+)-(.+)\.(sql|yml)$/);
  return m ? { location: m[1], name: m[2] } : null;
}

// A thread's stages, left to right. Threads from before plans existed have no phase and start at Build.
const STAGES = ["Draft", "Plan", "Build", "Validate", "Review", "Apply"];
const planning = (r) => r.phase === "plan";
function stageOf(r) {
  if (r.status === "kept") return { at: 6, label: "Applied", cls: "ok" };
  if (r.status === "discarded") return { at: -1, label: "Discarded", cls: "none" };
  if (r.status === "plan") return { at: 1, label: "Plan · needs approval", cls: "attn", you: true };
  if (r.status === "review") return { at: 4, label: "Build · needs review", cls: "attn", you: true };
  if (planning(r)) return { at: 1, label: "Plan · in progress", cls: "live" };
  return r.fixing ? { at: 3, label: "Build · validating", cls: "live" } : { at: 2, label: "Build · in progress", cls: "live" };
}
// Each stage's class colors both its dot and its pill.
function statusPill(r, live) {
  const st = stageOf(r);
  return `<span class="pill ${st.cls}">${live ? '<span class="dot live"></span>' : ""}${esc(st.label)}</span>`;
}
const isOpen = (r) => r.status === "running" || r.status === "review" || r.status === "plan";
const needsYou = (r) => r.status === "review" || r.status === "plan";

// The rail's step pages, which are also the columns of Home's timeline. Each gathers some of a
// thread's stages: Builds holds building, validating and ready to review.
const LANES = {
  plans: { name: "Plans", icon: "doc", stages: [1],
    sub: "Plans the agent is writing, or waiting for your approval. Nothing is built until you approve.",
    yours: "Needs approval", busy: "In progress", empty: "No plans right now. Describe what you want on Home." },
  builds: { name: "Builds", icon: "layers", stages: [2, 3, 4],
    sub: "Approved plans the agent is building, and builds ready for you to review and apply.",
    yours: "Needs review", busy: "In progress", empty: "Nothing building. Approve a plan to start one." },
  applied: { name: "Applied", icon: "check", stages: [6], sub: "Pipelines added to your workspace.",
    empty: "Nothing applied yet." },
};
const laneOf = (r) => Object.keys(LANES).find((k) => LANES[k].stages.includes(stageOf(r).at));
// The card the person answers: the plan while there is one to approve, then the build's review.
const cardOf = (r) => (r.status === "plan" ? r.plan : r.review) || r.review || r.plan;

function stageBar(r) {
  const st = stageOf(r);
  if (st.at < 0) return "";
  return `<ol class="stages">${STAGES.map((name, i) => {
    const state = i < st.at ? "done" : i === st.at ? (st.you ? "wait" : "now") : "";
    return `<li class="${state}"><i></i><span>${name}</span></li>`;
  }).join("")}</ol>`;
}
const touched = (r) => ago(r.updatedAt || r.createdAt);
const latestReview = (run) => run.events.findLast((e) => e.type === "review");

// ───────────── rail ─────────────
function renderRail() {
  const ws = S.status?.workspace;
  const agent = S.status?.agent;
  const sel = S.view === "session" ? S.run?.id : null;
  const closed = store("rail-closed") === "1";
  const lane = (key) => {
    const l = LANES[key];
    const waiting = S.runs.filter((r) => needsYou(r) && laneOf(r) === key).length;
    return `<button class="nav step ${S.view === key ? "on" : ""}" data-go="${key}">${icon(l.icon)}${l.name}${waiting ? `<span class="count" title="${waiting} waiting on you">${waiting}</span>` : ""}</button>`;
  };
  const runs = S.runs
    .map((r) => {
      const st = stageOf(r);
      return `<button class="run ${r.id === sel ? "on" : ""}" data-run="${esc(r.id)}" title="${esc(r.title)}">
        <span class="dot ${st.cls}"></span><span class="nm">${esc(r.title)}</span>
        <span class="sub">${esc(st.label)} · ${esc(touched(r))}</span></button>`;
    })
    .join("");
  const agentLine = !agent
    ? ""
    : !agent.found
      ? `<span class="dot err"></span><span>${esc(agent.name)} not found</span>`
      : !agent.signedIn
        ? `<span class="dot warn"></span><span>${esc(agent.name)} not ${agent.id === "cortex" ? "connected" : "signed in"}</span>`
        : `<span class="dot ok"></span><span>${esc(agent.name)} ${esc(agent.version)}</span>`;
  $("#rail").innerHTML = `
    <button class="brand" data-go="home"><img class="m" src="coalesce-mark.svg" alt="">Build with Agents</button>
    <button class="nav ${S.view === "home" ? "on" : ""}" data-go="home">${icon("home")}Home</button>
    <div class="steps-nav">
      <button class="nav step ${S.view === "builder" ? "on" : ""}" data-go="builder">${icon("pencil")}Drafts</button>
      ${lane("plans")}${lane("builds")}${lane("applied")}
    </div>
    <div class="grp ${closed ? "closed" : ""}">
      <button class="tg" id="toggle-runs">${icon("chevron")}Threads</button>
      <button class="add" id="new" title="New thread">${icon("plus")}</button>
    </div>
    <div class="runs" ${closed ? "hidden" : ""}>${runs || '<div class="empty">None yet</div>'}</div>
    <div class="foot">
      ${ws ? `<div class="ln" title="${esc(ws.path)}">${icon("folder")}<span>${esc(ws.name)} · ${ws.nodeCount} nodes</span></div>` : ""}
      <button class="ln ${S.view === "settings" ? "on" : ""}" data-go="settings">${icon("gear")}<span>Settings</span></button>
      ${agentLine ? `<button class="ln ${S.view === "agent" ? "on" : ""}" data-go="agent">${agentLine}</button>` : ""}
    </div>`;
}

// ───────────── pages ─────────────
// Home, Plans, setup, settings and the agent page share one shell: the changes pane
// hidden, and a centered column that scrolls.
function page(html, wide = false) {
  hideChanges();
  $("#main").innerHTML = `<div class="scroll page ${wide ? "wide" : ""}"><div class="col">${html}</div></div>`;
}

function pageHead(title, lead) {
  return `<div><h1>${esc(title)}</h1><p class="lead">${lead}</p></div>`;
}

// A titled block on a page. `side` sits in the heading row: a count or saved flag next to the
// title, or a button or link pushed to the right.
function section(title, body, { side = "", note = "" } = {}) {
  return `<section class="sec">
    <div class="sh"><h2>${title}</h2>${side}</div>
    ${note ? `<p class="note">${note}</p>` : ""}
    ${body}
  </section>`;
}

// ───────────── setup ─────────────
const cmd = (c) => `<div class="cmd"><code>${c}</code><button class="btn ghost icon sm" data-copy="${c}" title="Copy">${icon("copy")}</button></div>`;
// Getting each agent installed and signed in.
const AGENT_HELP = {
  claude: {
    install: `<div>Install it with this command in a terminal, then check again:</div>
      ${cmd("curl -fsSL https://claude.ai/install.sh | bash")}
      <div>On Windows, see <a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noopener">the setup guide</a>.</div>`,
    login: `<div>Open a terminal, run this, and follow the sign-in steps. Any Claude plan, Console account or company setup (Bedrock, Vertex) works.</div>
      ${cmd("claude")}`,
  },
  cortex: {
    install: `<div>Install it with this command in a terminal, then check again:</div>
      ${cmd("curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh")}
      <div>On Windows, see <a href="https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli" target="_blank" rel="noopener">the setup guide</a>.</div>`,
    login: `<div>Open a terminal, run this, and follow the steps to connect it to your Snowflake account.</div>
      ${cmd("cortex")}`,
  },
};
const HELP = {
  sources: `<div>Add the tables you want to build from as source nodes in Coalesce, then check again.</div>`,
  locations: `<div>Open Build Settings › Storage Locations and add where sources live and where new tables should go.</div>`,
  nodeTypes: `<div>Optional. Without node types the agent can still write SQL nodes, but installing the base package from Build Settings › Packages gives it more to match.</div>`,
};

const helpFor = (key) => AGENT_HELP[agentId()][key] || HELP[key];

function checkList() {
  const rows = (S.status?.checks || [])
    .map((c) => {
      const state = c.ok ? "ok" : c.optional ? "opt" : "bad";
      const mark = c.ok ? icon("check") : c.optional ? icon("bang") : icon("x");
      return `<div class="check ${state}"><span class="mk">${mark}</span><div>
        <b>${esc(c.label)}</b><div class="d">${mdLine(c.detail)}</div>
        ${!c.ok && c.help && helpFor(c.help) ? `<div class="help">${helpFor(c.help)}</div>` : ""}
      </div></div>`;
    })
    .join("");
  return `<div class="panel">${rows || '<div class="check"><span></span><div class="t3">Checking…</div></div>'}</div>`;
}

const APP_SETTINGS_NOTES = {
  claude: `Sessions run with this app's own Claude Code settings. Your personal Claude Code settings, hooks, plugins and CLAUDE.md aren't used, so what you've set up for yourself won't change how the app behaves, and nothing here changes your own Claude Code. Usage counts against your own Claude plan or API key.`,
  cortex: `Sessions run with this app's own tools and skills. Your personal Cortex Code settings, skills, plugins and MCP servers aren't used, so what you've set up for yourself won't change how the app behaves, and nothing here changes your own Cortex Code. The agent can't run SQL. Usage is billed to your Snowflake account as Cortex credits.`,
};
const appSettingsNote = () => `<p class="note">${APP_SETTINGS_NOTES[agentId()]}</p>`;

// Which agent the app drives. Shown on setup too, so someone with only one of them isn't stuck.
function agentPicker() {
  return `<div class="panel">${choice("agent", "Agent", "The coding agent that plans and builds. It runs on this computer, signed in as you. Threads keep the agent they started with.")}</div>`;
}

function renderSetup() {
  const ready = S.status?.ready;
  page(`
    ${pageHead("Before you start", "Build with Agents uses Claude Code or Cortex Code on this computer to build pipelines in your workspace. Here's what it needs.")}
    ${agentPicker()}
    ${checkList()}
    ${appSettingsNote()}
    <div class="foot">
      <button class="btn subtle" id="recheck">Check again</button>
      <span class="grow"></span>
      <button class="btn primary lg" id="setup-done" ${ready ? "" : "disabled"}>${ready ? "Continue" : "Finish the steps above"}</button>
    </div>`);
}

// ───────────── settings and the agent ─────────────
// Choices offered on the two pages. The first option is the default; the server keeps the same lists.
const CHOICES = {
  agent: [["claude", "Claude Code"], ["cortex", "Cortex Code"]],
  cortexModel: [["", "Auto (recommended)"], ["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"]],
  budgetUsd: [[0, "No limit"], [2, "$2"], [5, "$5"], [10, "$10"]],
  maxTurns: [[80, "80 (recommended)"], [40, "40"], [150, "150"]],
  model: [["opus", "Opus (recommended)"], ["sonnet", "Sonnet"], ["fable", "Fable"], ["", "Your Claude Code default"]],
  effort: [["medium", "Medium (recommended)"], ["low", "Low"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"], ["", "The model's own"]],
  compact: [["500k", "At 500k tokens (recommended)"], ["200k", "At 200k tokens"], ["off", "Never"]],
};

function prow(label, value, hint = "") {
  return `<div class="prow"><div class="pl"><b>${esc(label)}</b>${hint ? `<div class="d">${hint}</div>` : ""}</div><div class="pc v">${value}</div></div>`;
}

// "claude-fable-5-2" reads as "Fable 5.2".
function modelName(id = S.status?.defaultModel) {
  const m = (id || "").match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : id || "";
}

// What an option reads as, where that depends on this computer.
function choiceLabel(key, value, label) {
  if (key === "agent") return (S.status?.agents || []).find((a) => a.id === value)?.found === false ? `${label} (not installed)` : label;
  if (value !== "" || !modelName()) return label;
  if (key === "model") return `Your Claude Code default (${modelName()})`;
  if (key === "cortexModel") return `Auto (recommended, now ${modelName()})`;
  return label;
}

function choice(key, label, hint) {
  // With no agent chosen yet, the app is using whichever one it found.
  const cur = key === "agent" ? agentId() : S.settings?.[key] ?? CHOICES[key][0][0];
  const opts = CHOICES[key]
    .map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(choiceLabel(key, v, l))}</option>`)
    .join("");
  return prow(label, `<select class="pick" data-setting="${key}">${opts}</select>`, hint);
}

const recheckBtn = `<button class="btn ghost sm" id="recheck">Check again</button>`;

function renderSettings() {
  const st = S.status;
  const ws = st?.workspace;
  page(`
    ${pageHead("Settings", "For Build with Agents on this computer.")}
    ${section("Setup", checkList(), { side: recheckBtn })}
    ${section("Sessions", `<div class="panel">
      ${agentId() === "claude" && billedByUsage() ? choice("budgetUsd", "Spending limit per reply", "The agent stops a reply partway once it has spent this much.") : ""}
      ${choice("maxTurns", "Steps per reply", "How many reads and edits the agent can make before it stops and checks in.")}
      ${ws ? prow("Workspace", `<span title="${esc(ws.path)}">${esc(ws.name)}</span>`) : ""}
      ${st?.storage ? prow("Session copies", `<span class="mono path" title="${esc(st.storage)}">${esc(st.storage.replace(/^\/(Users|home)\/[^/]+/, "~"))}</span>`, "Each session works in its own copy of the workspace, stored here.") : ""}
    </div>`, { side: '<span class="saved" id="saved-app"></span>' })}`);
}

function renderAgent() {
  const c = S.status?.agent;
  const cortex = c?.id === "cortex";
  const name = agentName();
  const a = c?.account || {};
  const plan = a.plan ? a.plan[0].toUpperCase() + a.plan.slice(1) : "";
  const missing = (what, help) => `<div class="prow col1"><div class="pl"><b>${esc(name)} ${what}</b><div class="help">${help}</div></div></div>`;
  let account;
  if (!c) account = prow("Status", `<span class="t3">Checking…</span>`);
  else if (!c.found) account = missing("isn't installed", helpFor("install"));
  else if (!c.signedIn) account = missing(cortex ? (c.unsure ? "may not have a Snowflake connection" : "has no Snowflake connection") : "isn't signed in", helpFor("login"));
  else if (cortex)
    account = [
      prow("Version", esc(c.version)),
      prow("Snowflake account", esc(a.snowflakeAccount || ""), "Usage is billed here as Cortex credits, so the app doesn't show dollar costs."),
      a.user ? prow("User", esc(a.user)) : "",
      prow("Connection", esc(a.connection || ""), "Cortex Code's active connection. Change it with <code>cortex connections set</code>."),
    ].join("");
  else
    account = [
      prow("Version", esc(c.version)),
      a.email ? prow("Signed in as", esc(a.email)) : prow("Signed in", esc(a.provider || a.method || "Yes")),
      plan ? prow("Plan", esc(plan), billedByUsage() ? "" : "Threads count toward this plan's usage, so the app doesn't show dollar costs.") : "",
      a.org ? prow("Organization", esc(a.org)) : "",
    ].join("");
  const cost = cortex ? "more Snowflake credits" : "more of your plan";
  page(`
    ${pageHead(name, `Build with Agents uses the ${esc(name)} installed on this computer.`)}
    ${agentPicker()}
    ${section("Account", `<div class="panel">${account}</div>`, { side: recheckBtn })}
    ${skillsSection()}
    ${cortex ? "" : connectorsSection()}
    ${section("How the agent works", `<div class="panel">
      ${cortex
        ? choice("cortexModel", "Model", "Auto lets Snowflake pick the best model your account can use. Larger models use more Snowflake credits.")
        : choice("model", "Model", "The app uses Opus unless you pick another here, whatever your own Claude Code is set to. Larger models use more of your plan.")}
      ${choice("effort", "Effort", `How long the agent thinks on each step. Higher is slower and uses ${cost}.`)}
      ${cortex ? "" : choice("compact", "Summarize long sessions", "When a session's conversation gets long, the agent summarizes the older parts so it can keep going.")}
    </div>`, { side: '<span class="saved"></span>', note: "The defaults suit most pipelines. Changes apply from the next message you send." })}
    ${appSettingsNote()}`);
}

const skillTitle = (name) => name.replace(/^coalesce-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function skillsSection() {
  const sk = S.skills;
  if (sk === undefined) fetchOnce("skills", "api/skills");
  const body = !sk
    ? prow("Skills", `<span class="t3">${sk === undefined ? "Loading…" : "Not found in this copy of the app"}</span>`)
    : `<div class="pchips">${sk.items.map((x) => `<span class="pchip" title="${esc(x.description)}">${esc(skillTitle(x.name))}</span>`).join("")}</div>`;
  return section("Skills", `<div class="panel">${body}</div>`, {
    side: sk ? `<a class="more" href="${esc(sk.homepage)}" target="_blank" rel="noopener">${esc(sk.name)} ${esc(sk.version)}</a>` : "",
    note: "Coalesce's own guides to building pipelines. Every session loads them, and they update with the app.",
  });
}

function connectorsSection() {
  const c = S.connectors;
  if (c === undefined) fetchOnce("connectors", "api/connectors");
  let body;
  if (!c) body = prow("Connectors", `<span class="t3">${c === undefined ? "Checking your connectors…" : "Couldn't list them"}</span>`);
  else if (!c.items.length) body = prow("None yet", "", "Add one in Claude Code, or at claude.ai › Settings › Connectors.");
  else {
    const why = { auth: "needs sign-in", pending: "waiting for approval", failed: "not connected" };
    const on = c.items.filter((x) => x.state === "connected");
    const off = c.items.filter((x) => x.state !== "connected");
    const chip = (x) => `<span class="pchip" title="${esc(x.source === "claude.ai" ? "From claude.ai" : x.target)}${x.state !== "connected" ? ` · ${why[x.state]}` : ""}"><span class="dot ${x.state === "connected" ? "ok" : "none"}"></span>${esc(x.name)}</span>`;
    body = `<div class="pchips">${on.map(chip).join("") || '<span class="t3">None connected</span>'}</div>
      ${off.length ? `<details class="pmore"><summary>${off.length} more not connected</summary><div class="pchips">${off.map(chip).join("")}</div></details>` : ""}`;
  }
  return section("Connectors", `<div class="panel">${body}</div>`, {
    side: c ? `<button class="more" id="refresh-connectors">Refresh</button>` : "",
    note: "Tools your Claude Code can reach, like a ticket system or docs. Sessions don't use them yet; soon you'll pick which ones Claude can read while it builds.",
  });
}

// Fetches a page's extra data once, then redraws that page if it's still open.
const fetching = new Set();
async function fetchOnce(key, url) {
  if (fetching.has(key)) return;
  fetching.add(key);
  try {
    S[key] = await api("GET", url);
  } catch {
    S[key] = null;
  }
  fetching.delete(key);
  if (S.view === "agent") renderAgent();
}

async function saveSetting(el) {
  const key = el.dataset.setting;
  const raw = el.value;
  const value = typeof CHOICES[key][0][0] === "number" ? Number(raw) : raw;
  const flag = el.closest(".sec")?.querySelector(".saved");
  try {
    S.settings = await api("PUT", "api/settings", { [key]: value });
    // The other agent has its own setup checks, account and options: redraw with them.
    if (key === "agent") {
      S.status = await api("GET", "api/status");
      renderRail();
      return renderView();
    }
    if (flag) {
      flag.textContent = "Saved";
      flag.classList.add("on");
      clearTimeout(flag._t);
      flag._t = setTimeout(() => flag.classList.remove("on"), 1400);
    }
  } catch (err) {
    if (flag) { flag.textContent = err.message; flag.classList.add("on", "err"); }
  }
}

// ───────────── composer ─────────────
// The one prompt box: the new-thread spec on Home and replies in a thread.
function composer({ id, send, placeholder, value = "", disabled = false, left = "", wrapId = "" }) {
  return `<div class="composer" ${wrapId ? `id="${wrapId}"` : ""}>
    <textarea id="${id}" rows="1" placeholder="${esc(placeholder)}" spellcheck="true" ${disabled ? "disabled" : ""}>${esc(value)}</textarea>
    <div class="bar">${left}<span class="grow"></span><span class="kbd">⌘↵</span>
      <button class="go" id="${send}" title="Send (⌘↵)" ${disabled || !value.trim() ? "disabled" : ""}>${icon("send")}</button></div>
  </div>`;
}

// Grows the box with its text and enables send once there's something to send.
function wireComposer(el, max, onSend, canSend = () => true) {
  const go = el.closest(".composer").querySelector(".go");
  const sync = () => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    go.disabled = !el.value.trim() || !canSend();
  };
  sync();
  el.addEventListener("input", sync);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend();
  });
}

// ───────────── home and plans ─────────────
// The nodes a thread touched or plans to: from its latest card, or from the changed files while it builds.
function threadNodes(r) {
  const card = cardOf(r);
  if (card?.nodes?.length) return card.nodes;
  return (r.changes || [])
    .map((c) => {
      const n = nodeFromPath(c.path);
      return n && { ...n, change: c.status };
    })
    .filter(Boolean);
}

function chipRow(nodes, max) {
  if (!nodes.length) return "";
  const extra = nodes.length - max;
  return `<div class="nchips">${nodes.slice(0, max).map((n) => nodeChip(n)).join("")}${extra > 0 ? `<span class="nmore">+${extra} more</span>` : ""}</div>`;
}

function progress(sum) {
  return sum.total
    ? `<span class="prog"><i><s style="width:${Math.round((100 * sum.done) / sum.total)}%"></s></i>${sum.done} of ${sum.total}</span>`
    : "";
}

function threadMeta(r) {
  const files = r.changes?.length || 0;
  const card = needsYou(r) ? cardOf(r) : null;
  const open = card ? decisionsOf(card).filter((x) => x.open).length : 0;
  const checks = card?.checks?.length || 0;
  return [
    open ? `<span class="need">${plural(open, "decision")} need${open === 1 ? "s" : ""} you</span>` : "",
    checks ? `<span>${plural(checks, r.status === "plan" ? "test" : "check")} suggested</span>` : "",
    files ? `<span>${plural(files, "file")}</span>` : "",
    money(r.costUsd) ? `<span class="n">${money(r.costUsd)}</span>` : "",
    `<span>${esc(touched(r))}</span>`,
  ].join("");
}

// An open thread on Home, or one on the Plans page, which leads with the title and shows more of
// the preview and nodes.
function threadCard(r, queued = false) {
  const sum = r.summary || {};
  const running = r.status === "running";
  const action = r.status === "plan" ? "Approve ›" : r.status === "review" ? "Review ›" : "";
  const head = queued
    ? `<div class="qh">${statusPill(r, running)}<b class="tt">${esc(r.title)}</b>${action ? `<span class="go">${action}</span>` : ""}</div>`
    : `<div class="th">${statusPill(r, running)}${running ? progress(sum) : ""}</div><b class="tt">${esc(r.title)}</b>`;
  return `<button class="tcard ${queued ? "q" : ""}" data-run="${esc(r.id)}">
    ${head}
    <div class="pv">${esc(running ? sum.activity : sum.preview || "")}</div>
    ${chipRow(threadNodes(r), queued ? 6 : 3)}
    <div class="tf">${threadMeta(r)}</div>
  </button>`;
}

function sessionRow(r) {
  const files = r.changes?.length || 0;
  const sub = r.status === "kept" ? `${plural(files, "file")} added to the workspace` : "Discarded";
  return `<button class="srow" data-run="${esc(r.id)}">
    <span class="dot ${stageOf(r).cls}"></span>
    <span class="sm"><b>${esc(r.title)}</b><span class="sub">${sub}</span></span>
    <span class="sx">${money(r.costUsd) ? `<span class="n">${money(r.costUsd)}</span>` : ""}<span>${esc(touched(r))}</span></span>
  </button>`;
}

function renderHome() {
  const ws = S.status?.workspace;
  const draft = store("spec-draft") || "";
  const ready = S.status?.ready;
  // Plans that need the person first, then the ones the agent is still working on.
  const open = S.runs.filter(isOpen).sort((x, y) => Number(needsYou(y)) - Number(needsYou(x)));
  const needs = open.filter(needsYou).length;
  const working = open.length - needs;
  const applied = S.runs.filter((r) => r.status === "kept");
  const spend = S.runs.reduce((n, r) => n + (r.costUsd || 0), 0);
  const built = S.runs.filter((r) => r.status !== "discarded" && r.status !== "plan" && !planning(r)).reduce((n, r) => n + threadNodes(r).length, 0);
  const tally = [
    needs && `<a href="#" data-go="${laneOf(open.find(needsYou))}">${needs} waiting on you</a>`,
    working && `${working} in progress`,
    built && `${plural(built, "node")} built`,
    money(spend) && `${money(spend)} usage`,
  ].filter(Boolean).join(" · ");

  page(`
    ${S.runs.length ? timeline() : ""}
    <section class="compose">
      <h1>What do you want to build?</h1>
      ${ready === false ? `<div class="notice warn">${esc(agentName())} needs setting up first. <a href="#" data-go="setup">Open setup</a></div>` : ""}
      ${composer({
        id: "spec",
        send: "build",
        wrapId: "drop",
        value: draft,
        placeholder: "Describe the data you need, or paste or attach a specification.",
        left: `<button class="btn ghost icon" id="upload" title="Attach a file (.md or .txt)">${icon("clip")}</button>
          <input type="file" id="file" accept=".md,.txt,.markdown,text/plain,text/markdown" hidden>
          <span class="ws" title="The agent works in a private copy of this workspace. Nothing changes here until you apply it.">${icon("folder")}${esc(ws?.name || "your workspace")}</span>`,
      })}
      <div class="under">
        <a href="#" class="more" data-go="builder">Prefer a guided form? Draft it step by step</a>
        <span class="t3">The agent plans first. Nothing is built until you approve.</span>
      </div>
      ${S.error ? `<div class="notice err">${esc(S.error)}</div>` : ""}
    </section>
    ${S.runs.length ? `
    ${open.length ? section("Open threads", `<div class="tgrid">${open.map((r) => threadCard(r)).join("")}</div>`, { side: `<span class="tally">${tally}</span>` }) : `<p class="tally">${tally}</p>`}
    ${applied.length ? section("Applied", `<div class="panel">${applied.slice(0, 6).map(sessionRow).join("")}</div>`) : ""}` : `
    <div class="steps">
      <div><b>1. Describe it</b>What you need, in your own words. Rough is fine.</div>
      <div><b>2. Approve the plan</b>The agent reads your workspace and proposes the nodes. Settle its questions, then approve.</div>
      <div><b>3. Review and apply</b>It builds in a private copy and Coalesce validates it. Review, then apply it to your workspace.</div>
    </div>`}`, true);

  const spec = $("#spec");
  wireComposer(spec, 360, startBuild, () => Boolean(S.status?.ready));
  spec.addEventListener("input", () => store("spec-draft", spec.value || null));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  $("#file").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
}

// ───────────── drafts ─────────────
// A guided way in for people without a spec, laid out as a sketch of the pipeline: the nodes it
// starts from, the steps the agent works out, and what it should produce. Rules, exclusions and
// checks are one optional note: most pipelines start without them.
const SCOPES = [
  { key: "one", name: "One table", glyph: '<rect x="15" y="3" width="14" height="14" rx="2"/>' },
  { key: "few", name: "A few tables", glyph: '<rect x="3" y="3" width="10" height="14" rx="2"/><rect x="17" y="3" width="10" height="14" rx="2"/><rect x="31" y="3" width="10" height="14" rx="2"/>' },
  { key: "pipeline", name: "A whole pipeline", glyph: '<rect x="2" y="6" width="8" height="8" rx="2"/><rect x="18" y="6" width="8" height="8" rx="2"/><rect x="34" y="6" width="8" height="8" rx="2"/><path d="M10 10h8M26 10h8"/>' },
];
const NOTES_EG = "Rules it must follow, records to leave out, or a total it should match";

function brief() {
  try {
    return JSON.parse(store("brief") || "{}");
  } catch {
    return {};
  }
}
const setBrief = (patch) => store("brief", JSON.stringify({ ...brief(), ...patch }));
const outputsOf = (v = brief()) => (v.outputs?.length ? v.outputs : [{}]);

function builderSpec() {
  const v = brief();
  const t = (k) => (v[k] || "").trim();
  const nodes = v.nodes || [];
  const outs = outputsOf(v).map((o) => o.text?.trim()).filter(Boolean);
  if (![t("what"), t("why"), t("notes")].some(Boolean) && !nodes.length && !outs.length) return "";
  const scope = SCOPES.find((s) => s.key === v.scope);
  return [
    `# ${t("what") || "New pipeline"}`,
    t("why") && `**Who it's for.** ${t("why")}`,
    scope && `**Size.** ${scope.name}.`,
    outs.length && `**It should produce.**\n\n${outs.map((o) => `- ${o}`).join("\n")}`,
    nodes.length && `**Start from.** ${nodes.map((n) => `\`${n}\``).join(", ")}`,
    t("notes") && `**Also.** ${t("notes")}`,
  ].filter(Boolean).join("\n\n");
}

const field = (key, ph) => `<input class="rv-input" data-bk="${key}" placeholder="${esc(ph)}" value="${esc(brief()[key] || "")}">`;
const locOf = (name) => (S.status?.workspace?.nodeList || []).find((x) => x.name === name)?.location || "";

// The workspace's nodes as chips to pick from: picked ones first, then up to 18 matches.
function nodeList() {
  const all = S.status?.workspace?.nodeList || [];
  const picked = brief().nodes || [];
  const q = (S.npFilter || "").toLowerCase();
  const match = all.filter((n) => !picked.includes(n.name) && (!q || n.name.toLowerCase().includes(q)));
  const chip = (n, on) => `<button class="nchip pick ${on ? "on" : ""}" data-pick="${esc(n.name)}" title="${on ? "Remove" : "Start from this node"}">
    <span class="loc">${esc(n.location || "")}</span><b>${esc(n.name)}</b>${on ? icon("x") : ""}</button>`;
  return `${picked.map((name) => chip({ name, location: locOf(name) }, true)).join("")}${match.slice(0, 18).map((n) => chip(n, false)).join("")}${
    match.length > 18 ? `<span class="nmore">${match.length - 18} more; filter to find them</span>` : ""}${
    !match.length && q ? `<span class="nmore">No node matches “${esc(S.npFilter)}”</span>` : ""}`;
}

// How big it is (optional), then a line per output.
function outputRows() {
  const v = brief();
  const outs = outputsOf(v);
  return `<div class="outs">
    <div class="scopes">${SCOPES.map((s) => `<button class="scope ${v.scope === s.key ? "on" : ""}" data-scope="${s.key}"><svg viewBox="0 0 44 20" aria-hidden="true">${s.glyph}</svg>${s.name}</button>`).join("")}</div>
    ${outs.map((o, i) => `<div class="orow">
      <input class="rv-input" data-out="${i}" placeholder="${i ? "Another output" : "What it should produce"}" value="${esc(o.text || "")}">
      ${outs.length > 1 ? `<button class="btn ghost icon" data-orm="${i}" title="Remove">${icon("x")}</button>` : ""}
    </div>`).join("")}
    <button class="more" id="add-output">${icon("plus")}Add another output</button></div>`;
}

function renderBuilder() {
  const n = S.status?.workspace?.nodeList?.length || 0;
  const has = Boolean(builderSpec());
  page(`
    ${pageHead("Draft a pipeline", "Sketch the pipeline you want. Rough is fine: anything you leave open, the agent asks about in its plan.")}
    <div class="bstep two">
      <label><span class="bq">Name it</span>${field("what", "A short name for the pipeline")}</label>
      <label><span class="bq">Who's it for?</span>${field("why", "Who uses it, and what they decide with it")}</label>
    </div>
    <div class="flow">
      <div class="fstep"><span class="fdot"></span><span class="bq">Start from <span class="t3">Optional. The agent checks the workspace either way.</span></span>
        <div class="npick"><input class="rv-input np-filter" id="np-filter" placeholder="Filter ${n} nodes" value="${esc(S.npFilter || "")}"><div class="np-list">${nodeList()}</div></div></div>
      <div class="fstep"><span class="fdot ghost"></span><div class="fmid">The agent plans the steps in between: staging, joins and business logic, in your workspace's conventions.</div></div>
      <div class="fstep"><span class="fdot"></span><span class="bq">It should produce <span class="t3">Picking a size is optional.</span></span>${outputRows()}</div>
    </div>
    <div class="bstep"><span class="bq">Anything else? <span class="t3">Optional</span></span>
      <textarea class="bnote" data-bk="notes" rows="2" placeholder="${esc(NOTES_EG)}">${esc(brief().notes || "")}</textarea></div>
    <div class="foot">
      <button class="btn subtle" id="clear-builder">Start over</button>
      <span class="grow"></span>
      <button class="btn subtle" id="edit-builder" ${has ? "" : "disabled"}>Edit as text</button>
      <button class="btn primary lg" id="plan-builder" ${has && S.status?.ready ? "" : "disabled"}>Send to the agent to plan</button>
    </div>
    ${S.error ? `<div class="notice err">${esc(S.error)}</div>` : ""}`);
  $("[data-bk]")?.focus();
}

// Keep the buttons in step with the brief without redrawing it (which would drop focus).
function syncBuilder() {
  const has = Boolean(builderSpec());
  const edit = $("#edit-builder");
  const plan = $("#plan-builder");
  if (edit) edit.disabled = !has;
  if (plan) plan.disabled = !has || !S.status?.ready;
}

function builderClick(t) {
  const redrawOutputs = () => { $(".outs").outerHTML = outputRows(); syncBuilder(); };
  if (t.dataset.scope) {
    setBrief({ scope: brief().scope === t.dataset.scope ? null : t.dataset.scope });
    return redrawOutputs();
  }
  if (t.dataset.orm !== undefined) {
    setBrief({ outputs: outputsOf().filter((_, i) => i !== Number(t.dataset.orm)) });
    return redrawOutputs();
  }
  if (t.id === "add-output") {
    setBrief({ outputs: [...outputsOf(), {}] });
    redrawOutputs();
    return $(".outs .orow:last-of-type input")?.focus();
  }
  if (t.dataset.pick) {
    const nodes = brief().nodes || [];
    setBrief({ nodes: nodes.includes(t.dataset.pick) ? nodes.filter((n) => n !== t.dataset.pick) : [...nodes, t.dataset.pick] });
    $(".np-list").innerHTML = nodeList();
    return syncBuilder();
  }
  return false;
}

function planFromBuilder(btn) {
  const spec = builderSpec();
  if (spec) createThread(spec, btn, "brief", renderBuilder);
}

// ───────────── stage timeline ─────────────
// Home's overview, in the rail's words: Drafts, then a column per step page, each with its count
// and its threads.
function timeline() {
  const draft = builderSpec()
    ? `<a href="#" class="tl-more" data-go="builder">One in progress</a>`
    : store("spec-draft") ? `<span class="tl-more">One in the box below</span>` : "";
  const cols = [`<li class="${draft ? "has" : ""}"><i></i><a href="#" class="tl-h" data-go="builder">Drafts</a><div class="tl-list">${draft}</div></li>`];
  for (const [key, l] of Object.entries(LANES)) {
    const rs = S.runs.filter((r) => laneOf(r) === key);
    const yours = rs.some(needsYou);
    const busy = rs.some((r) => r.status === "running");
    const names = rs.slice(0, 2).map((r) => `<button class="tl-run" data-run="${esc(r.id)}" title="${esc(r.title)} · ${esc(stageOf(r).label)}">${needsYou(r) ? '<span class="dot attn"></span>' : r.status === "running" ? '<span class="dot live"></span>' : ""}<span class="t">${esc(r.title)}</span></button>`).join("");
    const more = rs.length > 2 ? `<a href="#" class="tl-more" data-go="${key}">+${rs.length - 2} more</a>` : "";
    cols.push(`<li class="${rs.length ? "has" : ""} ${yours ? "wait" : busy ? "now" : ""}">
      <i></i><a href="#" class="tl-h" data-go="${key}">${l.name}${rs.length ? `<b class="${yours ? "count" : "count quiet"}">${rs.length}</b>` : ""}</a>
      <div class="tl-list">${names}${more}</div></li>`);
  }
  return `<ol class="stages timeline">${cols.join("")}</ol>`;
}

// One step's page: what's waiting on the person, then what the agent is still on. Applied lists
// finished threads, with discarded ones underneath.
function renderLane(key = S.view) {
  const l = LANES[key];
  const rs = S.runs.filter((r) => laneOf(r) === key);
  const list = (xs) => `<div class="qlist">${xs.map((r) => threadCard(r, true)).join("")}</div>`;
  const rows = (xs) => `<div class="panel">${xs.map(sessionRow).join("")}</div>`;
  const discarded = key === "applied" ? S.runs.filter((r) => r.status === "discarded") : [];
  const body = key === "applied"
    ? `${rs.length ? rows(rs) : ""}${discarded.length ? section("Discarded", rows(discarded)) : ""}`
    : `${rs.some(needsYou) ? section(l.yours, list(rs.filter(needsYou))) : ""}
       ${rs.some((r) => !needsYou(r)) ? section(l.busy, list(rs.filter((r) => !needsYou(r)))) : ""}`;
  page(`
    ${pageHead(l.name, l.sub)}
    ${rs.length ? "" : `<div class="empty-q">${l.empty}</div>`}
    ${body}`, true);
}

function focusSpec() {
  const spec = $("#spec");
  if (!spec) return;
  spec.focus();
  spec.setSelectionRange(spec.value.length, spec.value.length);
  spec.closest(".scroll").scrollTop = 0;
}

function setSpec(text) {
  const spec = $("#spec");
  spec.value = text;
  spec.dispatchEvent(new Event("input"));
}

async function loadFile(file) {
  setSpec(await file.text());
}

function startBuild() {
  const spec = $("#spec")?.value.trim();
  if (!spec) return focusSpec();
  createThread(spec, $("#build"), "spec-draft", renderHome);
}

// Sends a spec to the agent to plan, clears the draft it came from, and opens the new thread.
async function createThread(spec, btn, draftKey, rerender) {
  S.error = "";
  if (btn) btn.disabled = true;
  try {
    const run = await api("POST", "api/runs", { spec });
    store(draftKey, null);
    await refreshRuns();
    openSession(run.id);
  } catch (error) {
    S.error = error.message;
    rerender();
  }
}

// ───────────── session ─────────────
function groupEvents(events) {
  // Collapse runs of tool calls into one block; todos, changes and status render elsewhere.
  const items = [];
  let tools = null;
  for (const e of events) {
    if (e.type === "tool" || e.type === "tool-error") {
      if (!tools) items.push((tools = { type: "tools", list: [] }));
      tools.list.push(e);
      continue;
    }
    if (e.type === "todos" || e.type === "changes" || e.type === "status") continue;
    tools = null;
    items.push(e);
  }
  return items;
}

function renderTools(list) {
  const row = (e) =>
    e.type === "tool-error"
      ? `<div class="t e"><span class="v">Error:</span><span>${esc(e.text.split("\n")[0])}</span></div>`
      : e.writes && S.run?.status !== "discarded"
        ? `<div class="t w"><span class="v">${esc(e.verb)}</span><button class="tg lk" data-file="${esc(e.target)}" title="Open ${esc(e.target)}">${esc(e.target)}</button></div>`
        : `<div class="t ${e.writes ? "w" : ""}"><span class="v">${esc(e.verb)}</span><span class="tg" title="${esc(e.target)}">${esc(e.target)}</span></div>`;
  if (list.length <= 6) return `<div class="tools">${list.map(row).join("")}</div>`;
  // Long stretches: show writes, fold reads and searches.
  const writes = list.filter((e) => e.writes);
  const others = list.filter((e) => !e.writes);
  const reads = others.filter((e) => e.verb === "Read").length;
  const searches = others.length - reads;
  const parts = [reads && `Read ${plural(reads, "file")}`, searches && plural(searches, "search", "searches")].filter(Boolean).join(", ");
  return `<div class="tools"><details><summary>${esc(parts)} ›</summary>${others.map(row).join("")}</details>${writes.map(row).join("")}</div>`;
}

// What Coalesce's validator said about the thread's nodes after a reply.
const ISSUE_TEXT = {
  unknownColumnDataType: "has a column with no data type",
  sourceNodeMissing: "reads from a node that doesn't exist",
  namedDependencyUnresolved: "reads from a node that doesn't exist",
  sourceColumnMissing: "uses a column its source doesn't have",
  columnSourceDependencyMissing: "uses a column its source doesn't have",
  annotationNameUnknown: "uses an annotation its node type doesn't have",
  annotationInvalid: "has an annotation written the wrong way",
  sqlNodeParseError: "has SQL that couldn't be read",
  circularDependency: "is part of a loop of nodes that depend on each other",
  duplicateNodeLogicalName: "has the same name as another node",
  duplicateNodePhysicalTarget: "writes to the same table as another node",
  dataTypeMismatch: "has a column whose type doesn't match its source",
  fileFormatInvalid: "isn't a valid node file",
};
function renderValidation(e) {
  if (!e.issues.length) return `<div class="line ok">${icon("check")}Validated by Coalesce, no problems</div>`;
  // One line per node and kind of problem; a broken source can flag every column at once.
  const groups = new Map();
  for (const i of e.issues) {
    const g = groups.get(`${i.node}|${i.id}`) || { ...i, columns: [] };
    if (i.column) g.columns.push(i.column);
    groups.set(`${i.node}|${i.id}`, g);
  }
  const list = [...groups.values()]
    .map((g) => {
      const where = g.columns.length === 1 ? `${g.node}.${g.columns[0]}` : g.node || "A file";
      const many = g.columns.length > 1 ? ` (${g.columns.length} columns)` : "";
      return `<li><code>${esc(where)}</code> ${esc(ISSUE_TEXT[g.id] || g.id.replace(/([A-Z])/g, " $1").toLowerCase())}${many}</li>`;
    })
    .join("");
  const n = groups.size;
  return e.fixing
    ? `<div class="vcheck"><b>Coalesce's validator found ${plural(n, "problem")}. The agent is fixing ${n === 1 ? "it" : "them"}.</b><ul>${list}</ul></div>`
    : `<div class="notice warn vcheck"><b>${plural(n, "problem")} left after the agent tried to fix ${n === 1 ? "it" : "them"}. These nodes won't deploy as they are; reply to have the agent try again.</b><ul>${list}</ul></div>`;
}

function lastTextIndex(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === "user" || items[i].type === "review") return -1;
    if (items[i].type === "text") return i;
  }
  return -1;
}

// ───────────── review card ─────────────
// Sessions from before decisions existed ended with questions and assumptions; read both as decisions.
function decisionsOf(r) {
  if (!r) return [];
  if (Array.isArray(r.decisions)) return r.decisions;
  return [
    ...(r.questions || []).map((q) => ({ topic: q.question, options: q.options?.length ? q.options : [q.assumed || "As built"], open: true })),
    ...(r.assumptions || []).map((x) => ({ topic: x.text, options: ["Looks right", ...(x.alternative ? [x.alternative] : [])], open: false })),
  ];
}

// Answers are keyed by decision and check index, so they belong to one card: a new plan or review
// starts a fresh draft instead of carrying old picks onto unrelated decisions.
function draftFor(run) {
  const seq = latestReview(run)?.seq;
  if (S.drafts[run.id]?.seq !== seq) S.drafts[run.id] = { seq, dec: {}, checks: {}, more: false };
  return S.drafts[run.id];
}

const decisionChanged = (a) => Boolean(a && (a.choice === "other" ? a.text?.trim() : a.choice > 0));

function pendingCount(d) {
  const dec = Object.values(d.dec).filter(decisionChanged).length;
  const checks = Object.values(d.checks).filter(Boolean).length;
  return { dec, checks, total: dec + checks };
}

const SIGN = { added: "+", modified: "~", deleted: "−" };
function nodeChip(n, tag = "span", extra = "") {
  return `<${tag} class="nchip" ${n.grain ? `title="${esc(n.grain)}"` : ""} ${extra}>
    <span class="st ${esc(n.change || "added")}">${SIGN[n.change] || "+"}</span>${n.location ? `<span class="loc">${esc(n.location)}</span>` : ""}<b>${esc(n.name)}</b></${tag}>`;
}

// The card the person answers, as a plan before anything is built and as a review after. Only the
// decisions that need them are open; the agent's other calls fold into one line.
function renderReview(e, run, interactive, check = "") {
  const r = e.review || {};
  const isPlan = e.kind === "plan";
  const d = interactive ? draftFor(run) : { dec: {}, checks: {} };
  const nodes = r.nodes || [];
  // Open decisions first; each keeps its index so answers map back to the card.
  const decisions = decisionsOf(r).map((x, i) => ({ ...x, i })).sort((x, y) => Number(Boolean(y.open)) - Number(Boolean(x.open)));
  const open = decisions.filter((x) => x.open).length;
  const checks = r.checks || [];

  let built = "";
  if (nodes.length && isPlan) {
    built = `<div class="rv-sec"><h4>Will build<span class="count quiet">${nodes.length}</span></h4><div class="pnodes">${nodes
      .map((n) => `<div class="pnode">${nodeChip(n)}<span class="pp">${esc(n.purpose || n.grain || "")}${n.from?.length ? `<span class="from">from ${esc(n.from.join(", "))}</span>` : ""}</span></div>`)
      .join("")}</div></div>`;
  } else if (nodes.length) {
    built = `<div class="rv-sec"><h4>Built<span class="count quiet">${nodes.length}</span></h4><div class="nchips">${nodes
      .map((n) => nodeChip(n, "button", `data-file="${esc(n.file)}" ${run.status === "discarded" ? "disabled" : ""}`))
      .join("")}</div></div>`;
  }

  const shown = interactive && !d.more ? decisions.filter((x) => x.open) : decisions;
  const hidden = decisions.length - shown.length;
  const decRow = (x) => {
    const a = d.dec[x.i] || {};
    const cur = a.choice ?? 0;
    const opts = (x.options || [])
      .map((o, j) => `<button class="chip opt ${cur === j ? "on" : ""}" data-rv="dec" data-i="${x.i}" data-v="${j}" ${j === 0 ? `title="${isPlan ? "What the agent suggests" : "What the agent built"}"` : ""} ${interactive ? "" : "disabled"}>${cur === j ? icon("check") : ""}${esc(o)}</button>`)
      .join("");
    return `<div class="dec ${x.open ? "open" : ""} ${decisionChanged(a) ? "changed" : ""}">
      <div class="tp">${x.open ? '<span class="dot attn" title="The agent is guessing here"></span>' : ""}<span>${esc(x.topic)}</span></div>
      <div class="opts">${opts}${interactive ? `<button class="chip opt ${cur === "other" ? "on" : ""}" data-rv="dec" data-i="${x.i}" data-v="other">Other…</button>` : ""}</div>
      ${interactive && cur === "other" ? `<input class="rv-input" data-rv-text="dec" data-i="${x.i}" placeholder="What should it be?" value="${esc(a.text || "")}">` : ""}
    </div>`;
  };
  const head = !shown.length ? "" : open && interactive ? `<h4>Needs you<span class="count">${open}</span></h4>` : `<h4>Decisions<span class="count quiet">${decisions.length}</span></h4>`;
  const dec = decisions.length
    ? `<div class="rv-sec">${head}
      ${shown.length ? `<div class="decs">${shown.map(decRow).join("")}</div>` : ""}
      ${hidden ? `<button class="more fold" id="rv-more">${icon("chevron")}${plural(hidden, shown.length ? "more decision" : "decision")} the agent made on its own</button>` : ""}</div>`
    : "";

  const allOn = checks.length > 0 && checks.every((_, i) => d.checks[i]);
  const chk = checks.length
    ? `<div class="rv-sec quality"><h4>${icon("shield")}${isPlan ? "Tests to build in" : "Suggested checks"}<span class="count quiet">${checks.length}</span>${interactive ? `<button class="more" id="rv-all">${allOn ? "Clear" : "Add all"}</button>` : ""}</h4>
      <div class="rv-checks">${checks
        .map((c, i) => `<label class="rv-check"><input type="checkbox" data-rv-check="${i}" ${d.checks[i] ? "checked" : ""} ${interactive ? "" : "disabled"}>
          <span><span>${esc(c.text)}</span>${c.node ? `<span class="on-node">${esc(c.node)}</span>` : ""}${c.why ? `<span class="why">${esc(c.why)}</span>` : ""}</span></label>`)
        .join("")}</div></div>`
    : "";

  const p = pendingCount(d);
  const parts = [p.dec && plural(p.dec, "change"), p.checks && plural(p.checks, isPlan ? "test" : "check")].filter(Boolean);
  let foot = "";
  if (interactive && isPlan) {
    const hint = parts.length ? `Building with ${parts.join(" and ")}.` : open ? "Answer what you can, or approve with the agent's suggestions." : "Approve to build, or reply below to change the plan.";
    foot = `<div class="rv-foot"><span class="t3">${hint}</span><button class="btn primary" id="rv-approve">${icon("check")}Approve and build</button></div>`;
  } else if (interactive) {
    const hint = parts.length ? `Ready to send: ${parts.join(", ")}` : "Switch anything that's off, or add checks.";
    foot = `<div class="rv-foot"><span class="t3">${hint}</span><button class="btn primary" id="rv-send" ${p.total ? "" : "disabled"}>Send to agent</button></div>`;
  }

  return `<div class="review ${interactive ? "live" : "past"} ${isPlan ? "is-plan" : ""}">
    ${isPlan ? `<div class="rv-kind">Plan</div>` : ""}
    <p class="rv-headline">${mdLine(r.headline || "")}</p>
    ${check ? `<div class="rv-valid">${check}</div>` : ""}
    ${built}${dec}${chk}${foot}
  </div>`;
}

function composeFeedback(run, review, isPlan = false) {
  const d = draftFor(run);
  const lines = [];
  const changes = decisionsOf(review)
    .map((x, i) => {
      const a = d.dec[i];
      if (!decisionChanged(a)) return null;
      const to = a.choice === "other" ? a.text.trim() : x.options[a.choice];
      return `- ${x.topic} → ${to} (instead of "${x.options[0]}")`;
    })
    .filter(Boolean);
  if (changes.length) lines.push("Change these decisions:", ...changes, "");
  const checks = (review.checks || []).filter((_, i) => d.checks[i]).map((c) => `- ${c.text}${c.node ? ` (${c.node})` : ""}`);
  if (checks.length) lines.push(isPlan ? "Build these tests in:" : "Add these checks:", ...checks, "");
  return lines.join("\n").trim();
}

async function sendReview(btn) {
  const run = S.run;
  const latest = latestReview(run);
  if (!latest) return;
  const text = composeFeedback(run, latest.review);
  if (text) postDecision(btn, "messages", { text });
}

function approvePlan(btn) {
  const latest = latestReview(S.run);
  postDecision(btn, "approve", { changes: latest ? composeFeedback(S.run, latest.review, true) : "" });
}

// Sends the person's answers on a review card; the card's draft goes once the agent has them.
async function postDecision(btn, action, body) {
  const run = S.run;
  btn.disabled = true;
  try {
    await api("POST", `api/runs/${run.id}/${action}`, body);
    delete S.drafts[run.id];
  } catch (error) {
    btn.disabled = false;
    alertLine(error.message);
  }
}

function lastUserTs(run) {
  return run.events.findLast((e) => e.type === "user")?.ts || run.createdAt;
}

function currentActivity(run) {
  const active = (run.todos || []).find((t) => t.status === "in_progress");
  if (active) return active.activeForm || active.content;
  const last = run.events.findLast((e) => e.type === "tool");
  if (!last) return "Reading your workspace…";
  return last.writes ? `Writing ${last.target.replace(/^nodes\//, "")}` : "Reading your workspace…";
}

function renderSession() {
  const run = S.run;
  const running = run.running;
  const items = groupEvents(run.events);
  const finalIdx = running ? -1 : lastTextIndex(items);
  const latestReviewSeq = latestReview(run)?.seq;
  const todos = run.todos || [];
  const done = todos.filter((t) => t.status === "completed").length;
  const closed = !isOpen(run);

  const item = (e, i) => {
    switch (e.type) {
      case "text":
        return `<div class="msg ${i === finalIdx ? "final" : ""}">${md(e.text)}</div>`;
      case "tools":
        return renderTools(e.list);
      case "review":
        return renderReview(e, run, false);
      case "result":
        return e.ok
          ? `<div class="line">${icon("check")}Done in ${duration(e.durationMs || 0)}${e.turns ? ` · ${e.turns} steps` : ""}${money(e.costUsd) ? ` · ${money(e.costUsd)}` : ""}</div>`
          : `<div class="line err">The agent stopped: ${esc(e.text || e.subtype || "error")}</div>`;
      case "error":
        return `<div class="notice err">${esc(e.text)}</div>`;
      case "notice":
        return `<div class="line">${esc(e.text)}</div>`;
      case "validation":
        return renderValidation(e);
      default:
        return "";
    }
  };

  // One turn per message from the person. A finished turn folds the agent's work into a single line;
  // what stays in view is what the person said, anything that went wrong, and the latest review.
  const turns = [];
  items.forEach((e, i) => {
    if (e.type === "user" || !turns.length) turns.push({ user: e.type === "user" ? e : null, items: [] });
    if (e.type !== "user") turns.at(-1).items.push({ e, i });
  });
  const feed = turns
    .map((t, k) => {
      const you = !t.user
        ? ""
        : t.user.kind === "spec"
          ? `<details class="you spec"><summary>Request ›</summary><div class="body">${esc(t.user.text)}</div></details>`
          : t.user.kind === "approve"
            ? `<div class="you approved">${icon("check")}<span><b>Approved the plan</b>${t.user.text ? `<span class="body">${esc(t.user.text)}</span>` : ""}</span></div>`
            : `<div class="you">${esc(t.user.text)}</div>`;
      if (running && k === turns.length - 1) return you + t.items.map(({ e, i }) => item(e, i)).join("");

      const review = t.items.findLast(({ e }) => e.type === "review" && e.seq === latestReviewSeq);
      const check = review && t.items.findLast(({ e }) => e.type === "validation")?.e;
      const answer = !review && t.items.find(({ i }) => i === finalIdx);
      const shown = (x) => x === review || x === answer || x.e === check || x.e.type === "notice" || x.e.type === "error" || (x.e.type === "result" && !x.e.ok);
      const work = t.items.filter((x) => !shown(x));
      const ms = t.items.reduce((n, { e }) => n + (e.type === "result" ? e.durationMs || 0 : 0), 0);
      const tools = t.items.flatMap(({ e }) => (e.type === "tools" ? e.list : []));
      const reads = tools.filter((x) => x.verb === "Read").length;
      const wrote = new Set(tools.filter((x) => x.writes).map((x) => x.target)).size;
      const fixes = t.items.filter(({ e }) => e.type === "validation" && e.fixing).length;
      const planned = t.items.some(({ e }) => e.type === "review" && e.kind === "plan");
      const sum = [
        ms ? `${planned ? "Planned" : "Worked"} for ${duration(ms)}` : planned ? "Planning" : "The agent's work",
        reads && `read ${plural(reads, "file")}`,
        wrote && `wrote ${plural(wrote, "node")}`,
        fixes && `fixed ${plural(fixes, "validator problem")}`,
      ].filter(Boolean).join(" · ");
      return [
        you,
        work.length ? `<details class="turn" data-turn="${k}" ${S.turnsOpen.has(k) ? "open" : ""}><summary>${icon("chevron")}${sum}</summary><div class="turn-body">${work.map(({ e, i }) => item(e, i)).join("")}</div></details>` : "",
        t.items.filter(({ e }) => e.type === "error" || (e.type === "result" && !e.ok)).map(({ e, i }) => item(e, i)).join(""),
        answer ? item(answer.e, answer.i) : "",
        review ? renderReview(review.e, run, !running && run.status === (review.e.kind === "plan" ? "plan" : "review"), check ? renderValidation(check) : "") : "",
        t.items.filter(({ e }) => e.type === "notice").map(({ e, i }) => item(e, i)).join(""),
      ].join("");
    })
    .join("");

  const plan = todos.length
    ? `<div class="plan"><h3><span>Build steps</span><span class="n">${done} of ${todos.length}</span></h3><ol>${todos
        .map((t) => `<li class="${esc(t.status)}"><span class="ck">${t.status === "completed" ? icon("check") : ""}</span><span>${esc(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content)}</span></li>`)
        .join("")}</ol></div>`
    : "";

  const scroller = $("#feed");
  const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const prevTop = scroller?.scrollTop;
  const reply = $("#reply");
  const replyValue = reply ? reply.value : "";
  const replyFocused = document.activeElement === reply;
  const active = document.activeElement;
  const focusKey = active?.dataset?.rvText ? `[data-rv-text="${active.dataset.rvText}"][data-i="${active.dataset.i}"]` : null;

  $("#main").innerHTML = `
    <div class="head">
      <h2>${esc(run.title)}</h2>
      ${statusPill(run, running)}
      <div class="meta">
        ${run.changes?.length ? `<button class="chip" data-file="${esc(run.changes[0].path)}" title="See what the agent wrote" ${run.status === "discarded" ? "disabled" : ""}>${plural(run.changes.length, "file")}</button>` : ""}
        ${running ? `<span class="n" id="elapsed">${duration(Date.now() - new Date(lastUserTs(run)).getTime())}</span>` : ""}
        ${money(run.costUsd) ? `<span class="n" title="Usage for this thread">${money(run.costUsd)}</span>` : ""}
        ${running ? `<button class="btn subtle" id="stop">${icon("stop")}Stop</button>` : `<button class="btn ghost icon" id="delete-thread" title="${run.status === "kept" ? "Delete this thread. Its nodes stay in your workspace." : "Delete this thread. Your workspace isn't changed."}">${icon("trash")}</button>`}
      </div>
    </div>
    ${stageBar(run)}
    <div class="scroll feed" id="feed"><div class="col">
      ${running ? plan : ""}
      ${feed}
      ${running ? `<div class="working"><span class="dot live"></span>${esc(currentActivity(run))}</div>` : ""}
    </div></div>
    ${closed ? "" : `<div class="reply">${composer({
      id: "reply",
      send: "send",
      disabled: running,
      placeholder: running ? "The agent is working. You can reply when it's done." : run.status === "plan" ? "Ask for changes to the plan" : "Ask the agent for changes",
    })}</div>`}
    <div class="decide-wrap" id="decide"></div>`;

  const feedEl = $("#feed");
  feedEl.scrollTop = atBottom && !focusKey ? feedEl.scrollHeight : prevTop;
  if (focusKey) {
    const el = $(focusKey);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  const r = $("#reply");
  if (r) {
    r.value = replyValue;
    wireComposer(r, 200, sendReply, () => !S.run?.running);
    if (replyFocused) r.focus();
  }
  renderChanges();
}

async function sendReply() {
  const r = $("#reply");
  const text = r?.value.trim();
  if (!text || S.run.running) return;
  try {
    r.value = "";
    r.dispatchEvent(new Event("input"));
    await api("POST", `api/runs/${S.run.id}/messages`, { text });
  } catch (error) {
    r.value = text;
    alertLine(error.message);
  }
}

function alertLine(text) {
  $("#feed .col")?.insertAdjacentHTML("beforeend", `<div class="notice err">${esc(text)}</div>`);
}

// ───────────── changes pane ─────────────
function hideChanges() {
  $("#changes").hidden = true;
  $("#scrim").hidden = true;
}

// The thread's own bar (add, discard, or where the files stand) and, when a file is open, the
// panel that slides over the thread to show it at a readable width.
function renderChanges() {
  const run = S.run;
  const changes = run.changes || [];
  const bar = $("#decide");
  if (bar) bar.innerHTML = decideBar(run, changes, !isOpen(run));
  const pane = $("#changes");
  pane.hidden = $("#scrim").hidden = !S.file;
  if (!S.file) return;
  const tabs = changes
    .map((c) => {
      const node = nodeFromPath(c.path);
      const letter = { added: "A", modified: "M", deleted: "D" }[c.status];
      return `<button class="vtab ${c.path === S.file.path ? "on" : ""} ${S.fresh.has(c.path) ? "fresh" : ""}" data-file="${esc(c.path)}" title="${esc(c.path)}">
        <span class="st ${c.status}">${letter}</span>${esc(node ? node.name : c.path)}
      </button>`;
    })
    .join("");
  const current = changes.find((c) => c.path === S.file.path);
  pane.innerHTML = `
    <div class="head">
      <div class="vtabs">${tabs || `<span class="mono">${esc(S.file.path)}</span>`}</div>
      <div class="meta">
        ${current ? `<span class="ct">${current.added ? `<span class="a">+${current.added}</span>` : ""}${current.removed ? `<span class="d">−${current.removed}</span>` : ""}</span>` : ""}
        <button class="btn ghost icon" id="back" title="Close (Esc)">${icon("x")}</button>
      </div>
    </div>
    <div class="scroll">${(S.file.html ||= renderDiff(S.file))}</div>`;
}

function decideBar(run, changes, closed) {
  if (run.status === "kept") return landedBar(changes);
  if (closed) return `<div class="decide"><p>Discarded. Your workspace was never changed.</p></div>`;
  if (!changes.length) {
    if (run.status === "plan") return `<div class="decide"><p>Nothing is written until you approve the plan.</p><div class="row"><button class="btn subtle" id="discard">Discard</button></div></div>`;
    return run.running ? "" : `<div class="decide"><p>The agent didn't change any files.</p><div class="row"><button class="btn subtle" id="discard">Close thread</button></div></div>`;
  }
  const disabled = run.running ? "disabled" : "";
  if (S.conflicts) {
    return `<div class="decide stack">
      <div class="notice warn conflicts">These files changed in your workspace after this thread started. Applying replaces them with the agent's version:${S.conflicts.map((p) => `<code>${esc(p)}</code>`).join("")}</div>
      <div class="row">
        <button class="btn subtle lg" id="cancel-conflict">Cancel</button>
        <button class="btn primary lg" id="keep-force">Apply anyway</button>
      </div>
    </div>`;
  }
  return `<div class="decide">
    <p>${run.running ? "You can apply or discard once the agent finishes." : `Copies ${plural(changes.length, "file")} into your workspace, uncommitted. You can take ${changes.length === 1 ? "it" : "them"} back out.`}</p>
    <div class="row">
      <button class="btn danger lg" id="discard" ${disabled}>Discard</button>
      <button class="btn primary lg" id="keep" ${disabled}>${icon("check")}Apply to workspace</button>
    </div>
  </div>`;
}

// Where an added thread stands: not committed yet (can still be removed), committed, or edited since.
function landedBar(changes) {
  const l = S.landing;
  if (!l) return `<div class="decide"><p>These files are in your workspace.</p></div>`;
  const n = changes.length;
  let head;
  let next;
  if (l.edited) {
    head = `In your workspace · ${plural(l.edited, "file")} edited since`;
    next = "You or someone else changed these after they were added, so they're yours to manage from here.";
  } else if (!l.git) {
    head = `In your workspace · ${plural(n, "file")}`;
    next = "Deploy from Coalesce when you're ready.";
  } else if (l.uncommitted) {
    head = `In your workspace · ${l.uncommitted === n ? plural(n, "file") : `${l.uncommitted} of ${n} files`} not committed yet`;
    next = "Commit them with Git in Coalesce when you're ready. Until then you can take them back out.";
  } else {
    head = `Committed · ${plural(n, "file")}`;
    next = "These are part of your branch now. Deploy from Coalesce when you're ready.";
  }
  return `<div class="decide landed">
    <div class="tx"><b class="${l.git && !l.uncommitted && !l.edited ? "ok" : ""}">${icon("check")}${head}</b>
    <p>${next}</p></div>
    ${l.canUndo ? `<div class="row"><button class="btn subtle" id="undo-add">Remove from workspace</button></div>` : ""}
  </div>`;
}

async function refreshLanding() {
  const run = S.run;
  if (run?.status !== "kept") { S.landing = null; return; }
  try {
    const l = await api("GET", `api/runs/${run.id}/landing`);
    if (S.run !== run) return;
    const changed = JSON.stringify(l) !== JSON.stringify(S.landing);
    S.landing = l;
    if (changed && S.view === "session") renderChanges();
  } catch {
    // Leaves the plain "in your workspace" line.
  }
}
// Committing happens in Coalesce, so look again whenever the person comes back to the app.
window.addEventListener("focus", refreshLanding);
document.addEventListener("visibilitychange", () => document.hidden || refreshLanding());

function lineDiff(a, b) {
  // LCS on lines; node files are small.
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [...a.map((t) => ({ t, k: "del" })), ...b.map((t, j) => ({ t, k: "add", no: j + 1 }))];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: a[i], k: "eq", no: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], k: "del" });
    else { out.push({ t: b[j], k: "add", no: j + 1 }); j++; }
  }
  while (i < n) out.push({ t: a[i++], k: "del" });
  while (j < m) { out.push({ t: b[j], k: "add", no: j + 1 }); j++; }
  return out;
}

function renderDiff(f) {
  if (f.after == null && f.before == null) return `<div class="empty-pane">${esc(f.error || "This file no longer exists.")}</div>`;
  const before = f.before == null ? [] : f.before.replace(/\n$/, "").split("\n");
  const after = f.after == null ? [] : f.after.replace(/\n$/, "").split("\n");
  const lines = lineDiff(before, after);
  const sql = f.path.endsWith(".sql");
  // Hide long unchanged stretches, keeping 3 lines of context.
  const keep = lines.map((l, i) => l.k !== "eq" || lines.slice(Math.max(0, i - 3), i + 4).some((x) => x.k !== "eq"));
  let html = "";
  let skipped = 0;
  lines.forEach((l, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { html += `<div class="l gap">${plural(skipped, "unchanged line")}</div>`; skipped = 0; }
    const body = sql ? highlightSql(l.t) : esc(l.t);
    const sign = l.k === "add" ? "+" : l.k === "del" ? "−" : "";
    html += `<div class="l ${l.k}"><span class="no">${l.no || ""}</span><span class="sg">${sign}</span><span>${body || " "}</span></div>`;
  });
  if (skipped) html += `<div class="l gap">${plural(skipped, "unchanged line")}</div>`;
  return `<div class="diff ${sql ? "sql" : ""} ${f.before == null ? "plain" : ""}">${html}</div>`;
}

async function openFile(p) {
  try {
    S.file = await api("GET", `api/runs/${S.run.id}/file?path=${encodeURIComponent(p)}`);
  } catch (error) {
    S.file = { path: p, before: null, after: null, error: error.message };
  }
  renderChanges();
}

// A destructive button asks once more, then goes back to normal after 4 seconds unless the person
// has moved on to another view or thread.
let armTimer;
function arm(btn, label, reset) {
  const id = S.run?.id;
  btn.classList.add("armed");
  btn.textContent = label;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => S.view === "session" && S.run?.id === id && reset(), 4000);
}

async function decide(kind, btn, body) {
  if (kind === "discard" && !btn.classList.contains("armed") && S.run.changes?.length) return arm(btn, "Discard this thread?", renderChanges);
  btn.disabled = true;
  try {
    await api("POST", `api/runs/${S.run.id}/${kind}`, body);
    S.file = null;
    S.conflicts = null;
    // Adding or removing nodes changes the workspace's node count in the rail.
    if (kind === "keep" || kind === "undo") api("GET", "api/status").then((s) => { S.status = s; renderRail(); }).catch(() => {});
  } catch (error) {
    if (error.status === 409 && error.data?.conflicts) {
      S.conflicts = error.data.conflicts;
      renderChanges();
      return;
    }
    alertLine(error.message);
    btn.disabled = false;
  }
}

// The first click arms the button; the second deletes and returns to the lane the thread was in.
async function deleteThread(btn) {
  if (!btn.classList.contains("armed")) {
    btn.classList.replace("ghost", "danger");
    btn.classList.remove("icon");
    return arm(btn, "Delete thread?", renderSession);
  }
  clearTimeout(armTimer);
  btn.disabled = true;
  const run = S.run;
  const lane = laneOf(run);
  closeStream();
  try {
    await api("DELETE", `api/runs/${run.id}`);
  } catch (error) {
    alertLine(error.message);
    btn.disabled = false;
    return;
  }
  S.runs = S.runs.filter((r) => r.id !== run.id);
  const left = lane && S.runs.some((r) => laneOf(r) === lane);
  go(left ? lane : "home");
}

// ───────────── navigation and streaming ─────────────
async function refreshRuns() {
  S.runs = await api("GET", "api/runs");
  renderRail();
}

function closeStream() {
  S.stream?.close();
  S.stream = null;
}

function go(view) {
  closeStream();
  S.view = view;
  S.run = null;
  S.file = null;
  S.conflicts = null;
  history.replaceState(null, "", view === "home" ? location.pathname : `#${view}`);
  store("at", view === "home" ? null : `#${view}`);
  renderRail();
  renderView();
}

function renderView() {
  if (S.view === "setup") renderSetup();
  else if (S.view === "settings") renderSettings();
  else if (S.view === "agent") renderAgent();
  else if (S.view === "home") renderHome();
  else if (LANES[S.view]) renderLane();
  else if (S.view === "builder") renderBuilder();
}

async function openSession(id) {
  closeStream();
  S.file = null;
  S.conflicts = null;
  S.fresh.clear();
  try {
    S.run = await api("GET", `api/runs/${id}`);
  } catch {
    return go("home");
  }
  S.landing = null;
  S.turnsOpen = new Set();
  S.view = "session";
  history.replaceState(null, "", `#run=${id}`);
  store("at", `#run=${id}`);
  renderRail();
  renderSession();
  refreshLanding();
  const es = new EventSource(`api/runs/${id}/events?after=${S.run.events.length}`);
  S.stream = es;
  es.onmessage = (msg) => {
    if (S.stream !== es || !S.run) return;
    const e = JSON.parse(msg.data);
    if (e.seq < S.run.events.length) return;
    S.run.events.push(e);
    applyEvent(e);
  };
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (S.view === "session" && S.run) renderSession();
  });
}

function applyEvent(e) {
  const run = S.run;
  if (e.type === "todos") run.todos = e.todos;
  if (e.type === "review" && e.title) run.title = e.title;
  if (e.type === "changes") {
    const before = new Map((run.changes || []).map((c) => [c.path, `${c.added}/${c.removed}`]));
    S.fresh = new Set(e.changes.filter((c) => before.get(c.path) !== `${c.added}/${c.removed}`).map((c) => c.path));
    run.changes = e.changes;
    if (S.file && S.fresh.has(S.file.path)) openFile(S.file.path);
  }
  if (e.type === "status") {
    run.status = e.status;
    run.running = e.running;
    if (e.phase) run.phase = e.phase;
    run.fixing = Boolean(e.fixing);
    S.landing = null;
    refreshLanding();
    refreshRuns();
  }
  if (e.type === "result" && e.costUsd) run.costUsd = (run.costUsd || 0) + e.costUsd;
  scheduleRender();
}

// Home and the rail show every session; poll while anything is building.
setInterval(async () => {
  if (document.hidden) return;
  const anyRunning = S.runs.some((r) => r.status === "running");
  if (!anyRunning && S.view !== "home" && !LANES[S.view]) return;
  try {
    const key = (list) => JSON.stringify(list.map((r) => [r.id, r.status, r.updatedAt, r.summary?.activity, r.summary?.done]));
    const before = key(S.runs);
    S.runs = await api("GET", "api/runs");
    if (key(S.runs) === before) return;
    renderRail();
    if (S.view === "home" && document.activeElement?.id !== "spec") renderHome();
    if (LANES[S.view]) renderLane();
  } catch {
    // Server restarting.
  }
}, 2500);

// ───────────── resizing ─────────────
const SIZES = { rail: { min: 180, max: 420, varName: "--rail-w" } };
function initResize() {
  for (const key of Object.keys(SIZES)) {
    const saved = Number(store(`w-${key}`));
    if (saved) document.documentElement.style.setProperty(SIZES[key].varName, `${saved}px`);
  }
  document.querySelectorAll(".grip").forEach((grip) => {
    grip.addEventListener("pointerdown", (e) => {
      const key = grip.dataset.target;
      const el = document.getElementById(key);
      const { min, max, varName } = SIZES[key];
      const startX = e.clientX;
      const startW = el.getBoundingClientRect().width;
      const sign = grip.dataset.side === "left" ? 1 : -1;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("dragging");
      document.body.classList.add("resizing");
      const move = (ev) => {
        const w = Math.min(max, Math.max(min, startW + sign * (ev.clientX - startX)));
        document.documentElement.style.setProperty(varName, `${w}px`);
      };
      const up = () => {
        grip.releasePointerCapture(e.pointerId);
        grip.classList.remove("dragging");
        document.body.classList.remove("resizing");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        store(`w-${key}`, String(Math.round(el.getBoundingClientRect().width)));
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
    // Double-click resets to the default width.
    grip.addEventListener("dblclick", () => {
      const key = grip.dataset.target;
      document.documentElement.style.removeProperty(SIZES[key].varName);
      store(`w-${key}`, null);
    });
  });
}

// ───────────── events ─────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.innerHTML = icon("check");
  setTimeout(() => (btn.innerHTML = icon("copy")), 1200);
}

async function recheck() {
  S.status = await api("GET", "api/status?recheck");
  renderRail();
  if (S.view !== "session") renderView();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t || t.disabled) return;
  if (t.dataset.run) { e.preventDefault(); return openSession(t.dataset.run); }
  if (t.dataset.go) { e.preventDefault(); return go(t.dataset.go); }
  if (t.dataset.file) return openFile(t.dataset.file);
  if (t.dataset.rv) {
    const bucket = draftFor(S.run)[t.dataset.rv];
    const i = t.dataset.i;
    bucket[i] = { ...bucket[i], choice: t.dataset.v === "other" ? "other" : Number(t.dataset.v) };
    renderSession();
    if (t.dataset.v === "other") $(`[data-rv-text="${t.dataset.rv}"][data-i="${i}"]`)?.focus();
    return;
  }
  if (t.dataset.copy) return copyText(t.dataset.copy, t);
  if (S.view === "builder" && builderClick(t) !== false) return;
  switch (t.id) {
    case "new":
      if (S.view !== "home") go("home");
      return focusSpec();
    case "toggle-runs":
      store("rail-closed", store("rail-closed") === "1" ? null : "1");
      return renderRail();
    case "build": return startBuild();
    case "clear-builder": store("brief", null); S.npFilter = ""; return renderBuilder();
    case "edit-builder": store("spec-draft", builderSpec()); store("brief", null); go("home"); return focusSpec();
    case "plan-builder": return planFromBuilder(t);
    case "upload": return $("#file").click();
    case "stop": t.disabled = true; return api("POST", `api/runs/${S.run.id}/stop`);
    case "delete-thread": return deleteThread(t);
    case "send": return sendReply();
    case "rv-send": return sendReview(t);
    case "rv-approve": return approvePlan(t);
    case "rv-more": draftFor(S.run).more = true; return renderSession();
    case "rv-all": {
      const latest = latestReview(S.run);
      const d = draftFor(S.run);
      const all = (latest?.review.checks || []).every((_, i) => d.checks[i]);
      (latest?.review.checks || []).forEach((_, i) => (d.checks[i] = !all));
      return renderSession();
    }
    case "keep": return decide("keep", t);
    case "keep-force": return decide("keep", t, { force: true });
    case "undo-add": return decide("undo", t);
    case "cancel-conflict": S.conflicts = null; return renderChanges();
    case "discard": return decide("discard", t);
    case "back": S.file = null; return renderChanges();
    case "recheck": t.disabled = true; return recheck();
    case "refresh-connectors":
      t.textContent = "Checking…";
      return api("GET", "api/connectors?refresh").then((c) => { S.connectors = c; renderAgent(); }).catch(() => renderAgent());
    case "setup-done": store("setup-done", "1"); return go("home");
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.bk) {
    setBrief({ [t.dataset.bk]: t.value });
    return syncBuilder();
  }
  if (t.dataset.out !== undefined) {
    const outs = outputsOf().map((o) => ({ ...o }));
    outs[t.dataset.out].text = t.value;
    setBrief({ outputs: outs });
    return syncBuilder();
  }
  if (t.id === "np-filter") {
    S.npFilter = t.value;
    $(".np-list").innerHTML = nodeList();
    return;
  }
  if (!S.run) return;
  if (t.dataset.rvText) {
    const bucket = draftFor(S.run)[t.dataset.rvText];
    bucket[t.dataset.i] = { ...bucket[t.dataset.i], text: t.value };
    refreshReviewFoot();
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.setting) return saveSetting(t);
  if (!S.run || t.dataset.rvCheck === undefined) return;
  draftFor(S.run).checks[t.dataset.rvCheck] = t.checked;
  refreshReviewFoot();
});
// Update the send button and count without re-rendering (keeps focus in the field being typed in).
function refreshReviewFoot() {
  const foot = $(".review.live .rv-foot");
  if (!foot) return;
  const latest = latestReview(S.run);
  const tmp = document.createElement("div");
  tmp.innerHTML = renderReview(latest, S.run, true);
  foot.replaceWith(tmp.querySelector(".rv-foot"));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.file) { S.file = null; renderChanges(); }
  // In the builder, Enter in an output line starts another.
  if (S.view === "builder" && e.key === "Enter" && e.target.dataset?.out !== undefined) { e.preventDefault(); $("#add-output")?.click(); }
});
document.addEventListener("toggle", (e) => {
  const k = e.target.dataset?.turn;
  if (k !== undefined) S.turnsOpen[e.target.open ? "add" : "delete"](Number(k));
}, true);
document.getElementById("scrim").addEventListener("click", () => { S.file = null; renderChanges(); });

setInterval(() => {
  const el = $("#elapsed");
  if (el && S.run?.running) el.textContent = duration(Date.now() - new Date(lastUserTs(S.run)).getTime());
}, 1000);

// Dev: reload when the app's files change (the server only offers this for hand-installed copies).
function watchForReload() {
  const es = new EventSource("api/dev/reload");
  es.addEventListener("reload", () => location.reload());
  const waitForRestart = () => {
    es.close();
    // The server restarts itself on server-side changes; reload once it's back.
    const retry = setInterval(async () => {
      try {
        const res = await fetch("api/dev/ping");
        if (res.ok) { clearInterval(retry); location.reload(); }
        else if (res.status === 404) clearInterval(retry);
      } catch {
        // Still restarting.
      }
    }, 700);
  };
  es.addEventListener("restart", waitForRestart);
  es.onerror = waitForRestart;
}

// ───────────── boot ─────────────
initResize();
(async function boot() {
  let status;
  try {
    [status, S.settings] = await Promise.all([api("GET", "api/status"), api("GET", "api/settings").catch(() => null)]);
  } catch {
    // The server is starting or restarting; try again shortly.
    $("#main").innerHTML = `<div class="empty-pane">Starting…</div>`;
    setTimeout(boot, 800);
    return;
  }
  S.status = status;
  await refreshRuns();
  if (status.dev) watchForReload();
  // Coalesce reloads the app at its bare address, so the last place is remembered here too.
  const at = location.hash || store("at") || "";
  const id = (at.match(/run=([\w-]+)/) || [])[1];
  if (!status.ready || location.hash === "#setup" || (!store("setup-done") && !S.runs.length)) return go("setup");
  if (id && S.runs.some((r) => r.id === id)) return openSession(id);
  if (at === "#review") return go("plans");
  if (["#settings", "#agent", "#builder", "#plans", "#builds", "#applied"].includes(at)) return go(at.slice(1));
  go("home");
})();
