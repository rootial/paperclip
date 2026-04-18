# OPC Agents

Last updated: 2026-04-11
Owner: rootial
Company: OPC (`f03c3d37-0d2f-45cf-81ff-6ff9301a9f96`)

This document records the current agent roster for Company `OPC`, including reporting lines, adapter choice, and effective model selection.

## Notes

- Source of truth for the current roster is the local Paperclip API.
- This document intentionally does not copy secrets, absolute instruction paths, or full adapter config blobs.
- For `hermes_local`, several agents currently have no explicit `model` configured in Paperclip. In practice that means model selection is profile-driven or runtime-default rather than pinned in the company record.
- **Model allocation by subscription availability** is documented separately: [`model-allocation.md`](./model-allocation.md). Refer to that document when any subscription hits its rate limit or window.

### 何时需要更新本文档

本文档记录的是 **默认方案（场景 1）下的当前 roster 快照**，不是每次限额切换的实时状态。以下三类变更才需要同步 `agents.md`，其余情况只改 runtime（PATCH `/api/agents/<id>`）即可：

| 变更类型 | 改 agents.md? | 改 model-allocation.md? | runtime PATCH? |
|---|:---:|:---:|:---:|
| 临时切场景应对限额（场景 1 → 2/3） | ❌ | ❌ | ✅ |
| 限额恢复，切回场景 1 | ❌ | ❌ | ✅ |
| **永久**调整默认分配（改场景 1 本身） | ✅ | ✅ | ✅ |
| 新增 / 删除 agent | ✅ | ✅（若影响场景表） | ✅ |
| 订阅增删（例如 Copilot Pro 取消） | ✅ | ✅ | ✅ |

换句话说：**日常限额触发的临时切换不需要改本文档**，直接按 `model-allocation.md` 的场景表 PATCH runtime；只有改默认方案 / 改订阅 / 改编制三类才需要同步。

## Org Snapshot

- CEO: `CEO`
- Reports to CEO: `CTO`, `CMO`
- Reports to CTO: `Architect`, `Backend Engineer`, `Frontend Engineer`, `QA Engineer`, `Security Engineer`, `Knowledge Broker`, `Sr DevOps Engineer`, `Owl Devops`
- Reports to CMO: `Content Writer`

## Agent Roster

| Agent | Title | Role | Reports To | Adapter | Model | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CEO | Chief Executive Officer | ceo | - | `claude_local` | `claude-sonnet-4-6` | error |
| CTO | Chief Technology Officer | cto | CEO | `claude_local` | `claude-opus-4-6` | idle |
| Architect | - | general | CTO | `codex_local` | `gpt-5.4` | idle |
| Backend Engineer | Senior Backend Engineer | engineer | CTO | `codex_local` | `gpt-5.4` | idle |
| Frontend Engineer | Senior Frontend Engineer | engineer | CTO | `codex_local` | `gpt-5.3-codex` | idle |
| QA Engineer | QA Engineer | qa | CTO | `codex_local` | `gpt-5.3-codex` | idle |
| Security Engineer | Security Engineer | engineer | CTO | `claude_local` | `claude-sonnet-4-6` | idle |
| Knowledge Broker | Knowledge Broker | researcher | CTO | `claude_local` | `claude-sonnet-4-6` | idle |
| Sr DevOps Engineer | Sr DevOps Engineer | devops | CTO | `codex_local` | `gpt-5.4` | idle |
| Owl Devops | Site Reliability Engineer | devops | CTO | `hermes_local` | profile/default | error |
| CMO | Chief Marketing Officer | cmo | CEO | `hermes_local` | profile/default | paused |
| Content Writer | Content Writer | general | CMO | `hermes_local` | profile/default | paused |

## Agent Details

### CEO

- Purpose: Strategic planning, company vision, cross-team coordination.
- Adapter: `claude_local`
- Model: `claude-sonnet-4-6`
- Why this model: CEO 是兜底角色（人类 owner + Claude Code 已覆盖大多数 CEO 决策），sonnet 足够；opus 留给 CTO 高频 review。
- Notes: Currently the main company-level operator with `canCreateAgents=true`. Runtime status 仍为 `error`，与模型选择无关，需单独排查。

### CTO

- Purpose: Technical architecture, code review, engineering standards.
- Adapter: `claude_local`
- Model: `claude-opus-4-6`
- Why this model: review 高频且精度敏感，是整个工程链路的核心收口角色，独占 Claude Max 5x 的 opus 配额。
- Notes: Primary engineering reviewer and manager for most technical agents. ⚠️ Claude Max 5x 有 5 小时滚动窗口限额，若 CTO opus 把窗口烧光需参考 `model-allocation.md` 场景 2 降级到 sonnet。

