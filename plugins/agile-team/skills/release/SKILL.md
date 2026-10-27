---
name: release
description: >
  This skill should be used when the user runs "/release", says "prepare a release", "ship
  v0.1.0", "publish the CLI", "deploy to production", or when devops proposes a release at the
  end of a milestone. Devops prepares the release candidate (changelog, tag, CI status, deploy
  plan), raises the RELEASE_APPROVAL decision, and publishes only after the human approves.
metadata:
  version: "0.1.0"
---

# Release

Load `team-protocol`. `$P = ${CLAUDE_PLUGIN_ROOT}/scripts`. `release` section of the config
gives the channels (`npm`, `ghcr`, `fly`, `cloudflare`, …) and the version scheme.

1. Spawn `tech-lead` to confirm `main` is releasable: CI green, no `toFix` on the milestone,
   no open `BLOCKER`. If not, stop and say what is missing.
2. Spawn `devops` to write `team/releases/<version>.md`:
```
# Release <version> — <date>
Scope: milestone <name> · tickets: KEY, …
Changelog (Conventional Commits since <previous tag>): …
Checks: CI <link> · tests <summary> · smoke test on staging <result>
Plan: 1) tag 2) build 3) publish <channels> 4) deploy 5) verify <URL/command> 6) announce
Rollback: <how>
```
   Dry-run everything that can be dry-run (`npm pack`, `docker build`, `fly deploy --build-only`).
3. Gate: `room.mjs decision --type RELEASE_APPROVAL --summary "Release <version> ready" --body "<scope + checks + plan>"`.
   Nothing else is blocked; the team keeps working on the next sprint.
4. On approval: devops executes the plan step by step, posting each step's result; on any failure
   it stops, rolls back per the plan, and raises a `BLOCKER`. On success: "Released <version> ·
   <links>" in the room with `--mention`, tickets of the milestone get label `released:<version>`,
   `team/releases/<version>.md` status set to released.
   On rejection: record the reason, nothing is published.
