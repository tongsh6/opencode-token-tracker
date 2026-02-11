# Experience INDEX

用于沉淀开发过程中的复盘、坑位与最佳实践。

## 目录

| 路径 | 说明 |
| --- | --- |
| `context/experience/lessons/` | 经验条目目录 |

## 记录约定

- 文件命名建议：`YYYY-MM-DD-主题.md`
- 单条经验建议包含：背景、问题、原因、解决方案、可复用结论
- 新增条目后同步更新本索引

## 条目列表

| 日期 | 文件 | 摘要 |
| --- | --- | --- |
| 2026-02-10 | `lessons/2026-02-10-误提交到main.md` | Agent 未读分支策略，直接推送到 main；需在任务前确认分支约束 |
| 2026-02-11 | `lessons/2026-02-11-npm-test-glob-ci.md` | npm scripts 中 `**` glob 在 CI 不展开；应使用显式路径 |
| 2026-02-11 | `lessons/2026-02-11-config-validation-strategy.md` | 配置验证选择静默修正 + warnings 收集，而非抛错拒绝 |
| 2026-02-11 | `lessons/2026-02-11-release-context-sync.md` | Release 后必须回写 context 文档，避免 REPO_SNAPSHOT 脱节 |
