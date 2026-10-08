# OpenCode V2 插件迁移必须核对发布包契约

## 背景

插件 2.0.0 从 V1 函数入口迁移到 OpenCode V2 setup，原来的事件、TUI API 和测试宿主均需更新。

## 关键差异

- 文档中 session.idle 示例仍存在，但主请求应消费 session.step.started/ended/failed 的实际发布类型；不要只改配置字段或回调注册方式。
- V2 output 不含 reasoning，原有日志 output 是总输出口径。适配层合并一次，CLI 不再次加 reasoning。
- step 终态没有模型字段，需关联 started 的 model.id；中途加载只能从相同消息恢复，不能猜测当前会话型号。
- 事件订阅覆盖整个 server，必须按 location 过滤；TUI 仅订阅 RPC，不再实例化写日志的插件。
- SDK 2.0.25 的 RPC 方法必须提供 input/output schema，即使网页示例允许省略。以实际类型检查为准。
- 官方 Node Host 使用 registerHooks，需要 Node >= 22.15；Node 18 仍可测试轻量入口与独立 CLI，Host 验收在较新 Node 执行。

## 验证方式

从 V2 setup 驱动真实文件写入，覆盖预算切换、重复事件、日志失败、reasoning-only/cache-only、跨项目隔离和卸载。用官方 Host 解析包导出，并验证 npm tarball；实际模型和 TUI 验收另行标明完成状态。
