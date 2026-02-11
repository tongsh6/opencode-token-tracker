# TypeScript Conventions

本文件定义 `opencode-token-tracker` 的 TypeScript 代码风格与实现约定。

## 1) 基线配置

- TypeScript strict 模式
- ESM + ES2022
- `moduleResolution: bundler`
- 2 空格缩进、双引号、无分号

## 2) 导入约定

- 类型导入使用 `import type`
- Node.js 内置模块使用命名导入，不使用默认导入
- 推荐导入顺序：类型导入 -> Node.js 内置模块 -> 本地模块

## 3) 格式与可读性

- 多行对象/数组保留尾逗号
- 大数字使用数字分隔符（如 `1_000_000`）
- 相关逻辑块可使用 `// ====...====` 分段标题
- 注释只用于解释非直观逻辑，避免噪音注释

## 4) 类型系统使用

- 对象结构优先使用 `interface`（非必要不使用 `type` 定义对象）
- 键值映射优先 `Record<string, T>`
- 可选字段优先 `field?: Type`
- 减少 `as` 断言，优先类型收窄
- 非空断言 `!` 仅在充分前置判断后使用（如 `Map.has()`）

## 5) 命名规范

- 变量/函数：`camelCase`
- 接口/类型：`PascalCase`
- 模块级常量：`UPPER_SNAKE_CASE`
- 函数命名：动词开头（如 `getModelPricing`、`calculateCost`）
- CLI 命令函数：`cmd` 前缀（如 `cmdStats`）
- 布尔命名：`is` / `has` 前缀

## 6) 错误处理策略

- 非关键路径使用静默降级，不因局部失败中断主流程
- 允许在配置解析、JSONL 行解析等场景使用 `try/catch` + 安全默认值
- 静默 catch 需要简短注释说明原因（如 `// Config parse error - use defaults`）
- `showToast` 调用需隔离失败，不影响主逻辑

## 7) 函数与模块模式

- 优先小型纯函数，便于复用与测试
- 函数签名可使用默认参数（如 `cacheRead: number = 0`）
- 读取可选嵌套字段时优先 `?.`，兜底优先 `??`
- 模块以函数 + 普通对象为主，不引入 class 架构
- 插件入口保持命名导出与默认导出共存

## 8) 项目特定约束

- 除 `@opencode-ai/plugin` 外不新增运行时依赖
- `dist/` 为构建产物，不直接编辑
- 定价数据、共享类型和工具函数统一在 `lib/shared.ts` 维护
