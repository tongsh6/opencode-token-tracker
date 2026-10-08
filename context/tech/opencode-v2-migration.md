# OpenCode V2 适配（插件 2.0.0）

## 支持范围

- 目标：OpenCode >= 2.0.25 且 < 3，官方 SDK 固定为 `@opencode/plugin@2.0.25`。
- V1 用户使用插件 1.8.0；2.0.0 不再导出 V1 函数入口。
- 独立 CLI 保留 Node >= 18。官方 Node Host 的加载验收需要 Node >= 22.15（`node:module.registerHooks`）；Node 18 跳过这一项，继续验证记账和 CLI。
- 服务端保存原路径的 tracker 配置、token 日志和会话元数据；不重算已有 cost、不迁移 OpenCode 自身数据库。

## 架构

`index.ts` 注册服务端定义并消费事件；`lib/tracker.ts` 保存每个实例的预算、会话和去重状态；`lib/rpc.ts` 定义提示事件与配置警告查询；`tui.ts` 只展示提示。

包导出 `.` 和 `./tui`。使用轻量的 `@opencode/plugin/promise/plugin` 与 `@opencode/plugin/tui/plugin` 子路径，无 JSX，不引入 OpenTUI/Solid 依赖。服务端发出的 RPC 提示带 sessionID，TUI 按当前位置过滤。

## 事件与计费口径

| V2 事件 | 行为 |
| --- | --- |
| `session.step.started` | 保存该消息的 model.id、providerID、agent，不记账 |
| `session.step.ended` / `session.step.failed` | 对带 tokens 的终态记账；失败但无用量不生成记录 |
| `session.compaction.ended` / `session.compaction.failed` | 以 event.id 作为 messageId 记账；缺少型号时显式保存 unknown |
| `session.execution.succeeded/failed/interrupted` | 展示根会话摘要 |
| `session.created` / `session.renamed` | 保存标题与父子关系，缺失元数据通过 session.get 恢复 |
| `session.usage.updated`、流式 delta、旧 idle/status | 不追加计费；避免累计值和双重结束信号重复处理 |

V2 `tokens.output` 是可见输出，`tokens.reasoning` 独立。写入历史兼容格式时 `output = visible output + reasoning`，并保留 `reasoning` 明细。计价继续由插件定价表与用户覆盖决定，不拿 OpenCode reported cost 当作权威账单。

当前公开事件不包含标题生成的逐次型号和用量。不要把 `usage.updated` 的累计差值伪装成某个模型的单次用量。消息开始事件缺失时查询 session.context 中相同 messageId 的模型；恢复失败以 unknown 落盘，不误用切换后的当前会话模型。

## 正确性边界

- 整个 server 的事件流必须按 event.location.directory 过滤，否则每个项目实例都会重复记录其他项目。
- 文件写入成功之后才确认去重和更新预算/会话统计；同一消息写入失败可重试。
- 去重与模型缓存有上限。订阅是实时流，不补采插件未运行期间的历史事件。
- 多项目实例通过 token 文件大小变化感知外部追加，只在变化或预算周期切换时重读窗口。
- 重启恢复父子关系与预算；Toast 不回放历史 token 总额。CLI 按保存的日志汇总。
- RPC 事件是实时提示，TUI 断开时错过的提示不回放；启动配置警告由 TUI 查询服务端，避免初始化时序丢失。
- 多个独立 server 进程同时消费同一个会话的跨进程去重不在本次保证范围内。

## 验证

```bash
npm test
npm run test:package
node scripts/real-opencode-cli-smoke.mjs --model YOUR_PROVIDER/YOUR_MODEL
```

回归包括旧预算/会话语义、V2 终态与字段映射、失败及缓存/推理专用量、多位置隔离、中途加载、RPC/TUI、清理和官方 Host 解析。`test:package` 从 npm tarball 验证导出与 CLI。

真实模型请求及交互 TUI 验收需要预先配置好的 V2 环境，见 [dogfood](real-opencode-cli-dogfood.md)。本次开发环境仍为 OpenCode 1.18.21，官方 Host 加载与模拟宿主事件回归不能替代完整 V2 真机验收。

## 核对来源（2026-10-08）

- [官方插件迁移指南](https://opencode.ai/v2/docs/build/plugins/migrate-v1)
- [官方 TUI 接口和包导出](https://opencode.ai/v2/docs/build/plugins/cli)
- [官方 RPC](https://opencode.ai/v2/docs/build/plugins/rpc)
- [v2.0.25 事件契约](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/schema/src/session-event.ts)
- [v2.0.25 token 计费口径](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/core/src/session/usage.ts)

官方文档示例中的无入参 RPC 可以省略 input，但 2.0.25 发布包的类型要求 input/output schema 均存在；实现显式使用 null schema，并以发布包编译验证。
