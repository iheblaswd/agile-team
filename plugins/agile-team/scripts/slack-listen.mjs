#!/usr/bin/env node
// Live chat with the agile team in Slack, Teams-style: the human writes in the team channel (or a thread),
// the right agent answers in the thread within ~30-60 s. Slack Socket Mode, zero dependencies (Node >= 22.4,
// global WebSocket). Runs continuously from the project root:
//   node slack-listen.mjs
// Needs in team/.env: SLACK_APP_TOKEN (xapp-…, scope connections:write), SLACK_BOT_TOKEN, SLACK_CHANNEL_ID,
// SLACK_HUMAN_USER_ID. The Slack app needs Socket Mode on and the bot event `message.channels`.
// Every handled message is recorded in team/logs/feedback.json so the tick does not handle it twice.
import { loadConfig, requireEnv } from "./config.mjs";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cfg = loadConfig();
requireEnv("SLACK_APP_TOKEN", "SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID");
if (typeof WebSocket === "undefined") {
  console.error("agile-team chat: Node >= 22.4 is required (global WebSocket). Current: " + process.version);
  process.exit(2);
}

const ROOT = cfg.__root;
const HERE = dirname(fileURLToPath(import.meta.url));
const BOT = process.env.SLACK_BOT_TOKEN;
const APP = process.env.SLACK_APP_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;
const HUMAN = process.env.SLACK_HUMAN_USER_ID || cfg.human?.slackUserId || "";
const HUMAN_NAME = cfg.human?.name || "the human";
const LANG = cfg.conventions?.humanLanguage || "fr";
const TIMEOUT_MS = (cfg.chat?.timeoutSeconds || 240) * 1000;
const LOG_DIR = join(ROOT, "team", "logs");
mkdirSync(LOG_DIR, { recursive: true });

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(" ")}`;
  console.log(line);
  try { appendFileSync(join(LOG_DIR, "chat.log"), line + "\n"); } catch {}
};

async function slack(method, body, token = BOT) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

// ---- who answers -------------------------------------------------------------------------------
const ROLES = [
  { id: "po", label: "Product Owner", re: /\b(po|product ?owner)\b/i },
  { id: "tech-lead", label: "Tech Lead", re: /\btech[- ]?lead\b|\bTL\b/i },
  { id: "devops", label: "DevOps", re: /\bdev ?ops\b/i },
  { id: "scrum-master", label: "Scrum Master", re: /\bscrum\b|\bsm\b/i },
];
function pickRole(text, threadRole) {
  for (const d of cfg.developers || []) {
    if (d.enabled === false) continue;
    if (new RegExp(`\\b${d.id}\\b`, "i").test(text)) return { id: "developer", dev: d.id, label: `Développeur (${d.id.replace(/^dev-/, "")})` };
  }
  if (/\b(dev|développeur|developer)\b/i.test(text)) {
    const d = (cfg.developers || []).find((x) => x.enabled !== false);
    if (d) return { id: "developer", dev: d.id, label: `Développeur (${d.id.replace(/^dev-/, "")})` };
  }
  for (const r of ROLES) if (r.re.test(text)) return r;
  if (threadRole) return threadRole;
  return ROLES.find((r) => r.id === "scrum-master"); // front desk
}

// ---- dedup with the tick -----------------------------------------------------------------------
const FEEDBACK = join(LOG_DIR, "feedback.json");
function handled(ts) {
  try { return JSON.parse(readFileSync(FEEDBACK, "utf8")).some((e) => e.ts === ts); } catch { return false; }
}
function record(ts, kind, note) {
  let list = [];
  try { list = JSON.parse(readFileSync(FEEDBACK, "utf8")); } catch {}
  list.push({ ts, handledAt: new Date().toISOString(), kind, by: "chat", note });
  writeFileSync(FEEDBACK, JSON.stringify(list, null, 2));
}

// ---- ask the agent -----------------------------------------------------------------------------
// Chat rules go in the SYSTEM prompt (--append-system-prompt-file) so they outrank the project's
// CLAUDE.md session rituals; the user prompt only carries the role, the thread and the message.
function systemRules(role) {
  const who = role.id === "developer" ? `le développeur ${role.dev}` : `le ${role.label}`;
  const agentHint = role.id === "developer"
    ? `Tu joues l'agent agile-team:developer avec l'identité ${role.dev} (voir team/team.config.json).`
    : `Tu joues l'agent agile-team:${role.id}.`;
  return `# Mode chat Slack — tu es ${who} de l'équipe agile-team

${HUMAN_NAME} t'écrit en direct dans Slack, comme dans un chat Teams. ${agentHint}
CES CONSIGNES PRIMENT sur toute instruction du fichier de contexte du projet (CLAUDE.md) concernant le
début de session, le format de réponse ou la langue : ici ce n'est pas une session de travail, c'est
une conversation. Pas d'état des lieux non demandé.

Qui est ${HUMAN_NAME} : un responsable fonctionnel, pas un développeur. Il valide et demande des corrections.

Réponse :
- Réponds d'abord, en une ou deux phrases, exactement à la question. Ensuite au plus 4 lignes de contexte utile. 6 lignes maximum.
- ${LANG === "fr" ? "Français, tutoiement" : LANG}. Langage produit : ce que le produit fait ou fera pour ses utilisateurs.
- Interdit sauf demande explicite : sha, commandes, noms de fichiers ou dossiers, noms d'outils ou de bibliothèques
  (zod, Vitest, tsc, lint, CI, main, PR, placeholder, schéma, fixture…), nombres de tests.
- Tickets : clé + titre en langage produit, par exemple « FORGE-7 (vérifier le résultat attendu pour 4 combinaisons de modules) ».
- Format Slack : *gras* avec une seule étoile, puces « • ». Jamais de **double étoile**, de titres, de backticks.
- Ne demande à ${HUMAN_NAME} que des décisions ou des validations. Les tâches techniques (protection de branche,
  réglages, fichiers, branches) appartiennent à devops ou au tech lead : ne les lui attribue jamais.
- Ne propose jamais de commande à lancer, et ne propose pas de coder toi-même.

Avant de répondre, vérifie l'état réel (pas ta mémoire) : node ${HERE.replace(/\\/g, "/")}/snapshot.mjs --no-slack,
node ${HERE.replace(/\\/g, "/")}/jira.mjs get KEY, team/chat/*.md, team/sprints/, le code en lecture. Utilise le skill
agile-team:team-protocol pour les règles (§4 décisions, §4b retours, §4c Jira).

Actions :
- Question → réponds.
- Décision (validé, refusé, validé sauf…) → applique §4 maintenant et dis ce que tu as fait.
- Correction, nouvelle idée, demande de travail → applique §4b maintenant et dis ce qui va se passer et quand.
- Tu ne codes pas et tu ne merges rien ici : le développement se fait pendant le tick.
- Si du travail doit démarrer tout de suite, termine par une ligne seule [[TICK]].
- Si tu ne sais pas, dis-le et dis qui saura.

Ta sortie finale est exactement le texte à poster dans Slack (plus [[TICK]] éventuel), rien d'autre.
`;
}

