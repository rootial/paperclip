# OPC Agents

Last updated: 2026-04-10
Owner: rootial
Company: OPC (`f03c3d37-0d2f-45cf-81ff-6ff9301a9f96`)

This document records the current agent roster for Company `OPC`, including reporting lines, adapter choice, and effective model selection.

## Notes

- Source of truth for the current roster is the local Paperclip API.
- This document intentionally does not copy secrets, absolute instruction paths, or full adapter config blobs.
- For `hermes_local`, several agents currently have no explicit `model` configured in Paperclip. In practice that means model selection is profile-driven or runtime-default rather than pinned in the company record.

## Org Snapshot

- CEO: `CEO`
- Reports to CEO: `CTO`, `CMO`
- Reports to CTO: `Architect`, `Backend Engineer`, `Frontend Engineer`, `QA Engineer`, `Security Engineer`, `Knowledge Broker`, `Sr DevOps Engineer`, `Owl Devops`
- Reports to CMO: `Content Writer`

## Agent Roster

| Agent | Title | Role | Reports To | Adapter | Model | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CEO | Chief Executive Officer | ceo | - | `claude_local` | `claude-sonnet-4-6` | error |
| CTO | Chief Technology Officer | cto | CEO | `claude_local` | `claude-sonnet-4-6` | error |
| Architect | - | general | CTO | `codex_local` | `gpt-5.4` | idle |
| Backend Engineer | Senior Backend Engineer | engineer | CTO | `claude_local` | `claude-sonnet-4-6` | idle |
| Frontend Engineer | Senior Frontend Engineer | engineer | CTO | `codex_local` | `gpt-5.3-codex` | idle |
| QA Engineer | QA Engineer | qa | CTO | `codex_local` | `gpt-5.3-codex` | idle |
| Security Engineer | Security Engineer | engineer | CTO | `claude_local` | `claude-sonnet-4-6` | idle |
| Knowledge Broker | Knowledge Broker | researcher | CTO | `claude_local` | `claude-sonnet-4-6` | error |
| Sr DevOps Engineer | Sr DevOps Engineer | devops | CTO | `codex_local` | `gpt-5.4` | idle |
| Owl Devops | Site Reliability Engineer | devops | CTO | `hermes_local` | profile/default | idle |
| CMO | Chief Marketing Officer | cmo | CEO | `hermes_local` | profile/default | idle |
| Content Writer | Content Writer | general | CMO | `hermes_local` | profile/default | idle |

## Agent Details

### CEO

- Purpose: Strategic planning, company vision, cross-team coordination.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: Strong fit for planning, synthesis, and management-style review loops.
- Notes: Currently the main company-level operator with `canCreateAgents=true`.

### CTO

- Purpose: Technical architecture, code review, engineering standards.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: Optimized for review, technical judgment, and cross-ticket coordination.
- Notes: Primary engineering reviewer and manager for most technical agents.

### Architect

- Purpose: Technical design and architecture proposals.
- Adapter: `codex_local`
- Model: `gpt-5.4`
- Why this model: Stronger deep implementation reasoning than the lighter coding agents.
- Notes: Good default for system design and plan-first engineering work.

### Backend Engineer

- Purpose: API design, database, and infrastructure-adjacent backend implementation.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: Good fit for larger backend edits and longer reviewable changes.
- Notes: Heartbeat is currently disabled; wake-on-demand remains enabled.

### Frontend Engineer

- Purpose: UI, component work, React, and CSS implementation.
- Adapter: `codex_local`
- Model: `gpt-5.3-codex`
- Why this model: Good coding throughput for iterative product/UI changes.

### QA Engineer

- Purpose: Testing, verification, and bug confirmation.
- Adapter: `codex_local`
- Model: `gpt-5.3-codex`
- Why this model: Fast enough for focused validation and test-writing loops.

### Security Engineer

- Purpose: Security auditing and vulnerability assessment.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: Better suited to careful audit-style reasoning than purely implementation-oriented flows.

### Knowledge Broker

- Purpose: Research, ticket analysis, and knowledge-sharing across agents.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: Strong summarization and synthesis for cross-agent context work.
- Notes: Current runtime status is `error`, so this role may need attention.

### Sr DevOps Engineer

- Purpose: Execute cluster/config changes, cron adjustments, cleanup, and operational fixes.
- Adapter: `codex_local`
- Model: `gpt-5.4`
- Why this model: Better fit for direct execution, operational commands, and repo changes.
- Notes: Search is enabled in adapter config.

### Owl Devops

- Purpose: SRE-style monitoring, health checks, log review, and automatic recovery delegation.
- Adapter: `hermes_local`
- Model: profile/default
- Why this model: This agent appears to be profile/SOP driven rather than pinned to a single explicit model in Paperclip config.
- Notes: Has active heartbeat scheduling with cooldown/interval configured.

### CMO

- Purpose: Marketing strategy, content, and community management.
- Adapter: `hermes_local`
- Model: profile/default
- Why this model: Marketing workflows appear to rely on Hermes profile behavior rather than a single pinned model.

### Content Writer

- Purpose: Technical writing, blog posts, and documentation.
- Adapter: `hermes_local`
- Model: profile/default
- Why this model: Content execution is currently not pinned to an explicit model in the company record.

## Model Policy

- Review / management default: `claude-sonnet-4-6`
- Deep coding / architecture default: `gpt-5.4`
- Faster coding / QA default: `gpt-5.3-codex`
- Hermes agents: profile-driven or runtime-default unless an explicit model is later pinned

## Operational Notes

- `claude_local` is used for leadership, review, research, and some backend/security work.
- `codex_local` is used for architecture, frontend, QA, and DevOps execution.
- `hermes_local` is used for marketing/content and SRE-style operational automation.
- Current agents in `error` state: `CEO`, `CTO`, `Knowledge Broker`

## Handoff Rules

- Agents must explicitly identify the next reviewer or owner when handing off work.
- Status changes alone are not enough for a valid handoff.
- Model changes should be recorded here when they materially affect behavior or cost.

## Change Log

- 2026-04-10: Replaced the initial skeleton with the live OPC agent roster from the local Paperclip API.
