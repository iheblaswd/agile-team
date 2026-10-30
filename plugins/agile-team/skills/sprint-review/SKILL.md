---
name: sprint-review
description: >
  This skill should be used when the user runs "/sprint-review", says "sprint review", "close
  the sprint", "what can I validate", "validate the sprint", or by the tick on the review day.
  The scrum-master builds the review package (everything in awaitingValidation with demo links),
  raises the SPRINT_VALIDATION decision, and after the human answers moves validated tickets to
  done and sends the rest back.
metadata:
  version: "0.1.0"
---

# Sprint review

Load `team-protocol`. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`.

1. `node $P/snapshot.mjs`. Tickets to present = status `awaitingValidation`. Also list
   unfinished sprint tickets (they will carry over).
2. Spawn `scrum-master` to write `team/sprints/sprint-NN/review.md`:
```
# Sprint NN review — <goal>
Validated by: <human>   Status: pending
| Key | Summary | Owner | PR | How to check (URL / command / screenshot path) |
Not finished (carry-over): KEY — reason
Metrics: planned <n> · delivered <m> · rejected MRs <r> · avg review turnaround <h>h
```
   "How to check" must be concrete: the staging URL from devops, a `pnpm test` line, a path under
   `team/design/`. The decision's `--human` text lists each ticket as "<titre produit> — ce que tu
   peux vérifier : <action simple ou lien>", in the human's language; commands and paths stay in
   the technical body. Ask devops (spawn it) for the staging state if not in the snapshot.
2b. Demo in Slack, thread `review-sprint-NN` (team-protocol §3a-bis): each developer presents its
   own deliveries in product words, one message each (« J'ai livré FORGE-6 : on sait maintenant
   calculer exactement ce qu'un projet va recevoir… »); the scrum-master closes with the summary.
3. Raise the gate: `room.mjs decision --type SPRINT_VALIDATION --summary "Sprint NN review — <m> tickets to validate" --body "<table>"`
   (no `--blocks`: nothing is blocked by a review). Tell the user in the chat.
4. On the human's answer (via tick/daily or `/sprint-review` again), or when the human moved
   tickets to `done` / `toFix` directly in Jira (`team-protocol §4c`, same outcome):
   - "approved KEY" with no exceptions → every listed ticket → `done`.
   - "approved except KEY1, KEY2: reason" → those → `toFix`, relabel to their last developer,
     comment the reason; the rest → `done`.
   - "rejected: reason" → all → `toFix`, reason on each.
   Then `jira.mjs sprint close <id>`, update `review.md` status, post "Sprint NN closed: <m> done,
   <k> back to fix" in the room, and run the `retro` skill.
