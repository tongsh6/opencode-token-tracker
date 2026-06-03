import { describe, it } from "node:test"
import { strict as assert } from "node:assert"
import {
  resolveRootSession,
  mergeSessionMeta,
  truncateLabel,
  shortSessionCode,
  sessionDisplayLabel,
  buildSessionRecord,
} from "../lib/shared.js"

// ============================================================================
// resolveRootSession
// ============================================================================

describe("resolveRootSession", () => {
  it("returns the id itself when it has no parent", () => {
    const parentOf = new Map<string, string | undefined>()
    assert.equal(resolveRootSession("s1", parentOf), "s1")
  })

  it("returns the parent for a one-level child", () => {
    const parentOf = new Map<string, string | undefined>([["child", "root"]])
    assert.equal(resolveRootSession("child", parentOf), "root")
  })

  it("walks multiple levels up to the root", () => {
    const parentOf = new Map<string, string | undefined>([
      ["a", "b"],
      ["b", "c"],
    ])
    assert.equal(resolveRootSession("a", parentOf), "c")
  })

  it("returns the root id even when that root has no metadata entry", () => {
    const parentOf = new Map<string, string | undefined>([["child", "ghost"]])
    assert.equal(resolveRootSession("child", parentOf), "ghost")
  })

  it("terminates on a cycle without infinite looping", () => {
    const parentOf = new Map<string, string | undefined>([
      ["a", "b"],
      ["b", "a"],
    ])
    const root = resolveRootSession("a", parentOf)
    assert.ok(root === "a" || root === "b")
  })
})

// ============================================================================
// mergeSessionMeta
// ============================================================================

describe("mergeSessionMeta", () => {
  it("merges parentID from an early record with title from a later one", () => {
    const map = mergeSessionMeta([
      { sessionId: "s1", parentID: "p1", _ts: 1 },
      { sessionId: "s1", title: "Fix login bug", _ts: 2 },
    ])
    const meta = map.get("s1")
    assert.equal(meta?.title, "Fix login bug")
    assert.equal(meta?.parentID, "p1")
    assert.equal(meta?._ts, 2)
  })

  it("does not let a later empty title clobber an earlier non-empty title", () => {
    const map = mergeSessionMeta([
      { sessionId: "s1", title: "Real Title", _ts: 1 },
      { sessionId: "s1", title: "   ", _ts: 2 },
    ])
    assert.equal(map.get("s1")?.title, "Real Title")
  })

  it("keeps sessions independent", () => {
    const map = mergeSessionMeta([
      { sessionId: "s1", title: "One", _ts: 1 },
      { sessionId: "s2", title: "Two", _ts: 1 },
    ])
    assert.equal(map.get("s1")?.title, "One")
    assert.equal(map.get("s2")?.title, "Two")
  })

  it("ignores records without a sessionId", () => {
    const map = mergeSessionMeta([
      { title: "orphan", _ts: 1 } as unknown as { sessionId: string; _ts: number },
    ])
    assert.equal(map.size, 0)
  })
})

// ============================================================================
// truncateLabel
// ============================================================================

describe("truncateLabel", () => {
  it("leaves short strings unchanged", () => {
    assert.equal(truncateLabel("abc", 10), "abc")
  })

  it("leaves exact-length strings unchanged", () => {
    assert.equal(truncateLabel("abcde", 5), "abcde")
  })

  it("truncates over-long strings with an ellipsis within the limit", () => {
    assert.equal(truncateLabel("abcdef", 5), "abcd…")
  })
})

// ============================================================================
// shortSessionCode
// ============================================================================

describe("shortSessionCode", () => {
  it("returns 'unknown' for missing id", () => {
    assert.equal(shortSessionCode(undefined), "unknown")
    assert.equal(shortSessionCode(""), "unknown")
  })

  it("keeps short ids as-is", () => {
    assert.equal(shortSessionCode("ses_abc"), "ses_abc")
  })

  it("shows the distinctive tail of long ids", () => {
    assert.equal(shortSessionCode("ses_ABCDEFGHIJKLMNOP"), "…GHIJKLMNOP")
  })
})

// ============================================================================
// sessionDisplayLabel
// ============================================================================

describe("sessionDisplayLabel", () => {
  it("uses the title when present", () => {
    const meta = { sessionId: "root", title: "Refactor token parser", _ts: 1 }
    assert.equal(sessionDisplayLabel("root", meta, 40), "Refactor token parser")
  })

  it("falls back to a short code when there is no metadata", () => {
    assert.equal(sessionDisplayLabel("ses_ABCDEFGHIJKLMNOP", undefined, 40), "…GHIJKLMNOP")
  })

  it("falls back to a short code when the title is empty", () => {
    const meta = { sessionId: "ses_ABCDEFGHIJKLMNOP", title: "  ", _ts: 1 }
    assert.equal(sessionDisplayLabel("ses_ABCDEFGHIJKLMNOP", meta, 40), "…GHIJKLMNOP")
  })

  it("truncates a long title to the max width", () => {
    const meta = { sessionId: "root", title: "A very long session title that exceeds the column width budget", _ts: 1 }
    const label = sessionDisplayLabel("root", meta, 20)
    assert.equal(label.length, 20)
    assert.ok(label.endsWith("…"))
  })
})

// ============================================================================
// buildSessionRecord
// ============================================================================

describe("buildSessionRecord", () => {
  it("builds a record from id + title", () => {
    assert.deepEqual(buildSessionRecord({ id: "s1", title: "Fix bug" }), {
      sessionId: "s1",
      title: "Fix bug",
    })
  })

  it("trims the title", () => {
    assert.equal(buildSessionRecord({ id: "s1", title: "  Fix bug  " })?.title, "Fix bug")
  })

  it("records parentID even when the title is not yet generated", () => {
    assert.deepEqual(buildSessionRecord({ id: "child", parentID: "root" }), {
      sessionId: "child",
      parentID: "root",
    })
  })

  it("returns null when there is neither a title nor a parent", () => {
    assert.equal(buildSessionRecord({ id: "s1" }), null)
    assert.equal(buildSessionRecord({ id: "s1", title: "   " }), null)
  })

  it("returns null without an id", () => {
    assert.equal(buildSessionRecord({ title: "orphan" }), null)
  })

  it("includes directory when provided", () => {
    assert.equal(buildSessionRecord({ id: "s1", title: "t", directory: "D:\\work" })?.directory, "D:\\work")
  })
})
