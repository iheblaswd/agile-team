---
name: retro
description: >
  This skill should be used when the user runs "/retro", says "retrospective", "sprint retro",
  "what went wrong this sprint", or automatically after a sprint is closed by sprint-review.
  The scrum-master gathers facts from the sprint (dailies, rejected MRs, blockers, decision
  latency) and writes a factual retro with action items that become Jira tasks for the next sprint.
metadata:
  version: "0.1.0"
---

# Retrospective

Load `team-protocol`. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`.

1. Inputs: `team/dailies/*` of the sprint, `team/sprints/sprint-NN/{goal,review}.md`, the chat
   logs, `jira.mjs issues --jql "sprint = <id>"`, rejected-MR comments by the tech lead.
2. Spawn `scrum-master` to write `team/sprints/sprint-NN/retro.md`:
```
# Sprint NN retro
## Facts
planned/delivered, MR rejection rate and top rejection reasons, handoff delays (backend→front),
decisions waited on the human (count, avg hours), blockers, CI failures.
## Went well
## To change
## Actions (max 3, each with an owner and a check)
- [ ] <action> — owner: <agent or human> — done when: <observable>
```
   Only facts that appear in the inputs; no generic advice. Actions that change how agents work
   are also appended to `team/TEAM.md` under "Working agreements" so future sprints inherit them.
3. Create each action as a Jira `Task` labelled `retro-action` + `agent:<owner>` in the backlog.
4. Retro conversation in Slack, thread `retro-sprint-NN`: each agent posts one message, first
   person — what went well for them and what they would change (team-protocol §3a-bis); the
   scrum-master closes with the actions and their owners. Then post the retro summary (`--no-jira`)
   and print it in the chat.
