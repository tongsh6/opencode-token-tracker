# Release 后必须回写 context 文档

日期：2026-02-11
任务：Task 9 — Release v1.5.0

## 背景

完成 v1.5.0 发布（version bump、CHANGELOG、tag、npm publish）后，未主动检查 REPO_SNAPSHOT.md 是否需要更新。

## 问题

发布流程中新建了 `CHANGELOG.md`，也变更了版本号，但 REPO_SNAPSHOT 的代码结构列表未包含 `CHANGELOG.md`，也未记录当前版本号。属于 context 文档与代码现状脱节。

## 原因

Release 任务关注点在 gitflow 和 npm 操作上，结束后未回到 AIEF 的"更新 context docs"步骤。

## 解决方案

在 AIEF 流程中加强意识：**每个任务完成后，主动检查 context 文档是否需要同步更新**。特别是：
- 新增/删除文件 -> 更新 REPO_SNAPSHOT 的代码结构
- 版本发布 -> 更新 REPO_SNAPSHOT 的版本信息
- 新增模块/函数 -> 更新关键模块描述

## 可复用结论

- 每个任务的最后一步应是"context 回写检查"
- Release 任务的检查清单：version in REPO_SNAPSHOT、新文件是否出现在代码结构中
- 养成习惯：代码变更提交后，立即 diff 一次 REPO_SNAPSHOT 检查是否过时
