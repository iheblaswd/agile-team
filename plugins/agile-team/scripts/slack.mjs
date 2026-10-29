#!/usr/bin/env node
// Slack client for the agile-team plugin. Zero dependencies.
//   node slack.mjs post "text" [--thread <ts>] [--mention]     # --mention prefixes the human's @handle
//   node slack.mjs read [--hours 24] [--from-human]             # recent channel messages, newest last
//   node slack.mjs approvals [--hours 72]                       # human messages that look like decisions
// Needs SLACK_BOT_TOKEN (scopes: chat:write, channels:history, channels:read) and SLACK_CHANNEL_ID in team/.env.
import { loadConfig, requireEnv, parseArgs } from "./config.mjs";

const cfg = loadConfig();
requireEnv("SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID");
const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_CHANNEL_ID;
const humanUserId = process.env.SLACK_HUMAN_USER_ID || cfg.human?.slackUserId || "";

async function api(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

export async function post(text, { thread, mention } = {}) {
  const prefix = mention && humanUserId ? `<@${humanUserId}> ` : "";
  const body = { channel, text: prefix + text, unfurl_links: false };
  if (thread) body.thread_ts = thread;
  const r = await api("chat.postMessage", body);
  return { ts: r.ts, channel: r.channel };
}

export async function read({ hours = 24, fromHuman = false } = {}) {
  const oldest = String(Date.now() / 1000 - hours * 3600);
  const r = await api("conversations.history", { channel, oldest, limit: 200 });
  let msgs = r.messages.map((m) => ({ ts: m.ts, user: m.user || m.bot_id, text: m.text, thread: m.thread_ts || null })).reverse();
  if (fromHuman && humanUserId) msgs = msgs.filter((m) => m.user === humanUserId);
  return msgs;
}

// Decision-looking messages, English or French. Anything else from the human is feedback (team-protocol §4b).
const DECISION_RE = /\b(approve[ds]?|approuv[ée]e?s?|accept[ée]e?s?|valid[ée]e?s?|validated?|ok|oui|yes|go|lgtm|c'est bon|reject(ed)?|rejet[ée]e?s?|refus[ée]e?s?|non|no|not yet|later|plus tard|change)\b/i;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (cmd) {
    case "post": return post(a._[0], { thread: a.thread, mention: !!a.mention });
    case "read": return read({ hours: Number(a.hours || 24), fromHuman: !!a["from-human"] });
    case "approvals": {
      const msgs = await read({ hours: Number(a.hours || 72), fromHuman: true });
      return msgs.filter((m) => DECISION_RE.test(m.text || ""));
    }
    default: console.error("usage: slack.mjs post|read|approvals"); process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("slack.mjs")) {
  main().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
