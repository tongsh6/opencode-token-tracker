# By Session 显示会话标题（含父会话汇总）— 设计

- 日期：2026-06-02
- 分支：`feat/by-session-titles`
- 命令：`opencode-tokens [period] --by session`

## 背景与问题

`--by session` 当前每行显示 `truncateSessionId()` 截出的**前 14 个字符**（如 `ses_178cd2e76f…`）。OpenCode 的 session id 是按时间排序的前缀编码，同期会话开头几乎一样，截断恰好保留最相似的头部、丢掉有区分度的尾部。整张表只有 `Session / Tokens / Cost / Msgs`，没有任何时间或语义信息，导致：

1. 行与行难以区分（前缀雷同）。
2. 即使能区分，也认不出"哪一行是哪次对话"。

## 可行性结论

- OpenCode SDK 有 **`session.created` / `session.updated`** 事件，`properties.info` 是完整 `Session`，含 `id / title / directory / parentID / time`。plugin 已在监听 `event`，只需多处理这两类事件即可拿到标题，**无需读 SQLite、无需额外 API、无需轮询**。
- 历史旧会话（截图里的 `ses_178…`）的 JSON 已被 OpenCode 清理，标题仅存于 786MB 的内部 `opencode.db`（SQLite）。读它需要 `node:sqlite`（仅 Node 22+，破坏 `engines.node>=18`）且耦合内部 schema、易碎——**不采用**。

## 方案（B1：从启用起抓标题 + 旧会话回退 + 按父会话汇总）

### 数据流

```
OpenCode ──session.created/updated──▶ plugin(index.ts)
                                          │ info.title / parentID / directory
                                          ▼
              sessions.jsonl  (侧车文件，追加写，CLI 读取时 latest-wins)
                                          │
opencode-tokens --by session ─▶ CLI ─ 按"根会话"汇总并 join 标题 ─▶ 表格
```

### 改动 1：plugin 捕获会话元数据（`index.ts`）

- 在现有 `event` 处理器新增分支处理 `session.created` 与 `session.updated`：从 `event.properties.info` 取 `id`、`title`（trim）、`parentID`、`directory`。
- 写入**新侧车文件** `~/.config/opencode/logs/token-tracker/sessions.jsonl`，每条形如：
  `{"type":"session","sessionId":"ses_...","title":"Fix login bug","parentID":"ses_...","directory":"D:\\...","_ts":1770...}`
- **写入条件**：`title` 非空 **或** `parentID` 存在（即便标题尚未生成，也要记下 `parentID` 以支撑汇总）。
- **去重**：进程内维护 `seenSessions: Set`，key = `id|title|parentID`，未变化不重复追加；多子进程偶发重复行由 CLI 读取时 latest-wins 收敛。
- 选用独立侧车文件的理由：不碰 `tokens.jsonl` 计费热路径；追加写对多进程并发安全；文件小。

### 改动 2：纯逻辑放入 `lib/shared.ts`（可单测）

- `SessionMeta` 类型：`{ sessionId, title?, parentID?, directory?, _ts }`。
- `resolveRootSession(sessionId, parentOf)`：沿 `parentID` 链向上找根，带 `seen` 环路保护；父未知即停在当前。
- `mergeSessionMeta(records)`：把多条 `sessions.jsonl` 记录按 sessionId 合并为 `Map<id, SessionMeta>`，同字段 last-non-empty-wins（保证 created 写的 parentID 与 updated 写的 title 都保留）。
- `truncateLabel(str, max)`：超长加 `…`。
- `shortSessionCode(id)`：回退短码——取 id 末段有区分度的部分（`…` + 末 10 字符；过短则原样）。
- `sessionDisplayLabel(rootId, meta, maxWidth)`：有非空 `title` → `truncateLabel(title, maxWidth)`；否则 `shortSessionCode(rootId)`。

### 改动 3：CLI 渲染（`bin/opencode-tokens.ts`）

- `loadSessionMeta()`：整读 `sessions.jsonl` → `mergeSessionMeta` → `Map<id, SessionMeta>`；文件缺失返回空 Map。
- 新增 `printSessionBreakdown(entries, metaMap)` 替换 `--by session` 的渲染：
  1. 由 metaMap 建 `parentOf: Map<id, parentID>`。
  2. 遍历 token 记录：`root = resolveRootSession(e.sessionId, parentOf)`，把 stats 累加到 `root` 行；记录每个 root 的 `lastActive = max(_ts)`。
  3. 每行 label = `sessionDisplayLabel(root, metaMap.get(root), 40)`。
  4. 列：`Session | Last Active | Tokens | Cost | Msgs`；`Last Active` 复用现有 `formatAge`。按 cost 降序。
- 旧的 `truncateSessionId` 不再用于此表（如无其它引用则移除）。

### 子会话（subagent）

- 带 `parentID` 的子会话 token **归并到根会话行**，标签用根会话标题；子会话自身标题不单独成行。代价：成本正确归属到父对话，但子任务描述性标题被隐藏（用户已确认接受）。

## 边界与兼容

- `sessions.jsonl` 不存在/为空 → 全部走短码回退，行为不退化。
- 截图里的旧会话本次不补标题，显示"短码 + Last Active"；之后被再次使用即写入标题。
- 仅改 `--by session` 维度；`export`、其它 `--by` 维度、计费逻辑均不动。

## 测试（TDD，沿用 `node:test`）

- `test/shared.test.ts`：`resolveRootSession`（单层/多层/环路/父未知）、`mergeSessionMeta`（latest/字段合并）、`truncateLabel`、`shortSessionCode`、`sessionDisplayLabel`（有/无标题）。
- `test/cli.test.ts`：sandbox 同时写 `tokens.jsonl` + `sessions.jsonl`，断言 `--by session` 输出含标题、含 `Last Active`、子会话成本并入父行、无元数据时回退短码。

## 改动面

3 文件：`index.ts`、`bin/opencode-tokens.ts`、`lib/shared.ts`（+ 两个测试文件）。新增 1 个运行时数据文件 `sessions.jsonl`。
