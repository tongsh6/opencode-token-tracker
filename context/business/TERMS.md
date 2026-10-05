# 术语与语义口径

## 1) 产品目标

- 本插件用于本地追踪 OpenCode 使用过程中的 token 消耗与成本估算
- 核心价值是 "可观测" 与 "预算提醒"，不是账务系统
- 所有数据默认保存在本地 JSONL，便于查询与回溯

## 2) 核心术语

- `TokenEntry`：一条 token 记录，来源于一次可计量消息更新
- `sessionId`：OpenCode 会话标识，用于会话级聚合
- `parentID`：会话事件中的父会话标识，沿此关系定位顶层任务；不要与消息事件中表示父消息的 `parentID` 混用
- `messageId`：消息标识，用于去重与单条追踪
- `agent`：执行该消息的 agent 名称（如 `coder`、`sisyphus`）
- `model`：模型标识（如 `claude-opus-4.5`）
- `provider`：模型供应方或接入方（如 `openai`、`github-copilot`）

## 3) token 字段语义

- `input`：本次请求的 net-new 输入 token；OpenCode 事件中它与 `cacheRead` 分开提供
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
2. 用户 model 精确匹配
3. 内置定价精确匹配
4. 内置定价部分匹配
5. 用户 model 部分匹配
6. 默认回退定价

重要边界：

- 本插件计算结果不等同于云厂商正式账单
- 定价 source of truth 以 provider 官网为准；OpenCode reported cost 只作为对照信号
- 订阅制或打包计费场景可将 provider 价格配置为 0
- `built-in` 只描述价格来源，不保证价格仍有效。recent 表示核验距今不超过 90 天，stale 表示超过复核阈值，expired 表示已过已知有效期；unknown 表示日期或时钟无法可靠判断
- 各型号保留自己的核验日期，未单独更新的型号使用全表基线日期；局部刷新不能让其他型号看似刚核价
- DeepSeek Flash/Pro 内置价格采用峰时保守估算，不自动判断谷时/节假日；用户覆盖优先级不变
- 价格更新只影响新记录；历史统计和导出使用日志已保存的 cost，不自动按今日价格重算

## 5) 预算语义

- `daily` / `weekly` / `monthly`：对应周期预算上限
- `warnAt`：预警阈值，默认 0.8，表示达到 80% 开始告警
- 预算检查基于本地日志聚合结果，不依赖外部 API

周期口径：

- `daily`：自然日
- `weekly`：自然周（周一为起始）
- `monthly`：自然月（每月 1 日起）

## 6) 展示语义

- Toast：显示单次消息消耗及按顶层任务归并的累计 token/成本；累计范围为当前插件进程收到的消息，包含已知子会话
- Session idle 提示：按顶层任务汇总，即使父会话尚无自身消息，也包含子会话的消耗
- 启动时从 `sessions.jsonl` 恢复关系，但不回放历史 token；标题更新保留已有父子关系，晚到关系在下次展示生效
- CLI：从持久化日志进行历史分析；`--by session` 按根会话汇总，`--by raw-session` 按原始会话分别显示，其他维度仍支持 model/agent/provider/daily

## 7) 非目标（Out of Scope）

- 不做远程账单对账
- 不做权限/组织级财务管理
- 不承诺与任意 provider 账单 100% 一致

## 8) 需求讨论建议

- 涉及 "成本准确性" 的需求，先明确是 "估算优化" 还是 "账单对齐"
- 涉及 "预算" 的需求，先明确是提醒策略还是强制阻断
- 涉及新增统计维度，先确认是否能从现有日志字段稳定推导
