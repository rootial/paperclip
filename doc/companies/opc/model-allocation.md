# OPC Agent Model Allocation by Subscription Availability

Last updated: 2026-04-11
Owner: rootial

## Subscriptions

| 订阅 | Adapter | 可用模型 | 限额说明 |
|------|---------|---------|---------|
| **Claude Max 5x** | `claude_local` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | **5 小时滚动窗口**限额；opus 消耗最快，高并发时优先降级到 sonnet |
| **Codex Plus** | `codex_local` | gpt-5.4, gpt-5.3-codex, gpt-5.4-mini | 按月额度；gpt-5.4 消耗最快 |

> **历史注记**：Copilot Pro 订阅于 2026-04-11 取消，本文不再把 `copilot_local` 作为候选 adapter。包含 Copilot Pro 的旧 7 场景矩阵可从 git 历史查看。

> **Hermes agents 不在本文切换矩阵范围内**：Owl Devops、CMO、Content Writer 使用 `hermes_local` adapter，实际 provider 由 `~/.hermes/active_profile` 指向的 profile 决定，由 owner 手工管理，不随本文场景切换。下面的场景表只覆盖 `claude_local` / `codex_local` 两类订阅绑定的 agents。
>
> **⚠️ 隐式配额污染提醒**：若 `active_profile` 指向的 provider 恰好命中本文某个订阅（例如把 profile 切到 `provider: anthropic` 会消耗 Claude Max 5x，`provider: openai-codex` 会消耗 Codex Plus），Hermes agents 会**隐式占用该订阅配额但不在任何场景 budget 里显式计入**。owner 在评估场景承压时必须手工加上 Hermes agents 的消耗，或把 Hermes profile 绑到独立计费源（OpenRouter / 自建 API key 等）避免污染。

---

## 场景总览

| 场景 | Claude Max 5x | Codex Plus |
|------|:---:|:---:|
| 1. 全部可用（默认） | ✅ | ✅ |
| 2. 仅 Claude Max 5x | ✅ | ❌ |
| 3. 仅 Codex Plus | ❌ | ✅ |

---

## 场景 1：全部可用（默认方案）

> 原则：Claude Max 5x **有 5 小时滚动窗口限额**，opus 只给 CTO（review 高频、精度敏感）；CEO 是兜底角色（人类 owner + Claude Code 已覆盖大部分 CEO 决策），默认 sonnet；Security Engineer / Knowledge Broker 用 sonnet 节省窗口；Codex Plus 承担所有实现执行类，gpt-5.4 给核心 coding 角色，Frontend/QA 降档到 gpt-5.3-codex 保月度配额。

| Agent | Adapter | Model | 理由 |
|-------|---------|-------|------|
| CEO | `claude_local` | `claude-sonnet-4-6` | 兜底角色，低频；opus 留给 CTO |
| CTO | `claude_local` | `claude-opus-4-6` | 技术 review 高频且精度优先 |
| Security Engineer | `claude_local` | `claude-sonnet-4-6` | 审计用 sonnet，节省 opus 5h 窗口 |
| Knowledge Broker | `claude_local` | `claude-sonnet-4-6` | 研究综合，sonnet 足够 |
| Architect | `codex_local` | `gpt-5.4` | 深度设计 |
| Backend Engineer | `codex_local` | `gpt-5.4` | 后端实现 |
| Sr DevOps Engineer | `codex_local` | `gpt-5.4` | 操作执行 |
| Frontend Engineer | `codex_local` | `gpt-5.3-codex` | UI coding，让 5.4 配额给 Architect/Backend/Sr DevOps 三个核心 coding 角色 |
| QA Engineer | `codex_local` | `gpt-5.3-codex` | 验证 |

---

## 场景 2：仅 Claude Max 5x

> 原则：所有 agent 使用 `claude_local`；**注意 5 小时窗口是硬限额**，CTO review 高频，常驻 opus 会第一个把窗口烧在日常 review 上，因此 CTO 日常用 sonnet，opus 仅作 break-glass 给高风险场景（安全审计、数据迁移、架构大改动）临时手工提档；QA 用 haiku 进一步省窗口。

| Agent | Adapter | Model | 说明 |
|-------|---------|-------|------|
| CEO | `claude_local` | `claude-sonnet-4-6` | 兜底角色 |
| CTO | `claude_local` | `claude-sonnet-4-6` | 日常 review；重大变更由 owner 临时 break-glass 升 opus |
| Security Engineer | `claude_local` | `claude-sonnet-4-6` | 审计，sonnet 节省窗口 |
| Architect | `claude_local` | `claude-sonnet-4-6` | 设计，sonnet 足够 |
| Backend Engineer | `claude_local` | `claude-sonnet-4-6` | 实现 |
| Sr DevOps Engineer | `claude_local` | `claude-sonnet-4-6` | 执行 |
| Frontend Engineer | `claude_local` | `claude-sonnet-4-6` | UI |
| Knowledge Broker | `claude_local` | `claude-sonnet-4-6` | 研究 |
| QA Engineer | `claude_local` | `claude-haiku-4-5` | 验证，最轻量省窗口 |