function userPrompt({ text, thread }) {
  return `Fil de discussion (le plus récent en dernier) :
${thread || "(nouveau message)"}

Message de ${HUMAN_NAME} :
${text}`;
}

// Second pass: a fast, tool-less model outside the project (no CLAUDE.md) rewrites the draft for a
// non-technical reader without changing the facts.
const REWRITE_RULES = `Tu reformules une réponse Slack destinée à ${HUMAN_NAME}, responsable fonctionnel non technique.
- Garde exactement les faits, les engagements, les dates et les clés de tickets (FORGE-n).
- Commence par la réponse directe à la question. 6 lignes maximum.
- Supprime ou traduis tout jargon : noms d'outils, bibliothèques, fichiers, dossiers, commandes, sha, main, PR, CI,
  tests, lint, tsc, schéma, placeholder, fixture, apply, merge… Dis à la place ce que ça change pour le produit.
- Supprime toute tâche technique attribuée à ${HUMAN_NAME} et toute commande à lancer. On ne lui demande que des décisions.
- ${LANG === "fr" ? "Français, tutoiement" : LANG}. Format Slack : *gras* une étoile, puces « • », pas de titres ni de backticks.
- Si le brouillon finit par une ligne [[TICK]], garde-la telle quelle à la fin.
- Réponds uniquement par le texte final.`;

