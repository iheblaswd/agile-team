---
name: tick
description: >
  This skill should be used when the user runs "/tick", says "let the team work", "advance the
  sprint", "process the board", "run the pipeline", or by the scheduled task every N minutes.
  It is the heartbeat of the agile team: resolve human decisions, dispatch each agent on its
  unblocked tickets (developers in parallel, then tech-lead review, then devops), and post every
  handoff in the room. Idempotent — safe to run as often as wanted.
metadata:
  version: "0.1.0"
---

# Tick — one pass of the team

Load `team-protocol`. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`. Work from the project root.
A tick must finish; never wait for a human inside a tick. Budget: at most
`sprint.maxTicketsPerTick` (default 2) ticket actions per developer per tick.

## 0. Lock

If `team/logs/tick.lock` exists and is younger than 2 hours → print "tick already running" and
stop. Else write it; delete it at the end (also on error).

## 1. Decisions first

`node $P/snapshot.mjs`. For each open decision, look for the human's answer in
`humanMessages` (and in `team/chat/<today>.md`). Resolve matched ones with
`jira.mjs decision resolve`, announce the outcome in the room, then:
- `SPRINT_APPROVAL` approved → run step 5 of the `sprint-plan` skill now.
- `SPRINT_VALIDATION` answered → run step 4 of the `sprint-review` skill now.
- `RELEASE_APPROVAL` approved → run step 4 of the `release` skill now.
- `BLOCKER` answered → comment the answer on the blocked tickets; they become eligible below.

Re-run `jira.mjs blocked` to get the final list of keys to skip.

## 2. Planning day check

If today is `sprint.planningDay`, no sprint is active, and no `SPRINT_APPROVAL` is open → run the
`sprint-plan` skill (steps 1–4) and continue the tick on carry-over work only.
If today is `sprint.reviewDay`, a sprint is active and no `SPRINT_VALIDATION` is open → run
`sprint-review` (steps 1–3) and `retro`.

## 3. Developers (parallel)

For each `developers[]` entry, compute its queue from `byAgent[id]` minus blocked keys, ordered
`toFix` → `inProgress` → `selectedForSprint`. If the queue is empty, use `roles.<id>.idleWork`
and announce "no ticket available, doing: <idle work>" (only once per day — check today's chat log).

Spawn one `developer` agent per developer **at the same time**, each with: its config entry
(id, stack, scope, repo paths, projectSkills), its queue (first `maxTicketsPerTick`), the
project context file path, and the handoff rules from `team-protocol §5`. The agent works the
ticket to the next handoff (backend done / adjustment needed / PR ready) and posts it. It never
touches another developer's scope. Wait for all developer agents to finish.

## 4. UX designer

If `roles.ux-designer.enabled` and there are tickets labelled `agent:ux-designer` (unblocked),
spawn `ux-designer` with them. Mockups go to `team/design/<KEY>/` and are announced to the
frontend developer.

## 5. Tech lead

Collect PRs ready for review: tickets in `inReview` with `agent:tech-lead`, plus open PRs from
`repos[].openPRs` whose ticket is not blocked. Spawn `tech-lead` once with the whole list. For
each PR it accepts/rejects per its playbook and posts the verdict. Accepted PRs are merged and
their tickets moved to `awaitingValidation`.

## 6. DevOps

If `roles.devops.enabled`: spawn `devops` with the tickets merged in this tick and anything
labelled `agent:devops` (CI failures, infra tickets). It deploys to staging and reports.
If a milestone's tickets are all in `awaitingValidation`/`done` and `release.autoPropose` is true,
it runs the `release` skill steps 1–3 (raises `RELEASE_APPROVAL`).

## 7. Close

Append a one-paragraph summary to `team/chat/<today>.md` under `### tick <time>`:
decisions resolved, tickets moved (key: from → to), PRs merged/rejected, blockers raised.
Delete the lock. Print the summary.

## Failure handling

A script error (Jira/Slack down, git conflict) is reported in the room with `--mention` only if
it blocks the whole tick; otherwise log it in the summary and continue with the next item.
Never retry a merge or a transition that may already have happened without re-reading the state.
