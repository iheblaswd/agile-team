# {{project}} — team

Human: **{{human}}** — approves sprints (SPRINT_APPROVAL), validates deliveries
(SPRINT_VALIDATION), approves releases (RELEASE_APPROVAL), answers BLOCKERs. Pinged on Slack
`{{slack_channel}}`; answers with `approved KEY` / `rejected KEY: reason`.

| Agent | Role | Owns | Hands off to |
|---|---|---|---|
| po | Product Owner | epics, stories, acceptance criteria, backlog order | scrum-master |
| scrum-master | Scrum Master | sprint proposal/creation, daily 09:00, review, retro, blockers | everyone |
{{developer_rows}}
| tech-lead | Tech Lead | every MR: accept/merge or reject with numbered reasons; rulings | developers, devops |
| devops | DevOps | CI/CD, staging after each merge, release candidates & execution | tech-lead, human |
| ux-designer | UI/UX | mockups + specs under team/design/<KEY>/ | frontend developer |

## Cadence (1 sprint = {{sprint_days}} days)
- {{planning_day}}: sprint planning → proposal → human approval → sprint created
- every day {{daily_time}}: daily in Slack + team/dailies/
- every {{tick_minutes}} min: tick (handoffs, reviews, deploys)
- {{review_day}}: sprint review → human validation → retro → actions into next sprint

## Working agreements
(retro actions that change how the team works are appended here)
- 
