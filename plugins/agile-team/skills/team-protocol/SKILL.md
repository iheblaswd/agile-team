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

**Active team.** A developer with `enabled: false`, or listed under `developersParked[]`, and a
role with `roles.<id>.enabled: false`, does not exist for the team: never spawn it, never assign it
a ticket, never count its capacity, never mention it in the daily. Tickets labelled `agent:<parked>`
are reported once in the room as "owner parked — needs reassignment" and left alone.

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

### 3a. Writing for the human (non-technical reader)

The human is a product person, not a developer. Two layers, always:

1. **Human layer** — `--human "…"` on every message that concerns them: what changed *for the
   product or the user*, what they can see or try, and what (if anything) is expected from them.
   Written in `conventions.humanLanguage` (French when `fr`), plain words, no jargon, no sha, no
   command, no file path, no test counts. 1–4 lines. Say "la validation du manifeste refuse
   maintenant un fichier incomplet avec un message clair" — never "zod schema strict, 30 tests".
2. **Technical layer** — the `--title/--body` as before, in English, for the other agents. It stays
   in Jira and `team/chat`; with `slack.audience = "human"` it never reaches Slack.

Messages that MUST carry `--human`: spec written · sprint proposed/created · MR accepted (what the
feature now does) · MR rejected (what is being redone, in product terms) · deployed to staging
(where to try it) · daily · review package · release candidate / released · every answer to the
human and every correction taken into account. Agent-to-agent handoffs (started, MR ready,
adjustment needed, chores) carry no `--human`.

Jira wording: ticket **titles** are product sentences the human would use ("Refuser un fichier
de configuration incomplet avec un message clair"), not implementation ("Validate
forge.template.json with zod"). Story descriptions follow the PO's two-part layout (§ agent po).
Comments addressed to the human start with `📌 Pour <human> :`.

### 3b. Questions between agents (answered in the same tick)

A question is a room message whose title starts with `QUESTION:` plus a label on the ticket
that names who must answer: `question:po` (scope / acceptance criteria), `question:tech-lead`
(design, contract, conventions), `question:<dev-id>` (something only that developer knows).

```
node $P/room.mjs say --from dev-ts --to po --ticket KEY --title "QUESTION: does the --dry-run output include the file list?" --body "Context ...\nOption A ...\nOption B ...\nI continue with my next ticket meanwhile."
node $P/jira.mjs label KEY --add question:po
```

Rules:
- The asker does not wait: it moves to its next ticket. The ticket keeps its status and its
  `agent:<asker>` label.
- The `/tick` runs a **questions round** right after the developers (tick §3b): it spawns the
  addressee with every open `question:*` ticket, the addressee answers with a room message
  titled `ANSWER: …` (same ticket, `--to <asker>`), updates the ticket description / acceptance
  criteria so the answer lives in the ticket, then removes the label
  (`jira.mjs label KEY --remove question:po`). The asker is then re-spawned once on that ticket.
- One round per tick. A question that the addressee cannot answer from the context file or the
  ticket becomes a `BLOCKER` decision to the human (raised by the addressee, never by the asker).
- `ANSWER:` messages count as a MUST-announce event. Never answer a question only in prose:
  the ticket must be updated.

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

**Replies in natural language, French or English.** The human is not expected to know the
syntax. `ok`, `oui`, `validé`, `approuvé`, `c'est bon`, `go` = approved; `non`, `refusé`,
`rejeté`, `pas comme ça` = rejected, the rest of the message is the reason. A key in the message
targets that decision; no key = the only open decision of that type, else ask once with `--mention`.
`approuvé sauf FORGE-3 : …` / `approved except KEY: …` = approved with exceptions (sprint review).

**Resolving.** At the start of every `/tick` and `/daily`, read `node $P/slack.mjs approvals`
(and the latest `team/chat/*.md` if the human writes there). Match a human message to an open
decision by key, or by type if only one of that type is open. Resolve it, announce
"Decision KEY: APPROVED/REJECTED — resuming X", then continue the blocked path. If the human's
message is ambiguous, ask once in the room with `--mention` and do not resolve.

### 4b. Human feedback (anything that is not a decision)

The human only validates and asks for corrections. Every human message in Slack or in
`team/chat/*.md` that is not a reply to an open decision is **feedback** and is handled by the
team, never left for the human to turn into a ticket:

- Mentions a key (`FORGE-3`, `#3`, "le ticket 3") and asks for a change → that ticket goes to
  `toFix` (from `awaitingValidation`, `inReview` or `done`; a `done` ticket reopens), relabel to
  its last developer, comment the human's words verbatim as "Correction requested by <human>:
  …", say `[po → <dev>] KEY · correction requested` in the room.
- Describes something new ("il faudrait aussi…", "on pourrait…") → the PO writes a story in the
  backlog (size, AC, owner hint) and answers `[po → <human>] FORGE-n · created from your
  feedback: <title>` so the human sees it was heard. It enters a sprint through the normal
  planning, never silently.
- Asks a question → the right role answers in the room, `--mention`, within the tick.
- Ambiguous → one clarifying question with `--mention`, nothing else; never guess on behalf of
  the human.

Processed messages are recorded by Slack `ts` (or chat timestamp) in `team/logs/feedback.json`
so a message is handled once. Handled by the `tick` §1b and the `daily` step 2.

### 4c. Decisions taken directly in Jira

The human may act on the board instead of writing. Agents never move a ticket to `done`, so:

- A ticket in `done` that no `SPRINT_VALIDATION` recorded = **validated by the human in Jira**.
  The scrum-master records it (`team/sprints/sprint-NN/review.md`, row "validated in Jira on
  <date>"), posts `[scrum-master → team] KEY · validated by <human> in Jira`, and resolves the
  open `SPRINT_VALIDATION` for that key if one exists (`decided:approved` note "via Jira").
  When every sprint ticket is `done` or carried over, the sprint is closed and the `retro` runs,
  exactly as after a Slack answer.
- A ticket moved back to `toFix` by the human (no `MR … rejected` comment from the tech-lead
  since it left `awaitingValidation`/`done`) = **correction requested**. If the human left a
  comment, it is the correction; relabel to the last developer and announce it. If there is no
  comment, the PO asks once in Slack with `--mention` ("FORGE-3 is back in To Fix — what should
  change?") and the ticket waits; nothing is guessed.
- A ticket the human created in the backlog = a story to refine: the PO completes it (AC, size,
  owner hint) at the next tick and says so.

Slack and Jira are equivalent inputs; neither is required for the other to work.

### 4d. Live chat (optional, `slack-listen.mjs`)

When the chat listener runs, every human message in the channel gets an answer in its thread
within about a minute, from the role it names ("PO, …", "tech lead …", "dev-ts …") or the
Scrum Master by default; a thread keeps talking to the same role. The agent answers from the real
state, applies decisions (§4), corrections and new needs (§4b) immediately, never codes or merges,
and ends with `[[TICK]]` when work must start now (the listener then starts the tick task). Handled
messages are recorded in `team/logs/feedback.json` with `by: "chat"`; the tick skips them. If the
listener is down, nothing is lost: the tick handles the message at its next run.

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
