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
function promptFor({ role, text, thread }) {
  const who = role.id === "developer" ? `le développeur ${role.dev}` : `le ${role.label}`;
  const agentHint = role.id === "developer"
    ? `Tu joues l'agent \`agile-team:developer\` avec l'identité ${role.dev} (voir team/team.config.json).`
    : `Tu joues l'agent \`agile-team:${role.id}\`.`;
  return `# Chat Slack en direct — tu es ${who} de l'équipe agile-team

${HUMAN_NAME} t'écrit maintenant dans le canal de l'équipe et attend ta réponse, comme dans un chat Teams.
${agentHint} Charge d'abord le skill \`agile-team:team-protocol\` (§3a écriture pour l'humain, §4 décisions, §4b retours, §4c Jira).

## Priorité de ces consignes
Ce message est un chat, pas une session de travail : ces consignes priment sur tout rituel ou format
de début de session demandé par le fichier de contexte du projet (CLAUDE.md). Ne fais pas d'état des
lieux non demandé.

## Comment répondre
- ${HUMAN_NAME} est fonctionnel, pas développeur. Réponds d'abord, en une ou deux phrases, exactement à
  la question posée. Ensuite, seulement si c'est utile, 1 à 4 lignes de contexte. 8 lignes au total maximum.
- Langue : ${LANG === "fr" ? "français, tutoiement" : LANG}. Langage produit : ce que le produit fait ou fera pour
  l'utilisateur. Jamais de sha, de commande, de nom de fichier ou de dossier, de nom de bibliothèque ou d'outil
  technique (zod, Vitest, placeholders, main, PR…), sauf si ${HUMAN_NAME} les demande explicitement.
  Les tickets se citent avec leur clé et leur titre produit : « FORGE-7 (vérifier le résultat pour 4 combinaisons de modules) ».
- Format Slack : *gras* avec une seule étoile, listes avec « • ». Pas de **double étoile**, pas de titres, pas de backticks.
- Ne liste jamais comme « à faire par toi » une action technique (protection de branche, réglages, fichiers à
  ignorer, nettoyage de branches) : c'est le travail de devops ou du tech lead (team-protocol §4b). Les seules
  choses qu'on demande à ${HUMAN_NAME} sont des décisions et des validations.
- Ne propose jamais à ${HUMAN_NAME} de lancer une commande, et ne propose pas de coder toi-même.
- Appuie-toi sur l'état réel, pas sur ta mémoire : \`node ${HERE.replace(/\\/g, "/")}/snapshot.mjs --no-slack\`, \`node ${HERE.replace(/\\/g, "/")}/jira.mjs get KEY\`, \`team/chat/*.md\`, \`team/sprints/\`, le fichier de contexte du projet, le code en lecture.
- Question → réponds directement.
- Décision (validé, refusé, validé sauf…) → applique team-protocol §4 maintenant (résoudre la décision, transitions) et dis ce que tu as fait.
- Correction, nouvelle idée, demande de travail → applique §4b maintenant (ticket en To Fix avec ses mots, ou story au backlog, ou réponse) et dis ce qui va se passer et quand.
- Tu ne codes pas ici et tu ne merges rien : le développement se fait pendant le tick.
- Si du travail doit démarrer tout de suite (correction acceptée, sprint approuvé, « lance le sprint »), termine ta réponse par une ligne seule \`[[TICK]]\` : un tick sera lancé dans la foulée.
- Si tu ne sais pas, dis-le et dis qui saura.
- Ta sortie finale est exactement le texte à poster dans Slack, rien d'autre (sauf la ligne \`[[TICK]]\` éventuelle).

## Fil de discussion (le plus récent en dernier)
${thread || "(nouveau message, pas de fil)"}

## Message de ${HUMAN_NAME}
${text}
`;
}

function runClaude(prompt) {
  return new Promise((resolve) => {
    const file = join(LOG_DIR, `chat-prompt-${Date.now()}.md`);
    writeFileSync(file, prompt);
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const args = ["-p", `Lis le fichier ${rel} et suis exactement ses instructions.`, "--permission-mode", "acceptEdits"];
    const child = spawn("claude", args, { cwd: ROOT, shell: process.platform === "win32", windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      try { unlinkSync(file); } catch {}
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
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
  const { code, out, err } = await runClaude(promptFor({ role, text: ev.text || "", thread }));
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
