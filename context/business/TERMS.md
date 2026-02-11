# 术语与语义口径

## 1) 产品目标

- 本插件用于本地追踪 OpenCode 使用过程中的 token 消耗与成本估算
- 核心价值是 "可观测" 与 "预算提醒"，不是账务系统
- 所有数据默认保存在本地 JSONL，便于查询与回溯

## 2) 核心术语

- `TokenEntry`：一条 token 记录，来源于一次可计量消息更新
- `sessionId`：OpenCode 会话标识，用于会话级聚合
- `messageId`：消息标识，用于去重与单条追踪
- `agent`：执行该消息的 agent 名称（如 `coder`、`sisyphus`）
- `model`：模型标识（如 `claude-opus-4.5`）
- `provider`：模型供应方或接入方（如 `openai`、`github-copilot`）

## 3) token 字段语义

- `input`：本次请求输入 token 总量
- `output`：本次响应输出 token 总量
- `reasoning`：模型思考 token（若上游提供）
- `cacheRead`：命中缓存读取的 token
- `cacheWrite`：写入缓存的 token

说明：

- 统计展示通常关注 `input + output` 作为主 token 量
- `cacheRead`/`cacheWrite` 单独展示，并参与成本计算

## 4) 成本语义

- 成本单位统一为 USD
- 定价单位统一为 "每 1M tokens 的价格"
- 成本是估算值（estimated cost），用于运营观察与预算控制

定价解析顺序（高 -> 低）：

1. provider 覆盖配置
2. 用户 model 配置
3. 内置定价精确匹配
4. 内置/用户定价部分匹配
5. 默认回退定价

重要边界：

- 本插件计算结果不等同于云厂商正式账单
- 订阅制或打包计费场景可将 provider 价格配置为 0

## 5) 预算语义

- `daily` / `weekly` / `monthly`：对应周期预算上限
- `warnAt`：预警阈值，默认 0.8，表示达到 80% 开始告警
- 预算检查基于本地日志聚合结果，不依赖外部 API

周期口径：

- `daily`：自然日
- `weekly`：自然周（周一为起始）
- `monthly`：自然月（每月 1 日起）

## 6) 展示语义

- Toast：强调 "即时反馈"（单次消息成本 + 会话累计）
- Session idle 提示：强调 "会话阶段总结"
- CLI：强调 "时间维度分析" 与 "分组统计"（model/agent/provider/daily）

## 7) 非目标（Out of Scope）

- 不做远程账单对账
- 不做权限/组织级财务管理
- 不承诺与任意 provider 账单 100% 一致

## 8) 需求讨论建议

- 涉及 "成本准确性" 的需求，先明确是 "估算优化" 还是 "账单对齐"
- 涉及 "预算" 的需求，先明确是提醒策略还是强制阻断
- 涉及新增统计维度，先确认是否能从现有日志字段稳定推导
