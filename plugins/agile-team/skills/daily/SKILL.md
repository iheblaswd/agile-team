---
name: daily
description: >
  This skill should be used when the user runs "/daily", says "daily standup", "what did the
  team do", "standup report", "where are we", or by the scheduled task at the configured daily
  time. The scrum-master reads Jira, git and Slack since the last daily and posts, per agent,
  done / today / blocked, with open decisions and their age at the top.
metadata:
  version: "0.1.0"
---

# Daily

Load `team-protocol`. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`.

1. Find the previous daily file in `team/dailies/` to compute the window (default 24h, 72h on
   the first weekday after a weekend). `node $P/snapshot.mjs --hours <window>`.
2. Resolve any answered decisions exactly as `tick §1` does (the daily must never leave an
   answered decision pending), then handle human feedback exactly as `tick §1b` does.
3. Spawn `scrum-master` with the snapshot and today's/yesterday's `team/chat/*.md`. It writes
   `team/dailies/<YYYY-MM-DD>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/daily.md`:

```
# Daily — <date> — Sprint NN (day d/D) — goal: <goal>
⏳ Waiting on <human>: KEY (TYPE, since <n> days) …          ← omit line if none
## <agent id> (<display name>)
- Done: KEY <summary> (<status>), …
- Today: KEY …
- Blocked: KEY — <why> (needs <who>)
…
## Health
Sprint: <done>/<total> tickets in awaitingValidation or done · <n> in review · <n> to fix · velocity trend
Risks: …
```
   Write it in `conventions.humanLanguage`, product wording first (template), technical details in the
   collapsed block at the end; post it with `--human` = the "En deux phrases" section.
   "Done" = tickets whose status advanced or whose PR merged in the window; "Today" = the agent's
   current queue; "Blocked" = blocked keys or `toFix` older than 2 days, or waiting on a handoff
   older than 1 day. Raise a `BLOCKER` decision for anything only the human can unblock.
4. Post the daily in the room (`room.mjs say --from scrum-master --to team --title "Daily <date>" --no-jira`
   with the file content as body; use `--mention` if any decision is older than 1 day), and add
   a comment on the active sprint's epic if `jira.sprintEpicKey` is set.
   Then make it a standup, like a real team: post the opener with `--thread daily-<YYYY-MM-DD>`
   (the `--human` two-sentence summary), then for each active agent with something to say, one
   message in that thread: `room.mjs say --from <id> --thread daily-<date> --no-jira --title "standup"
   --say "Hier j'ai … Aujourd'hui je … Pas de blocage / Je bloque sur …"` (first person, 1–3 sentences,
   team-protocol §3a-bis). Skip agents with nothing new.
5. Print the daily in the chat.