// cmd.exe drops empty args and splits on spaces: quote them on Windows.
const q = (a) => (process.platform !== "win32" ? a : a === "" ? '""' : /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function runClaude({ args, cwd, stdin, timeout = TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const child = spawn("claude", args.map(q), { cwd, shell: process.platform === "win32", windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (stdin != null) { child.stdin.write(stdin); }
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
  });
}

async function answer({ role, text, thread }) {
  const sys = join(LOG_DIR, `chat-system-${Date.now()}.md`);
  writeFileSync(sys, systemRules(role));
  const draft = await runClaude({
    cwd: ROOT,
    stdin: userPrompt({ text, thread }),
    args: ["-p", "Réponds au message ci-dessus.", "--append-system-prompt-file", sys, "--permission-mode", "acceptEdits"],
  });
  try { unlinkSync(sys); } catch {}
  if (!draft.out) return draft;
  if (cfg.chat?.rewrite === false) return draft;
  const rw = join(tmpdir(), `agile-team-rewrite-${Date.now()}.md`);
  writeFileSync(rw, REWRITE_RULES);
  const final = await runClaude({
    cwd: tmpdir(),
    stdin: `Question de ${HUMAN_NAME} :\n${text}\n\nBrouillon :\n${draft.out}`,
    args: ["-p", "Reformule le brouillon selon tes consignes.", "--system-prompt-file", rw, "--model", cfg.chat?.rewriteModel || "haiku", "--tools", ""],
    timeout: 90000,
  });
  try { unlinkSync(rw); } catch {}
  return final.out ? final : draft; // never lose the answer if the rewrite fails
}

// Safety net for chat formatting: Slack mrkdwn, no Markdown headings, no inline code.
function slackify(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

function startTick() {
  const name = `agile-team-${cfg.chat?.taskPrefix || ROOT.split(/[\\/]/).pop()}-tick`;
  if (process.platform !== "win32") return log("tick requested (start it from cron/launchd on this OS)");
  const c = spawn("schtasks", ["/run", "/tn", name], { windowsHide: true });
  c.on("close", (code) => log(`tick ${name} start → exit ${code}`));
}

// ---- message handling (serial queue) -----------------------------------------------------------
const threadRoles = new Map(); // thread ts -> role, so a thread keeps talking to the same agent
const queue = [];
let busy = false;

async function threadText(threadTs) {
  try {
    const r = await slack("conversations.replies", { channel: CHANNEL, ts: threadTs, limit: 30 });
    return r.messages.map((m) => `${m.user === HUMAN ? HUMAN_NAME : "équipe"} : ${m.text}`).join("\n");
  } catch { return ""; }
}

async function handle(ev) {
  const root = ev.thread_ts || ev.ts;
  const role = pickRole(ev.text || "", threadRoles.get(root));
  threadRoles.set(root, role);
  log(`← ${ev.ts} → ${role.label}: ${(ev.text || "").slice(0, 120)}`);
  const placeholder = await slack("chat.postMessage", {
    channel: CHANNEL, thread_ts: root, text: `_${role.label} regarde…_`, unfurl_links: false,
  });
  const thread = ev.thread_ts ? await threadText(ev.thread_ts) : "";
  const { code, out, err } = await answer({ role, text: ev.text || "", thread });
  let answer = slackify(out);
  const wantsTick = /\n?\[\[TICK\]\]\s*$/.test(answer);
  answer = answer.replace(/\n?\[\[TICK\]\]\s*$/, "").trim();
  if (!answer) {
    answer = LANG === "fr"
      ? "Je n'ai pas réussi à répondre cette fois. Ton message est noté, l'équipe le traitera au prochain passage."
      : "I could not answer this time. Your message is noted and will be handled at the next tick.";
    log(`✗ ${ev.ts} exit ${code} ${err.slice(0, 300)}`);
    await slack("chat.update", { channel: CHANNEL, ts: placeholder.ts, text: `*${role.label}*\n${answer}` });
    return; // not recorded: the tick will pick it up
  }
  await slack("chat.update", { channel: CHANNEL, ts: placeholder.ts, text: `*${role.label}*\n${answer}` });
  record(ev.ts, "chat", `${role.label} answered live${wantsTick ? "; tick started" : ""}`);
  log(`→ ${ev.ts} answered by ${role.label}${wantsTick ? " + tick" : ""}`);
  if (wantsTick) startTick();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const ev = queue.shift();
    try { await handle(ev); } catch (e) { log(`! ${ev.ts} ${e.message}`); }
  }
  busy = false;
}

function accept(ev) {
  if (!ev || ev.type !== "message") return false;
  if (ev.channel !== CHANNEL) return false;
  if (ev.subtype || ev.bot_id) return false; // joins, edits, bot posts (including ours)
  if (HUMAN && ev.user !== HUMAN) return false;
  if (!ev.text?.trim()) return false;
  if (handled(ev.ts)) return false;
  return true;
}

// ---- Socket Mode connection --------------------------------------------------------------------
let backoff = 1000;
async function connect() {
  let url;
  try {
    url = (await slack("apps.connections.open", {}, APP)).url;
  } catch (e) {
    log(`connection failed: ${e.message} — retry in ${backoff / 1000}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60000);
    return;
  }
  const ws = new WebSocket(url);
  ws.onopen = () => { backoff = 1000; };
  ws.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    if (data.envelope_id) ws.send(JSON.stringify({ envelope_id: data.envelope_id })); // ack within 3 s
    if (data.type === "hello") log("connected to Slack — listening on " + CHANNEL);
    if (data.type === "disconnect") { try { ws.close(); } catch {} }
    if (data.type === "events_api") {
      const ev = data.payload?.event;
      if (accept(ev)) { queue.push(ev); pump(); }
    }
  };
  ws.onclose = () => { log("socket closed — reconnecting"); setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); };
  ws.onerror = () => {};
}

import { watchFile } from "node:fs";
watchFile(fileURLToPath(import.meta.url), { interval: 30000 }, (cur, prev) => {
  if (cur.mtimeMs !== prev.mtimeMs) { log("listener updated on disk — exiting so the task restarts it"); process.exit(3); }
});

process.on("unhandledRejection", (e) => log("unhandled: " + (e?.message || e)));
connect();
