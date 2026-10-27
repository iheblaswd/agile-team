#!/usr/bin/env node
// Jira Cloud REST client for the agile-team plugin. Zero dependencies.
// Usage (run from inside a project that has team/team.config.json):
//   node jira.mjs issues --jql "sprint in openSprints()"
//   node jira.mjs get KEY
//   node jira.mjs create --type Story --summary "..." [--description "..."] [--labels a,b] [--parent KEY] [--priority High]
//   node jira.mjs transition KEY "In Review"
//   node jira.mjs comment KEY "text (\\n for new lines)"
//   node jira.mjs label KEY [--add a,b] [--remove c]
//   node jira.mjs assign KEY <agent-id>            # sets label agent:<id>, removes other agent:* labels
//   node jira.mjs sprint create --name "Sprint 3" [--goal "..."]
//   node jira.mjs sprint start <id> [--days 7]
//   node jira.mjs sprint close <id>
//   node jira.mjs sprint add <id> KEY1,KEY2
//   node jira.mjs sprint active
//   node jira.mjs decision create --type SPRINT_APPROVAL --summary "..." [--body "..."] [--blocks KEY1,KEY2]
//   node jira.mjs decision list
//   node jira.mjs decision resolve KEY --outcome approved|rejected [--note "..."]
//   node jira.mjs blocked                            # keys currently blocked by an open decision
// All commands print JSON on stdout.
import { loadConfig, requireEnv, parseArgs } from "./config.mjs";

const cfg = loadConfig();
requireEnv("JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN");
const J = cfg.jira;
const KEY = J.projectKey;
const auth = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
const base = process.env.JIRA_SITE.replace(/\/$/, "");

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function adf(text) {
  const paragraphs = String(text).replace(/\\n/g, "\n").split(/\n{2,}/);
  return {
    type: "doc", version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => (i ? [{ type: "hardBreak" }, { type: "text", text: line || " " }] : [{ type: "text", text: line || " " }])),
    })),
  };
}

function slim(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary,
    type: f.issuetype?.name,
    status: f.status?.name,
    labels: f.labels || [],
    agent: (f.labels || []).find((l) => l.startsWith("agent:"))?.slice(6) || null,
    priority: f.priority?.name,
    parent: f.parent?.key || null,
    sprint: f.sprint?.name || null,
    updated: f.updated,
    // Jira semantics on issue X: a link carrying `outwardIssue: Y` means "Y blocks X";
    // a link carrying `inwardIssue: Y` means "X blocks Y".
    blockedBy: (f.issuelinks || []).filter((l) => l.type?.name === "Blocks" && l.outwardIssue).map((l) => l.outwardIssue.key),
    blocks: (f.issuelinks || []).filter((l) => l.type?.name === "Blocks" && l.inwardIssue).map((l) => l.inwardIssue.key),
    description: f.description ? adfToText(f.description) : "",
  };
}

function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(adfToText).join("");
  return node.type === "paragraph" || node.type === "heading" || node.type === "listItem" ? inner + "\n" : inner;
}

const FIELDS = ["summary", "issuetype", "status", "labels", "priority", "parent", "sprint", "updated", "issuelinks", "description"];

async function search(jql, max = 100) {
  const out = [];
  let nextPageToken;
  do {
    const body = { jql, fields: FIELDS, maxResults: Math.min(max, 100) };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const r = await api("POST", "/rest/api/3/search/jql", body);
    out.push(...(r.issues || []).map(slim));
    nextPageToken = r.nextPageToken;
  } while (nextPageToken && out.length < max);
  return out;
}

