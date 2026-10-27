---
name: team-protocol
description: >
  This skill should be used by every agile-team agent (po, scrum-master, developer, tech-lead,
  devops, ux-designer) and by the ceremony skills before touching Jira, Slack or the chat log.
  It defines the Jira workflow, the "room" message format, the human decision gates, the labels
  and the helper scripts. Load it when working on a ticket, posting to the team, creating a
  sprint, requesting a decision, or whenever "team-protocol", "the room", "decision gate" or
  "agile-team workflow" is mentioned.
metadata:
  version: "0.1.0"
---

# Team protocol

Everything the team does is visible in three places with the **same text**: the Slack channel,
a comment on the Jira ticket, and `team/chat/<YYYY-MM-DD>.md`. Never post in only one place.
Never act on a human gate without a recorded decision.

## 0. Load the project configuration first

Read `team/team.config.json` at the project root (walk up from the current directory if needed).
It defines: `project`, `human` (name, id, timezone, slackUserId), `jira` (projectKey, boardId,
statuses, decisionIssueType), `slack.channel`, `repos[]`, `developers[]`, `roles`, `sprint`,
`projectSkills`, `reviewChecklists`. Credentials live in `team/.env` (never print them).

If the file is missing, stop and tell the user to run `/agile-team:team-setup`.

Set `$P` to the plugin scripts directory: `${CLAUDE_PLUGIN_ROOT}/scripts`. Run every script
from the project root with `node`.

## 1. Jira workflow (status names come from `jira.statuses`)

```
backlog → selectedForSprint → inProgress → inReview ─accept→ awaitingValidation ─human→ done
                                   ▲            │
                                   └── toFix ◄──┘ reject
```

| Transition | Who | Required message |
|---|---|---|
| backlog → selectedForSprint | scrum-master, only after SPRINT_APPROVAL | "Sprint N created" |
| selectedForSprint → inProgress | developer | "Started KEY" |
| inProgress → inReview | developer, after PR opened | "MR `<branch>` ready for review" |
| inReview → awaitingValidation | tech-lead, after merge | "MR `<branch>` accepted" |
| inReview → toFix | tech-lead | "MR `<branch>` rejected" + reasons |
| toFix → inProgress | developer | "Fixing KEY" |
| awaitingValidation → done | **human only** (via SPRINT_VALIDATION) | — |

Agents never move a ticket to `done`. Agents never move a ticket backwards except `inReview → toFix`.

## 2. Labels

- `agent:<id>` — who owns the ticket now (`agent:dev-ts`, `agent:tech-lead`…). Exactly one per ticket. Set with `node $P/jira.mjs assign KEY <id>`.
- `decision`, `decision:<TYPE>`, `awaiting:<human.id>` — decision issues (see §4).
- `decided:approved` / `decided:rejected` — resolved decisions.
- `component:<name>` optional, from `repos[].component`.
- Anything in `jira.extraLabels` is passed through untouched.

## 3. The room — message format

```
[<from> → <to>] <KEY> · <title>
<body: what was done / what is needed / where (branch, PR, contract, URL) / next step>
```

Post with:
```
node $P/room.mjs say --from dev-java --to dev-ts --ticket KEY --title "backend done" --body "Endpoints ...\nContract ...\nNext: ..."
```
Flags: `--mention` adds the human's @handle (use only for gates and blockers); `--no-jira` for
messages without a ticket (daily, retro); `--no-slack` only if the config says `slack.enabled=false`.

Events that MUST be announced: spec written · sprint proposed · sprint created · ticket started ·
backend done → frontend · adjustment needed → backend · frontend done · MR ready · MR accepted ·
MR rejected · deployed to staging · daily · review package · retro · release candidate · released.

Write messages in English, concrete, max ~8 lines. Always include the branch name and/or PR URL
when code is involved. Never paste secrets, tokens or `.env` contents.

## 4. Human decision gates

