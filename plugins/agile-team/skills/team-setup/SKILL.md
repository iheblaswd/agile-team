---
name: team-setup
description: >
  This skill should be used when the user runs "/team-setup", says "set up the agile team for
  this project", "install the agile team", "configure the team on this project", or when any
  other agile-team skill finds no team/team.config.json. It creates the per-project
  configuration, the team/ folders, the Claude settings allow-list, walks the user through the
  one-time Jira / Slack / GitHub setup, and verifies the connection.
metadata:
  version: "0.1.0"
---

# Team setup (one time per project)

Goal: a filled `team/team.config.json`, a `team/.env` with working credentials, the `team/`
folders, and a green connectivity check. Keep the user-facing conversation in plain language.

## 1. Gather the project facts

Read the project's context file if there is one (`CLAUDE.md`, `README.md`) to prefill:
project name, repos, stacks, conventions. Then ask only what is still unknown, using
AskUserQuestion, grouped:

1. Project key for Jira (e.g. `FORGE`), Jira site URL, board id if known.
2. Slack channel name; whether Slack is used at all.
3. Developers: id, display name, stack, scope (paths/repos they own), project skills to load
   (e.g. `forge-spring`). Default is two: a backend dev and a frontend/TS dev.
4. Optional roles: ux-designer, devops (default both enabled). Suggest disabling a role or a
   developer whose scope does not exist yet (e.g. a backend dev before the backend repo is
   created): `roles.<id>.enabled=false`, or move the developer entry to `developersParked[]`
   with `enabled: false` so it can be restored later with one edit.
5. Sprint length (default 7 days), planning day, review day, daily time, timezone.
6. Human: name, short id (used in labels, e.g. `iheb`), Slack user id (can be filled later).

## 2. Write the files

- `team/team.config.json` from `${CLAUDE_PLUGIN_ROOT}/templates/team.config.example.json`,
  filled with the answers. Keep unknown values as `""`, never invent ids.
- `team/.env.example` from `${CLAUDE_PLUGIN_ROOT}/templates/env.example`; create `team/.env`
  only if the user pastes credentials in the chat, and add `team/.env` to `.gitignore`.
- Folders: `team/chat/`, `team/dailies/`, `team/sprints/`, `team/releases/`, `team/design/`, `team/logs/`.
- `team/TEAM.md` from `${CLAUDE_PLUGIN_ROOT}/templates/TEAM.md` with the roster filled in.
- Merge into `.claude/settings.json` the allow rules from
  `${CLAUDE_PLUGIN_ROOT}/templates/settings.allow.json` (so unattended runs do not stop on prompts).

## 3. Walk the user through the external setup

Present as a short numbered checklist (the user does these in a browser; offer to drive the
browser if a browser tool is available):

1. **Jira**: create the project (Scrum, company- or team-managed), then the statuses exactly as
   in `jira.statuses`, the issue type for decisions (or keep `Task`), make sure the `Blocks`
   link type exists (default), create an API token at id.atlassian.com → `JIRA_EMAIL`,
   `JIRA_API_TOKEN`, `JIRA_SITE`.
2. **Slack**: create the channel, create a Slack app with bot scopes `chat:write`,
   `channels:history`, `channels:read`, `users:read`, install it to the workspace, invite the bot
   to the channel → `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`; the user's member id → `SLACK_HUMAN_USER_ID`.
3. **GitHub**: `gh auth login` on this machine; repos cloned at `repos[].path`; branch
   protection on `main` (PR + green CI required).
4. Optional: Atlassian MCP (`claude mcp add --transport sse atlassian https://mcp.atlassian.com/v1/sse`)
   for ad-hoc Jira browsing — the scripts do not need it.

## 4. Verify

Run, from the project root:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/jira.mjs sprint future
node ${CLAUDE_PLUGIN_ROOT}/scripts/slack.mjs post "agile-team connected ✅" 
node ${CLAUDE_PLUGIN_ROOT}/scripts/snapshot.mjs --hours 1
```
Report each as pass/fail with the exact error if any, and fix config problems (wrong status
names are the usual one: compare with the Jira workflow).

## 4b. Live chat (optional)

If the user wants to talk to the team in Slack and get answers right away: create the Slack app
from `${CLAUDE_PLUGIN_ROOT}/templates/slack-app-manifest.json` (Socket Mode on, bot event
`message.channels`), create an App-Level Token with `connections:write` → `SLACK_APP_TOKEN`
in `team/.env`, then add `-Chat` to the schedules command below. Needs Node >= 22.4.

## 5. Schedules

The team is meant to run unattended: the human only answers in Slack. Register the two runs
(daily at `sprint.dailyTime`, tick every `sprint.tickMinutes`) at the end of the setup unless
the user explicitly wants manual runs first; if Slack is disabled, say that decisions and
feedback will then only be read from `team/chat/*.md`:
```
powershell -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/install-schedules.ps1 -ProjectRoot "<root>" -DailyTime 09:00 -TickMinutes 60 -From 08:00 -To 19:00 -Weekdays
```
On macOS/Linux, give the equivalent two `crontab` lines running `claude -p "/agile-team:daily"`
and `claude -p "/agile-team:tick"` from the project root.

End with: what is configured, what is still missing, and "run `/agile-team:sprint-plan` to start Sprint 1".
