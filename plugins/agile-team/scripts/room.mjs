#!/usr/bin/env node
// The "room": one message, three destinations — Slack channel, Jira comment, team/chat/<date>.md.
//   node room.mjs say --from dev-java --to dev-ts --title "backend done" [--ticket KEY] [--body "..."] [--mention] [--no-slack] [--no-jira]
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

async function say(a) {
  const text = format({ from: a.from || "team", to: a.to, ticket: a.ticket, title: a.title, body: a.body });
  const out = { text, chat: logChat(text), slack: null, jira: null, errors: [] };
  if (!a["no-slack"]) {
    try { out.slack = run("slack.mjs", ["post", text, ...(a.mention ? ["--mention"] : [])]); } catch (e) { out.errors.push(`slack: ${e.message}`); }
  }
  if (a.ticket && !a["no-jira"]) {
    try { out.jira = run("jira.mjs", ["comment", a.ticket, text]); } catch (e) { out.errors.push(`jira: ${e.message}`); }
  }
  return out;
}

async function decision(a) {
  const d = run("jira.mjs", ["decision", "create", "--type", a.type || "BLOCKER", "--summary", a.summary, ...(a.body ? ["--body", a.body] : []), ...(a.blocks ? ["--blocks", a.blocks] : [])]);
  const human = cfg.human?.name || "the human";
  const text = format({
    from: a.from || "scrum-master", to: human, ticket: d.key,
    title: `DECISION NEEDED · ${d.type}`,
    body: `${a.summary}${a.body ? "\n" + a.body : ""}\nBlocked until you answer: ${d.blocks?.length ? d.blocks.join(", ") : "nothing — the team keeps working"}\nReply here with "approved ${d.key}" or "rejected ${d.key}: <reason>". Link: ${d.url}`,
  });
  const out = { decision: d, chat: logChat(text), slack: null, errors: [] };
  try { out.slack = run("slack.mjs", ["post", text, "--mention"]); } catch (e) { out.errors.push(`slack: ${e.message}`); }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const a = parseArgs(rest);
(cmd === "say" ? say(a) : cmd === "decision" ? decision(a) : Promise.reject(new Error("usage: room.mjs say|decision")))
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => { console.error(e.message); process.exit(1); });
