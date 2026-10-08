# OpenCode V2 真实 CLI 验收

适用于插件 2.0.0 和 OpenCode >= 2.0.25 且 < 3。脚本调用已安装的 V2，不安装或升级全局工具，不改写配置，不替换缓存链接。请求会产生模型费用并追加 tracker 日志。

## 准备

先构建：

```bash
npm run build
```

在专用测试项目的 `opencode.json` 中配置当前仓库入口（避免同时加载发布包和本地插件）：

```json
{
  "plugins": ["/absolute/path/opencode-token-tracker/index.ts"]
}
```

该配置用于服务端 CLI 记账验收。交互 TUI 验收应使用安装包的 `.` / `./tui` 导出；本地源文件测试时在 `cli.json` 的 `plugins` 中添加绝对路径 `tui.ts`。修改全局配置须遵守本机授权、备份和恢复策略。

正式发布前还应把 `npm pack` 产物装入测试项目，并验证实际安装包的两个入口，而不只测试链接到工作区的源码。

## 命令

在已配置的测试项目目录执行：

```bash
node /absolute/path/opencode-token-tracker/scripts/real-opencode-cli-smoke.mjs --model YOUR_PROVIDER/YOUR_MODEL --prompt "Reply with OK only."
```

脚本调用 `opencode run --standalone --print-logs --format json`，使用 `OPENCODE_LOG_LEVEL=debug`。检测到 V1 时在调用模型前退出。`--opencode PATH` 或 `OPENCODE_CLI` 可指定已安装的 V2 二进制。

## 自动检查

- 进程成功退出，stdout 存在 `step_finish`。
- 没有该插件的加载失败日志。
- 每个 step_finish 在新增 JSONL 中都有精确 sessionID/messageID 匹配且仅一条记录。
- input、output + reasoning、reasoning、cache read/write 与 V2 输出一致。
- 费用 drift 写入摘要，仅作为对照；`--fail-on-opencode-cost-drift` 可将差异作为失败。

`run` 不启动 TUI，因此不要求旧 `tui.toast.show` 日志。Toast 由 TUI/RPC 回归验证，并在真实交互终端补充确认：普通消息、预算警告、主子会话摘要，以及同一 server 的两个终端显示提示但 token 日志只有一份。

## 产物

`dogfood-artifacts/<timestamp>/` 中保存 stdout.jsonl、stderr.log、token-log-delta.jsonl 和 summary.json，该目录已忽略。summary 的通过只代表 CLI 采集验收，不代表交互 TUI 已验收。

环境变量：`OPENCODE_CLI`、`OPENCODE_DOGFOOD_MODEL`、`OPENCODE_DOGFOOD_PROMPT`、`OPENCODE_DOGFOOD_TIMEOUT_MS`、`OPENCODE_DOGFOOD_ARTIFACTS`。完整参数见 `--help`。
