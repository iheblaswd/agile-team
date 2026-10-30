#!/usr/bin/env node
// The "room": one message, three destinations — Slack channel, Jira comment, team/chat/<date>.md.
//   node room.mjs say --from dev-java --to dev-ts --title "backend done" [--ticket KEY] [--body "..."] [--human "plain-language line(s) for the human"] [--mention] [--no-slack] [--no-jira]
//   --human: what this means for the product, in the human's language (conventions.humanLanguage). Jira gets it on top of the technical text,
//            the chat log gets both, Slack gets ONLY the human text when slack.audience = "human" (technical chatter stays in Jira).
//            With slack.audience = "human", a message without --human and without --mention is not posted to Slack at all.
//   node room.mjs decision --type SPRINT_APPROVAL --summary "..." [--body "..."] [--blocks KEY1,KEY2]
//       -> creates the Jira decision, posts to Slack with @mention, logs to chat file; prints the decision key
// Slack failures never block the Jira comment or the chat log (and vice versa); failures are reported in the JSON output.
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, today, nowStamp } from "./config.mjs";

const cfg = loadConfig();
const tz = cfg.human?.timezone || "UTC";
const here = dirname(fileURLToPath(import.meta.url));

function run(script, args) {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { encoding: "utf8", cwd: cfg.__root });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").trim());
  return JSON.parse(r.stdout || "null");
}

function format({ from, to, ticket, title, body }) {
  const head = `[${from}${to ? ` → ${to}` : ""}]${ticket ? ` ${ticket} ·` : ""} ${title}`;
  return body ? `${head}\n${String(body).replace(/\\n/g, "\n")}` : head;
}

function logChat(text) {
  const dir = join(cfg.__root, "team", "chat");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${today(tz)}.md`);
  appendFileSync(file, `\n### ${nowStamp(tz)}\n${text}\n`);
  return file;
}

const humanName = cfg.human?.name || "the human";
const humanOnly = (cfg.slack?.audience || "team") === "human";
const ROLE_FR = { po: "Product Owner", "scrum-master": "Scrum Master", "tech-lead": "Tech Lead", devops: "DevOps", "ux-designer": "Designer", team: "l'équipe" };
function roleLabel(id) { return ROLE_FR[id] || (id?.startsWith("dev-") ? `Développeur (${id.slice(4)})` : id); }

// Slack text for the human: no brackets, no sha, no commands — just the human line(s) and where to look.
function humanSlackText({ from, ticket, human }) {
  const where = ticket ? ` · ${ticket}` : "";
  const body = String(human).replace(/\\n/g, "\n").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/`([^`\n]+)`/g, "$1");
  return `*${roleLabel(from)}${where}*\n${body}`;
}

async function say(a) {
  const text = format({ from: a.from || "team", to: a.to, ticket: a.ticket, title: a.title, body: a.body });
  const human = a.human ? String(a.human).replace(/\\n/g, "\n") : "";
  const full = human ? `📌 Pour ${humanName} : ${human}\n\n${text}` : text;
  const out = { text: full, chat: logChat(full), slack: null, jira: null, errors: [] };
  if (!a["no-slack"]) {
    const slackText = humanOnly ? (human ? humanSlackText({ from: a.from || "team", ticket: a.ticket, human }) : (a.mention ? text : null)) : full;
    if (slackText) {
      try { out.slack = run("slack.mjs", ["post", slackText, ...(a.mention ? ["--mention"] : [])]); } catch (e) { out.errors.push(`slack: ${e.message}`); }
    } else out.slack = "skipped (slack.audience=human, no --human)";
  }
  if (a.ticket && !a["no-jira"]) {
    try { out.jira = run("jira.mjs", ["comment", a.ticket, full]); } catch (e) { out.errors.push(`jira: ${e.message}`); }
  }
  return out;
}

async function decision(a) {
  const d = run("jira.mjs", ["decision", "create", "--type", a.type || "BLOCKER", "--summary", a.summary, ...(a.body ? ["--body", a.body] : []), ...(a.blocks ? ["--blocks", a.blocks] : [])]);
  const fr = (cfg.conventions?.humanLanguage || "en") === "fr";
  const TYPE_FR = { SPRINT_APPROVAL: "Validation du sprint", SPRINT_VALIDATION: "Validation des livraisons", RELEASE_APPROVAL: "Autorisation de mise en production", BLOCKER: "Décision à prendre" };
  const blocked = d.blocks?.length ? d.blocks.join(", ") : null;
  const footer = fr
    ? `${blocked ? `En attente de ta réponse : ${blocked}.` : "Rien n'est bloqué, l'équipe continue."}\nRéponds ici par « validé » ou « refusé : <raison> » (tu peux aussi écrire « validé sauf FORGE-x : … »).\n${d.url}`
    : `Blocked until you answer: ${blocked || "nothing — the team keeps working"}\nReply here with "approved ${d.key}" or "rejected ${d.key}: <reason>". Link: ${d.url}`;
  const humanText = `${a.human ? String(a.human).replace(/\\n/g, "\n") : a.summary}\n${footer}`;
  const text = format({
    from: a.from || "scrum-master", to: humanName, ticket: d.key,
    title: `DECISION NEEDED · ${d.type}`,
    body: `${a.summary}${a.body ? "\n" + a.body : ""}\n${footer}`,
  });
  const full = a.human ? `📌 Pour ${humanName} : ${humanText}\n\n${text}` : text;
  const out = { decision: d, chat: logChat(full), slack: null, errors: [] };
  const slackText = humanOnly ? `*${fr ? (TYPE_FR[d.type] || d.type) : d.type} · ${d.key}*\n${humanText}` : full;
  try { out.slack = run("slack.mjs", ["post", slackText, "--mention"]); } catch (e) { out.errors.push(`slack: ${e.message}`); }
  try { run("jira.mjs", ["comment", d.key, full]); } catch (e) { out.errors.push(`jira: ${e.message}`); }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const a = parseArgs(rest);
(cmd === "say" ? say(a) : cmd === "decision" ? decision(a) : Promise.reject(new Error("usage: room.mjs say|decision")))
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => { console.error(e.message); process.exit(1); });