async function transition(key, statusName) {
  const r = await api("GET", `/rest/api/3/issue/${key}/transitions`);
  const t = r.transitions.find((x) => x.to?.name?.toLowerCase() === statusName.toLowerCase() || x.name.toLowerCase() === statusName.toLowerCase());
  if (!t) throw new Error(`No transition to "${statusName}" from current status of ${key}. Available: ${r.transitions.map((x) => x.to?.name).join(", ")}`);
  await api("POST", `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
  return { key, status: t.to?.name };
}

async function labels(key, add = [], remove = []) {
  const update = [...add.map((l) => ({ add: l })), ...remove.map((l) => ({ remove: l }))];
  await api("PUT", `/rest/api/3/issue/${key}`, { update: { labels: update } });
  return { key, added: add, removed: remove };
}

async function boardId() {
  if (J.boardId) return J.boardId;
  const r = await api("GET", `/rest/agile/1.0/board?projectKeyOrId=${KEY}`);
  if (!r.values?.length) throw new Error(`No board found for project ${KEY}. Set jira.boardId in team.config.json.`);
  return r.values[0].id;
}

const humanLabel = `awaiting:${(cfg.human?.id || "human").toLowerCase()}`;

async function decisionList() {
  const list = await search(`project = ${KEY} AND labels = decision AND labels = "${humanLabel}" AND statusCategory != Done ORDER BY created ASC`);
  return list.map((d) => ({
    key: d.key, summary: d.summary, created: d.updated,
    type: d.labels.find((l) => l.startsWith("decision:"))?.slice(9) || null,
    blocks: d.blocks,
    body: d.description,
  }));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  const S = J.statuses;
  switch (cmd) {
    case "issues": return search(a.jql || `project = ${KEY} ORDER BY updated DESC`, Number(a.max || 100));
    case "get": return (await search(`key = ${a._[0]}`))[0];
    case "create": {
      const fields = {
        project: { key: KEY }, summary: a.summary, issuetype: { name: a.type || "Task" },
        description: adf(a.description || ""),
        labels: a.labels ? String(a.labels).split(",") : [],
      };
      if (a.parent) fields.parent = { key: a.parent };
      if (a.priority) fields.priority = { name: a.priority };
      const r = await api("POST", "/rest/api/3/issue", { fields });
      return { key: r.key, url: `${base}/browse/${r.key}` };
    }
    case "transition": return transition(a._[0], a._[1]);
    case "comment": {
      await api("POST", `/rest/api/3/issue/${a._[0]}/comment`, { body: adf(a._[1]) });
      return { key: a._[0], commented: true };
    }
    case "label": return labels(a._[0], a.add ? String(a.add).split(",") : [], a.remove ? String(a.remove).split(",") : []);
    case "assign": {
      const issue = (await search(`key = ${a._[0]}`))[0];
      const remove = issue.labels.filter((l) => l.startsWith("agent:"));
      return labels(a._[0], [`agent:${a._[1]}`], remove);
    }
    case "sprint": {
      const sub = a._[0];
      const bid = await boardId();
      if (sub === "create") {
        const r = await api("POST", "/rest/agile/1.0/sprint", { name: a.name, goal: a.goal || "", originBoardId: bid });
        return { id: r.id, name: r.name, state: r.state };
      }
      if (sub === "start") {
        const days = Number(a.days || cfg.sprint?.lengthDays || 7);
        const start = new Date(); const end = new Date(start.getTime() + days * 86400000);
        const r = await api("POST", `/rest/agile/1.0/sprint/${a._[1]}`, { state: "active", startDate: start.toISOString(), endDate: end.toISOString() });
        return { id: r.id, name: r.name, state: r.state, endDate: r.endDate };
      }
      if (sub === "close") { const r = await api("POST", `/rest/agile/1.0/sprint/${a._[1]}`, { state: "closed" }); return { id: r.id, state: r.state }; }
      if (sub === "add") { await api("POST", `/rest/agile/1.0/sprint/${a._[1]}/issue`, { issues: String(a._[2]).split(",") }); return { sprint: a._[1], added: a._[2].split(",") }; }
      if (sub === "active") { const r = await api("GET", `/rest/agile/1.0/board/${bid}/sprint?state=active`); return r.values.map((s) => ({ id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate })); }
      if (sub === "future") { const r = await api("GET", `/rest/agile/1.0/board/${bid}/sprint?state=future`); return r.values.map((s) => ({ id: s.id, name: s.name, goal: s.goal })); }
      throw new Error(`unknown sprint subcommand ${sub}`);
    }
    case "decision": {
      const sub = a._[0];
      if (sub === "create") {
        const type = String(a.type || "BLOCKER").toUpperCase();
        const fields = {
          project: { key: KEY }, summary: `[DECISION ${type}] ${a.summary}`,
          issuetype: { name: J.decisionIssueType || "Task" },
          description: adf(a.body || a.summary),
          labels: ["decision", `decision:${type}`, humanLabel],
        };
        const r = await api("POST", "/rest/api/3/issue", { fields });
        const blocks = a.blocks ? String(a.blocks).split(",").filter(Boolean) : [];
        for (const k of blocks) {
          await api("POST", "/rest/api/3/issueLink", { type: { name: "Blocks" }, outwardIssue: { key: r.key }, inwardIssue: { key: k } });
        }
        return { key: r.key, url: `${base}/browse/${r.key}`, type, blocks };
      }
      if (sub === "list") return decisionList();
      if (sub === "resolve") {
        const key = a._[1]; const outcome = String(a.outcome || "approved").toLowerCase();
        await api("POST", `/rest/api/3/issue/${key}/comment`, { body: adf(`Decision: ${outcome.toUpperCase()}${a.note ? "\n" + a.note : ""}`) });
        await labels(key, [`decided:${outcome}`], [humanLabel]);
        try { await transition(key, S.done || "Done"); } catch (e) { /* workflow may not allow; label is the source of truth */ }
        return { key, outcome };
      }
      throw new Error(`unknown decision subcommand ${sub}`);
    }
    case "blocked": {
      const ds = await decisionList();
      return [...new Set(ds.flatMap((d) => d.blocks))];
    }
    default:
      console.error("unknown command. See header of jira.mjs for usage.");
      process.exit(1);
  }
}

main().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
