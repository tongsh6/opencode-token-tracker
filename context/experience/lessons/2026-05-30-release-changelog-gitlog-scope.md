# Release changelog must start from the tag range

## 背景

1.7.1 准备时，最初的 `CHANGELOG.md` 只覆盖了最后一轮 #80 与 cache-only 口径修复。
但 `git log v1.7.0..main` 显示，待发布范围还包含 CLI doctor、models 下一步提示、
本地/订阅 provider 零成本建议、定价刷新、CLI 参数校验、release controller 与安装文档等改动。

## 问题

只根据当前任务上下文写 changelog，容易漏掉同一待发布区间里已经合入 `main` 但尚未打 tag 的改动。
这会让 npm/GitHub Release 说明低估实际变更，也会降低后续 issue 回溯和用户升级判断的可信度。

## 解决方案

发布前的 changelog 应以目标版本的完整 git 范围为准：

```bash
git log --no-merges --oneline v<previous>..HEAD
git log --merges --oneline v<previous>..HEAD
```

再对照项目文档、context 台账和已关闭 issue/PR，把条目归类到 Added、Changed、Fixed、
Documentation、Internal 等章节。

## 可复用结论

- release changelog 的真源范围是 `上一版 tag..待发布 HEAD`，不是最后一个修复分支。
- 如果 release PR 已合并但 tag 尚未创建，补 changelog 仍应先从 `main` 同步回 `dev`，再走一次文档 PR。
- 版本比较链接也属于 changelog 完整性检查项，顶部版本的 compare reference 不应缺失。
