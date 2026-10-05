# DeepSeek / Kimi 定价核验（2026-10-05）

本次仅核验以下型号，其他供应商继续使用 2026-05-29 的基线日期。内置表保持离线、可检查，不在运行时联网更新。

## 单价与官方依据

单位：USD / 1M tokens。

| 条目 | 输入 | 输出 | 缓存读取 | 缓存写入 | 口径 |
| --- | ---: | ---: | ---: | ---: | --- |
| deepseek-flash | 0.30 | 1.20 | 0.006 | 0 | 峰时估算 |
| deepseek-v4-flash | 0.30 | 1.20 | 0.006 | 0 | 官方兼容名 |
| deepseek-v4-flash-vision-exp | 0.30 | 1.20 | 0.006 | 0 | 官方兼容名 |
| deepseek-v4-pro | 1.32 | 3.96 | 0.044 | 0 | 峰时估算 |
| kimi-k2.7-code | 0.95 | 4.00 | 0.19 | 0 | 官方按量 API |

- [DeepSeek 官方定价](https://api-docs.deepseek.com/quick_start/pricing/)：旧 Flash 名称由当前 V4.1 Flash 服务；谷时价格为峰时的一半。本表不自动判断 UTC 时段和中国公众假期，明确采用峰时保守估算。
- [DeepSeek 旧别名停用公告](https://api-docs.deepseek.com/news/news260424/)：deepseek-chat/reasoner 在 2026-07-24 15:59 UTC 后停用。保留原估算值供历史识别，从 16:00 UTC 起标记 expired，不再作为当前 Flash 的配置建议。
- [Kimi 官方产品页](https://www.kimi.ai/resources/kimi-k2-7-code)：核对标准版 input/output/cache-hit。此价格不适用于 Kimi Code 订阅。主定价页本次解析未返回表格数值，故使用同站官方产品说明，不采用第三方聚合数据。

## 匹配约束

新核价条目接受精确名称或 `/` 前缀名称，例如 `deepseek/deepseek-flash`。未核验变体如 `kimi-k2.7-code-highspeed` 必须继续显示 default，不能通过宽泛部分匹配误套标准版价格。用户可以用既有配置优先级覆盖价格。

## 时效与历史边界

- 内置核验信息独立于可配置单价。逐型号 reviewedAt 覆盖基线日期，expiresAt 表示已知有效期截止时刻。
- 超过 90 天提示 stale，这是维护提示阈值，不是供应商承诺的价格有效期；recent 也不保证价格未再次变更。
- CLI 诊断仅对实际命中的内置条目判断时效，不对用户覆盖强加内置核验日期。
- 新价格不回写旧 cost。历史记录跨越不同版本及促销时期，不能直接用今天的峰价重算成历史账单。

验证覆盖：新名称与前缀、显式缓存单价、未核价变体回退、用户覆盖优先级、时效边界、CLI 展示以及历史记录不被重算或修改。
