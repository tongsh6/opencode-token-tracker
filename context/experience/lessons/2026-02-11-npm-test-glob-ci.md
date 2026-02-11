# npm test glob 在 CI 中不展开

## 背景

为项目添加 CI（GitHub Actions），`npm test` script 中使用了 `node --test dist/test/**/*.test.js` 的 glob 模式。

## 问题

CI 环境（Ubuntu runner）中运行 `npm test` 时报错：`Could not find 'dist/test/**/*.test.js'`。本地 macOS 上正常运行。

## 原因

- `**` 是 bash 的 `globstar` 特性，默认在非交互式 shell 中未开启
- npm scripts 通过 `/bin/sh` 执行，不一定是 bash，即使是 bash 也未启用 `globstar`
- 结果：`**/*.test.js` 被当作字面字符串传给 node，找不到文件

## 解决方案

将 glob 模式替换为显式文件路径：

```json
"test": "tsc && node --test dist/test/shared.test.js"
```

如果未来测试文件增多，可以改为：
- 用 `find` 命令动态查找：`tsc && node --test $(find dist/test -name '*.test.js')`
- 或在 CI 中显式设置 bash globstar：`shopt -s globstar && node --test dist/test/**/*.test.js`

## 可复用结论

- npm scripts 中避免使用 `**` glob，不具跨平台可移植性
- 优先使用显式路径或工具提供的 glob 参数（如 `--test-path-pattern`）
- CI 环境的 shell 行为不等同于本地开发环境
