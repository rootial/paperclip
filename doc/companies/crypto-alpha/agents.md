# CryptoAlpha Agent 清单

公司 ID: `a7964cce-9095-4ee3-b724-eb2d3fe60011`
Issue 前缀: `CRYA`
创建日期: 2026-04-12

## Agent 总览

| Agent | ID 前缀 | 角色 | Adapter | 模型 | 汇报给 |
|-------|---------|------|---------|------|--------|
| CTO | 3688b194 | cto | claude_local | claude-opus-4-6 | CEO (人类) |
| Quant Researcher | d9c0beeb | researcher | claude_local | claude-sonnet-4-6 | CTO |
| Quant Developer | 82e5a682 | engineer | codex_local | gpt-5.4 | CTO |
| Backtesting Engineer | 41157189 | qa | codex_local | gpt-5.4 | CTO |
| Trader | 74a391b8 | devops | claude_local | claude-sonnet-4-6 | CTO |

## 技能

全员配备: coinank (衍生品数据 -- 持仓量、爆仓、多空比、资金费率、涨跌幅排行)

## Agent 详情

### CTO (3688b194)

加密交易团队的技术负责人。审查策略规格、代码实现和回测报告。把控各阶段的晋级门槛。接收 Trader 的熔断告警。协调全员任务分配。

### Quant Researcher (d9c0beeb)

验证数据源可行性（币安广场爬虫、coinank API、新闻 feed）。设计舆情、动量、OI 流向、衍生品辅助等信号逻辑。输出策略规格文档，包含入场/出场规则、止盈/追踪止损/时间止损逻辑以及参数范围。

### Quant Developer (82e5a682)

将策略规格实现为可执行的 Python 模块。构建数据采集管道（币安广场爬虫、coinank 客户端封装、新闻聚合）。编写信号计算、评分引擎和订单执行逻辑，并补充单元测试。

### Backtesting Engineer (41157189)

基于 pandas + 历史 K 线构建回测框架。在多种市场状态下（牛市、熊市、震荡、连环爆仓）验证策略。输出绩效报告：总收益、最大回撤、胜率、Sharpe 比率、盈亏比、扣除手续费/资金费率/滑点后的净期望值。

### Trader (74a391b8)

将策略部署到币安合约进行全自动执行。强制执行硬编码风控规则:
- 固定止损: 单笔最大亏损 200 USDT
- 最大同时持仓 5 个标的，单仓 1000 USDT，杠杆上限 10x
- 日亏损熔断: 500 USDT
- 仅做多

管理阶段式上线: 模拟盘 (1 周) -> 小资金 (100u) -> 逐步加仓。异常时自动暂停并通知 CTO。

## 工作流

```
Phase 0: 数据可行性验证  -- Researcher 验证各数据源可用性和稳定性
Phase 1: 策略研究        -- Researcher 输出策略规格文档
Phase 2: 策略编码        -- Developer 实现 Python 模块
Phase 3: 回测验证        -- Engineer 跑历史回测
Phase 4: 实盘部署        -- Trader 执行 (阶段式: 模拟盘 -> 小资金 -> 扩大)
```

每个阶段需要 CTO review 后才能推进。

## 沟通规范

- agent 之间的 issue/comment 沟通使用中文
- 代码、注释、commit message 使用英文
- 技术术语保留英文原文（如 OI、funding rate、Sharpe ratio）

## 设计文档

完整设计: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/claude-brain/01_projects/crypto-trading/2026-04-12-crypto-alpha-company-design.md`