### Architect

- Purpose: Technical design and architecture proposals.
- Adapter: `codex_local`
- Model: `gpt-5.4`
- Why this model: Stronger deep implementation reasoning than the lighter coding agents.
- Notes: Good default for system design and plan-first engineering work.

### Backend Engineer

- Purpose: API design, database, and infrastructure-adjacent backend implementation.
- Adapter: `codex_local`
- Model: `gpt-5.4`
- Why this model: 核心 coding 路径，gpt-5.4 是 Codex Plus 下最强档，Backend 承担大量后端实现，吃到最强档回报最高。
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
- Why this model: Strong summarization and synthesis for cross-agent context work；审计/研究类工作 sonnet 足够，把 opus 留给 CTO。

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

> Default assignment is **Scenario 1** from [`model-allocation.md`](./model-allocation.md) (both Claude Max 5x and Codex Plus available). Copilot Pro 已于 2026-04-11 取消，不再作为候选订阅。

- **Claude Max 5x** (`claude_local`)
  - `claude-opus-4-6`：仅 CTO（review 高频且精度敏感）
  - `claude-sonnet-4-6`：CEO（兜底角色）、Security Engineer（审计）、Knowledge Broker（研究）
  - ⚠️ Claude Max 5x 有 **5 小时滚动窗口限额**，opus 严格限 CTO 一个角色；若窗口告急参考 `model-allocation.md` 场景 2
- **Codex Plus** (`codex_local`)
  - `gpt-5.4`：Architect、Backend Engineer、Sr DevOps Engineer（核心 coding / 设计 / 执行 路径）
  - `gpt-5.3-codex`：Frontend Engineer、QA Engineer（降档为把 gpt-5.4 月配额留给核心三角色）
- **Hermes agents** (`hermes_local`): Owl Devops / CMO / Content Writer 由 `~/.hermes/active_profile` 决定 provider，**不在本文切换矩阵内**（owner 手工管理）。但 ⚠️ 若 profile 恰好指向 `anthropic` 或 `openai-codex`，会隐式占用 Claude Max 5x / Codex Plus 配额但不在任何场景 budget 里显式计入，详见 `model-allocation.md` 隐式配额污染告警。

当任一订阅限额时，参考 [`model-allocation.md`](./model-allocation.md) 对应场景切换。

## Operational Notes

- `claude_local` is used for CTO review（opus）、CEO/Security/Knowledge Broker（sonnet）。
- `codex_local` is used for Architect/Backend/Sr DevOps（gpt-5.4 核心路径）以及 Frontend/QA（gpt-5.3-codex 降档）。
- `hermes_local` is used for marketing/content and SRE-style operational automation.
- Current agents in `error` state: `CEO`、`Owl Devops`（pre-existing，与 2026-04-11 的 adapter/model 对齐无关，需单独排查）。

## Handoff Rules

- Agents must explicitly identify the next reviewer or owner when handing off work.
- Status changes alone are not enough for a valid handoff.
- Model changes should be recorded here when they materially affect behavior or cost.

## Change Log

- 2026-04-11: 全量对齐 `model-allocation.md` 场景 1（Copilot Pro 订阅取消后的 2-订阅默认方案）。
  - **Runtime PATCH**（5 个 agent）：
    - CEO：`copilot_local` → `claude_local / claude-sonnet-4-6`（紧急，Copilot Pro 已取消）
    - QA Engineer：`copilot_local / gpt-5.4` → `codex_local / gpt-5.3-codex`（紧急）
    - Sr DevOps Engineer：`copilot_local / gpt-5.4` → `codex_local / gpt-5.4`（紧急）
    - Architect：`claude_local / claude-opus-4-6` → `codex_local / gpt-5.4`（原配置会烧 Claude 5h 窗口）
    - Knowledge Broker：`codex_local / gpt-5.3-codex` → `claude_local / claude-sonnet-4-6`（回归场景 1）
  - **Doc 对齐**：Roster 表、Agent Details（CEO/CTO/Backend/KB）、Model Policy 段（移除 Copilot Pro、修正 CEO=sonnet/CTO=opus 方向、重写 Hermes 段加隐式配额污染告警）、Operational Notes。
  - **未改动**：CTO（runtime 已是 opus）、Backend Engineer（runtime 已是 codex_local/gpt-5.4）、Frontend/Security（已对齐）、Hermes 三个 agent（owner 手工管理）。
