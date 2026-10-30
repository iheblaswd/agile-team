---
name: sprint-plan
description: >
  This skill should be used when the user runs "/sprint-plan", says "plan the next sprint",
  "start sprint N", "sprint planning", or when the scheduled tick detects that the planning day
  has arrived with no open or proposed sprint. It runs the PO and scrum-master agents to refine
  the backlog, propose a sprint, raise the SPRINT_APPROVAL decision, and — once the human
  approves — create the sprint in Jira and release the team.
metadata:
  version: "0.1.0"
---

# Sprint planning

Load `team-protocol` first. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`.

## 1. State

`node $P/snapshot.mjs`. If a `SPRINT_APPROVAL` decision is already open → go to step 5 (check
for the answer) and stop; do not propose a second sprint. If a sprint is active and not closed
→ say so and stop unless the user explicitly asks to plan the next one in parallel.

## 2. Product refinement (po agent)

Spawn the `po` agent with: the project context file, the roadmap section relevant to the next
sprint (ask the user which milestone if unclear), the current backlog from the snapshot, and the
previous retro's action items (`team/sprints/sprint-<N-1>/retro.md` if present).
It returns: new/updated stories with acceptance criteria, in priority order, each tagged with the
intended owner id from `developers[]` / `roles`, and creates them in Jira
(`jira.mjs create --type Story …`). Each spec is announced in the room ("spec written").

## 3. Sprint proposal (scrum-master agent)

Spawn `scrum-master` with the refined backlog, the team capacity (`developers[].capacityPerSprint` of **active** developers only — `enabled: false` and `developersParked[]` count for zero,
default 5 tickets/dev/week), carry-overs (`toFix`, `inReview`, unfinished `inProgress`), and
the previous velocity (count of tickets reaching `awaitingValidation` last sprint).
It produces `team/sprints/sprint-NN/goal.md`:

```
# Sprint NN — <goal in one sentence>
Dates: <start> → <end>
| Key | Summary | Owner | Points/size | Depends on |
Carry-over: …
Risks: …
Out of scope: …
```

## 3b. Planning conversation (Slack)

Before raising the gate, hold the planning in thread `planning-sprint-NN` (team-protocol §3a-bis),
one `room.mjs say --thread planning-sprint-NN --no-jira --title "planning" --say "…"` each:
1. scrum-master opens: the sprint dates and what we're deciding today.
2. po: the sprint goal in one sentence and the 2–4 stories that matter most, in product words.
3. each active developer: what they take, and one risk or question if they have one.
4. tech-lead: one remark on technical risk or order of work (only if useful).
5. scrum-master: the summary and "on soumet la proposition à <human>".

## 4. Human gate

```
node $P/room.mjs decision --type SPRINT_APPROVAL --summary "Sprint NN proposal: <goal>" --body "<table as text + link to goal.md>" --blocks KEY1,KEY2,…
```
Tell the user, in the chat as well: "Sprint NN proposed — waiting for your approval (KEY)."
Then stop. The team continues on unblocked work via `/tick`.

## 5. On approval (run by `/tick` or by `/sprint-plan` again)

When the decision is `approved`:
1. `jira.mjs sprint create --name "Sprint NN" --goal "<goal>"`, `sprint add <id> KEYS`, `sprint start <id>`.
2. Each ticket: transition to `selectedForSprint`, `assign` to its owner.
3. Room: "[scrum-master → team] Sprint NN created · <goal> · <n> tickets · ends <date>".
4. If `rejected`: post the reason, keep the tickets in backlog, spawn `scrum-master` again with
   the human's note to produce a revised proposal, and raise a new decision.
