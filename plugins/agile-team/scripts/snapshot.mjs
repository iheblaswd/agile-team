#!/usr/bin/env node
// One-shot state of the team: active sprint, issues grouped by status and agent, open decisions,
// blocked keys, recent git activity per repo, recent human messages in Slack. Used by /tick and /daily.
//   node snapshot.mjs [--hours 24] [--no-slack]
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadConfig, parseArgs } from "./config.mjs";

const cfg = loadConfig();
const a = parseArgs(process.argv.slice(2));
const here = dirname(fileURLToPath(import.meta.url));
const hours = Number(a.hours || 24);

function node(script, args) {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { encoding: "utf8", cwd: cfg.__root });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").trim() };
  try { return JSON.parse(r.stdout); } catch { return { error: r.stdout }; }
}
function sh(cmd, cwd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", cwd });
  return (r.stdout || "").trim();
}

const S = cfg.jira.statuses;
const sprint = node("jira.mjs", ["sprint", "active"]);
const issues = node("jira.mjs", ["issues", "--jql", `project = ${cfg.jira.projectKey} AND (sprint in openSprints() OR status in ("${S.inReview}", "${S.toFix}", "${S.awaitingValidation}")) AND labels != decision ORDER BY priority DESC, created ASC`, "--max", "200"]);
const decisions = node("jira.mjs", ["decision", "list"]);
const blocked = Array.isArray(decisions) ? [...new Set(decisions.flatMap((d) => d.blocks || []))] : [];

const byStatus = {}, byAgent = {};
if (Array.isArray(issues)) for (const i of issues) {
  i.blockedByDecision = blocked.includes(i.key);
  (byStatus[i.status] ||= []).push(i.key);
  (byAgent[i.agent || "unassigned"] ||= []).push({ key: i.key, status: i.status, summary: i.summary, blocked: i.blockedByDecision });
}

const repos = (cfg.repos || []).map((r) => {
  const path = join(cfg.__root, r.path || r.name);
  if (!existsSync(join(path, ".git"))) return { name: r.name, path, error: "not a git repo (clone it or fix repos[].path)" };
  sh("git fetch --all --prune --quiet", path);
  return {
    name: r.name, path, owner: r.owner,
    branch: sh("git rev-parse --abbrev-ref HEAD", path),
    dirty: sh("git status --porcelain", path).split("\n").filter(Boolean).length,
    recentCommits: sh(`git log --all --since="${hours} hours ago" --pretty=format:"%h %an %s" -n 30`, path).split("\n").filter(Boolean),
    branches: sh("git branch -r --list 'origin/feat/*' --list 'origin/fix/*' --format='%(refname:short)'", path).split("\n").filter(Boolean),
    openPRs: sh("gh pr list --state open --json number,title,headRefName,reviewDecision,statusCheckRollup --limit 30 2>/dev/null", path),
  };
});

const slack = a["no-slack"] ? null : node("slack.mjs", ["read", "--hours", String(hours), "--from-human"]);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  project: cfg.project, human: cfg.human?.name, sprintLengthDays: cfg.sprint?.lengthDays,
  sprint, counts: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])),
  byStatus, byAgent, decisions, blocked, issues, repos, humanMessages: slack,
}, null, 2));