---

## 场景 3：仅 Codex Plus

> 原则：所有 agent 使用 `codex_local`；月度配额吃紧时 9 个角色全用 gpt-5.4 会月初烧光，因此 gpt-5.4 严格留给核心 review + coding 链路（CTO、Architect、Backend、Sr DevOps），CEO / Security / Knowledge Broker / Frontend / QA 全部降到 gpt-5.3-codex；Security 在遇到重大权限 / 密钥 / 边界变更时由 owner 临时手工升档到 gpt-5.4。

| Agent | Adapter | Model | 说明 |
|-------|---------|-------|------|
| CEO | `codex_local` | `gpt-5.3-codex` | 兜底角色，省配额 |
| CTO | `codex_local` | `gpt-5.4` | review 精度优先，核心路径 |
| Security Engineer | `codex_local` | `gpt-5.3-codex` | 日常审计；重大变更由 owner 临时升 gpt-5.4 |
| Architect | `codex_local` | `gpt-5.4` | 深度设计，核心路径 |
| Backend Engineer | `codex_local` | `gpt-5.4` | 实现，核心路径 |
| Sr DevOps Engineer | `codex_local` | `gpt-5.4` | 执行，核心路径 |
| Knowledge Broker | `codex_local` | `gpt-5.3-codex` | 研究综合，省配额 |
| Frontend Engineer | `codex_local` | `gpt-5.3-codex` | UI |
| QA Engineer | `codex_local` | `gpt-5.3-codex` | 验证 |

---

## 场景切换跳转表

**降级方向**（某订阅触发限额）

| 当前场景 | Claude Max 5x 限额 | Codex Plus 限额 |
|---------|:---:|:---:|
| 1. 全部可用 | → 场景 3 | → 场景 2 |
| 2. 仅 Claude Max 5x | (无可降) | — |
| 3. 仅 Codex Plus | — | (无可降) |

**恢复方向**（某订阅恢复）

| 当前场景 | Claude Max 5x 恢复 | Codex Plus 恢复 |
|---------|:---:|:---:|
| 2. 仅 Claude Max 5x | — | → 场景 1 |
| 3. 仅 Codex Plus | → 场景 1 | — |

**切换操作提示**：切换时需要逐个 PATCH 对应 agent 的 `adapterConfig.model` 和 adapter 类型（以目标场景表为准），不要只改模型名忘了改 adapter 类型。切换生效无需重启 Paperclip server，下一次 agent run 即读取新配置。

---

## 变更记录

| 日期 | 修改 | 影响范围 | 原因 |
|------|------|----------|------|
| 2026-04-11 | 初版 7 场景并同日迭代修正（见下） | 全文 | 初始版本按 3 个订阅 × 可用性列出 7 场景矩阵（含 Copilot Pro）。同日内吸收的修正（已全部体现在当前场景 1/2/3）：<br>① 移除 Copilot Pro 中未引用的 `gpt-5.2`<br>② 统一 Security Engineer = `claude-sonnet-4-6` 原则（原旧场景 3/4/7 写 opus 与旧场景 1/2/5 矛盾）<br>③ CEO 全场景降档到非最强档（CEO 是兜底角色，opus 应留给 CTO 这个高频 review 角色）<br>④ Hermes agents 移出切换矩阵 + 加 `active_profile` 隐式配额污染告警<br>⑤ 快速切换索引从"配置替换"规则改写为"场景→场景"跳转表（原规则与场景表交叉矛盾） |
| 2026-04-11 | **取消 Copilot Pro 订阅，精简为 3 场景** | 全文 | Copilot Pro 订阅由 owner 取消；原 7 场景中依赖 Copilot Pro 可用的 4 个场景失效；保留原场景 4/5/6 并重编号为新场景 1/2/3；adapter `copilot_local` 从文档中移除 |
| 2026-04-11 | 场景 2 CTO 从 opus 降到 sonnet + break-glass | 场景 2 | 5h 硬窗口场景下 CTO review 高频常驻 opus 会首先把窗口烧在日常 review 上；sonnet 足够日常 review，opus 改为由 owner 在高风险变更时手工临时升档 |
| 2026-04-11 | 场景 3 gpt-5.4 收敛到核心路径 | 场景 3 | 单订阅月度配额承压，9 角色全 gpt-5.4 必然月初烧光；gpt-5.4 只留给 CTO/Architect/Backend/Sr DevOps 4 个核心 review + coding 角色，CEO/Security/KB/Frontend/QA 降到 gpt-5.3-codex；Security 保留重大变更升档的 break-glass 入口 |
| 2026-04-11 | 场景 1 Frontend 理由文案精修 | 场景 1 | 原理由"让 5.4 给 Architect/Backend"漏了 Sr DevOps（同表里也是 gpt-5.4），改为"让 5.4 给 Architect/Backend/Sr DevOps 三个核心 coding 角色" |
