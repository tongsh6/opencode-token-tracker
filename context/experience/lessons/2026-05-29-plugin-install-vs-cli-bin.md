# OpenCode 插件安装与 CLI bin 边界

## 背景

用户在 `~/.config/opencode/opencode.jsonc` 中加入
`"plugin": ["opencode-token-tracker"]` 后，执行 `opencode-tokens today` 出现
`opencode-tokens: command not found`。

## 问题

文档把插件安装和 CLI 使用连续展示，容易让用户误以为 OpenCode 自动安装插件包后，
shell 中也会出现 `opencode-tokens` 命令。

## 原因

OpenCode 的插件自动安装只服务于 OpenCode 插件运行时；它不会把 npm package 的
`bin` 链接到用户 shell `PATH`。

## 解决方案

安装文档需要拆成两个路径：

- 插件路径：添加 OpenCode `plugin` 配置，用于 Toast 和 token 日志记录。
- CLI 路径：使用 `npx -y --package opencode-token-tracker opencode-tokens ...`、显式
  `npm exec --package opencode-token-tracker -- opencode-tokens ...`，或用户自行选择
  npm 全局 bin 链接。

## 可复用结论

凡是 npm 包同时承担插件和 CLI 职责，README 必须明确区分 runtime install 与 shell
command availability，尤其要为 `command not found` 给出直接诊断。
