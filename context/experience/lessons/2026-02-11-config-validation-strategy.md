# 配置验证：静默修正 vs 抛错拒绝

日期：2026-02-11
任务：Task 6 — Config Validation

## 背景

为用户 JSON 配置文件添加校验逻辑。配置可能包含错误类型、负数、超范围值、甚至 Infinity/NaN。

## 问题

两种策略的选择：
- **抛错拒绝**：发现无效字段直接报错，要求用户修复后重启
- **静默修正**：无效字段回退到默认值，收集 warnings 通知用户

## 决策

选择**静默修正 + warnings 收集**，原因：

1. 与项目已有的错误处理策略一致（`conventions/typescript.md` 第 6 条：非关键路径静默降级）
2. 配置错误不应阻止插件运行——用户可能只是拼写了一个字段，不应因此完全失去 token 追踪功能
3. warnings 数组让调用方自行决定展示方式（插件用 Toast，CLI 用 stderr）
4. 纯函数 `validateConfig(raw): { config, warnings }` 易于测试、无副作用

## 可复用结论

- 对于**用户配置校验**，静默修正 + warnings 优于抛错拒绝
- 验证函数应返回 `{ result, warnings }` 结构，不产生副作用
- 上层代码根据自身上下文决定 warnings 的展示渠道
- 与 `conventions/typescript.md` 第 6 条保持一致