Four decision types. Each is a Jira issue created with `room.mjs decision`, which also pings the
human on Slack with an @mention and logs it. The human replies in Slack (or in the chat) with
`approved KEY` / `rejected KEY: reason` / `later`.

| Type | Raised by | Blocks |
|---|---|---|
| `SPRINT_APPROVAL` | scrum-master during `/sprint-plan` | the proposed sprint's tickets (link them with `--blocks`) |
| `SPRINT_VALIDATION` | scrum-master during `/sprint-review` | nothing — tickets stay in awaitingValidation |
| `RELEASE_APPROVAL` | devops during `/release` | the publish/deploy step only |
| `BLOCKER` | any agent | only the tickets linked with `--blocks` |

```
node $P/room.mjs decision --type SPRINT_APPROVAL --summary "Sprint 3 proposal" --body "<goal, tickets, owners>" --blocks KEY1,KEY2
node $P/jira.mjs decision list          # open decisions with the keys they block
node $P/jira.mjs blocked                # keys to skip right now
node $P/jira.mjs decision resolve KEY --outcome approved --note "from Slack at 10:42"
```

**Non-blocking rule.** While a decision is open, every agent skips the blocked keys and takes
the next unblocked ticket of its own (`agent:<id>`), in priority order: `toFix` first, then
`inProgress`, then `selectedForSprint`. If nothing is left, do useful unblocked work from
`roles.<id>.idleWork` in the config (tests, docs, CI, refactors flagged by the tech lead) and say
so in the room. Never start a ticket from an unapproved sprint.

**Resolving.** At the start of every `/tick` and `/daily`, read `node $P/slack.mjs approvals`
(and the latest `team/chat/*.md` if the human writes there). Match a human message to an open
decision by key, or by type if only one of that type is open. Resolve it, announce
"Decision KEY: APPROVED/REJECTED — resuming X", then continue the blocked path. If the human's
message is ambiguous, ask once in the room with `--mention` and do not resolve.

## 5. Handoffs between agents

- **backend → frontend**: when the backend part of a ticket is merged or the contract is stable,
  `dev-<backend>` says "backend done" with the contract file + commit and relabels the ticket to
  the frontend dev (`assign`). The ticket stays `inProgress`.
- **frontend → backend adjustment**: `dev-<frontend>` says "adjustment needed" with the exact
  change, relabels back to the backend dev, and takes its next ticket.
- **developer → tech-lead**: PR opened with the ticket key in the title, `inReview`, relabel
  `agent:tech-lead`, say "MR ready for review".
- **tech-lead → developer**: rejected → reasons as a numbered list in the Jira comment, `toFix`,
  relabel to the dev. Accepted → merge, `awaitingValidation`, relabel `agent:devops` if
  `roles.devops.enabled`, else keep `agent:tech-lead`.
- **tech-lead → devops**: "merged on main: KEY, KEY" → devops deploys to staging and says where.
- **ux-designer → frontend**: "mockup delivered" with the path under `team/design/`.

## 6. Git conventions (defaults; `conventions` in the config overrides)

- Branch: `feat/<KEY>-<short-name>` or `fix/<KEY>-<short-name>`, from `main`.
- Commits: Conventional Commits, English, ticket key in the PR title: `feat(planner): snapshot plan (FORGE-12)`.
- One PR per ticket. Never push to `main`. Never force-push. CI must be green before review is requested.
- The project's own context file (`project.contextFile`, usually `CLAUDE.md`) wins over these defaults.

## 7. Snapshot

`node $P/snapshot.mjs` returns the whole state in one JSON (sprint, issues by status/agent,
decisions, blocked keys, repos, recent human Slack messages). Use it instead of many Jira calls.

## 8. Chat log

`team/chat/<date>.md` is append-only and committed to the project repo (not the code repos). The
daily, review and retro files go to `team/dailies/`, `team/sprints/sprint-NN/`, `team/releases/`.
