# agile-team

A reusable AI Scrum team for Claude Code: **PO · Scrum Master · N developers · Tech Lead · DevOps · UX designer**,
one human. The team works on **Jira**, talks in **Slack** (every message is also a Jira comment and a line in
`team/chat/`), and stops at three human gates — sprint approval, sprint validation, release approval — while
continuing on everything that is not blocked.

```
Backlog → Selected for Sprint → In Progress → In Review ─accept→ Awaiting Validation ─human→ Done
                                      ▲             │
                                      └── To Fix ◄──┘ reject (numbered reasons, reassigned)
```

## Components

| Type | Name | Purpose |
|---|---|---|
| skill | `team-protocol` | The rules every agent follows: statuses, labels, room message format, decision gates, handoffs |
| skill | `/agile-team:team-setup` | One-time per project: config, folders, Jira/Slack/GitHub walkthrough, connectivity check |
| skill | `/agile-team:sprint-plan` | PO refines → SM proposes → **you approve** → sprint created |
| skill | `/agile-team:tick` | Heartbeat: resolve decisions, dispatch devs (parallel) → tech lead → devops |
| skill | `/agile-team:daily` | 09:00 standup per agent, open decisions on top |
| skill | `/agile-team:sprint-review` | Review package → **you validate** → done / back to fix → retro |
| skill | `/agile-team:retro` | Facts, 3 actions max, actions become Jira tasks |
| skill | `/agile-team:release` | Candidate → **you approve** → publish/deploy step by step |
| agents | `po`, `scrum-master`, `developer` (one instance per dev), `tech-lead`, `devops`, `ux-designer` | Each carries its playbook |
| scripts | `scripts/jira.mjs`, `slack.mjs`, `room.mjs`, `snapshot.mjs` | Zero-dependency Node clients; all output JSON |
| mcp | — | Not required; add the Atlassian MCP yourself with `claude mcp add` if you want ad-hoc Jira browsing |

## Install

```
/plugin marketplace add <path-or-git-url-of-this-folder>
/plugin install agile-team@agile-team-marketplace
```
Then in each project: `/agile-team:team-setup`.

## Per-project files (created by team-setup)

```
team/
├── team.config.json   # project key, statuses, repos, developers (id/stack/scope/skills), roles, cadence
├── .env               # JIRA_*, SLACK_* (gitignored)
├── TEAM.md            # roster + working agreements (retro actions land here)
├── checklists/        # review checklists per stack, used by the tech lead
├── chat/              # YYYY-MM-DD.md — the room log
├── dailies/ sprints/sprint-NN/{goal,review,retro}.md  releases/  design/<KEY>/  logs/
```

Project-specific knowledge stays in the project: put a skill under `.claude/skills/` and list it in
`developers[].skills` — the developer agent loads it before coding.

## Unattended runs

`scripts/install-schedules.ps1` registers two Windows scheduled tasks (`claude -p "/agile-team:daily"` at
09:00, `/agile-team:tick` every 45 min). Add `templates/settings.allow.json` rules to the project's
`.claude/settings.json` so runs do not stop on permission prompts.

## Environment variables (team/.env)

`JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_HUMAN_USER_ID`.

## How a decision works

1. An agent runs `room.mjs decision --type SPRINT_APPROVAL …` → a Jira issue labelled `decision`,
   `awaiting:<you>`, linked "blocks" to the tickets it holds; Slack pings you with `@mention`.
2. You answer in Slack: `approved PROJ-42` or `rejected PROJ-42: move the auth story out`.
3. The next tick/daily reads your messages, resolves the decision, announces it, and resumes the
   blocked path. Everything not linked to the decision never stopped.
