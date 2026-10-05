import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { BudgetStatus } from "../lib/shared.js"
import { buildMessageToast, formatBudgetMessage } from "../lib/shared.js"

describe("buildMessageToast", () => {
  it("includes session token and cost totals in normal message Toast copy", () => {
    const toast = buildMessageToast({
      messageTokens: 12_500,
      messageCost: 0.023,
      sessionTokens: 45_200,
      sessionCost: 0.156,
      budget: null,
    })

    assert.deepEqual(toast, {
      title: "12.5K tokens",
      message: "$0.023 | Session: 45.2K · $0.156",
      variant: "info",
    })
  })

  it("keeps session token totals in budget warning Toast copy", () => {
    const budget: BudgetStatus = {
      period: "daily",
      spent: 4.2,
      limit: 5,
      percentage: 0.84,
      exceeded: false,
      warning: true,
    }

    const toast = buildMessageToast({
      messageTokens: 12_500,
      messageCost: 0.023,
      sessionTokens: 45_200,
      sessionCost: 0.156,
      budget,
    })

    assert.deepEqual(toast, {
      title: "12.5K tokens",
      message: "$0.023 | Session: 45.2K · Daily: $4.20/$5.00 (84%)",
      variant: "warning",
    })
  })

  it("preserves exceeded budget Toast copy without session details", () => {
    const budget: BudgetStatus = {
      period: "daily",
      spent: 5.5,
      limit: 5,
      percentage: 1.1,
      exceeded: true,
      warning: false,
    }

    const toast = buildMessageToast({
      messageTokens: 12_500,
      messageCost: 0.023,
      sessionTokens: 45_200,
      sessionCost: 0.156,
      budget,
    })

    assert.deepEqual(toast, {
      title: "⚠️ Budget exceeded!",
      message: formatBudgetMessage(budget),
      variant: "error",
    })
    assert.equal(toast.message.includes("Session"), false)
  })

  it("formats zero session tokens compactly", () => {
    const toast = buildMessageToast({
      messageTokens: 500,
      messageCost: 0.001,
      sessionTokens: 0,
      sessionCost: 0,
      budget: null,
    })

    assert.equal(toast.message, "$0.0010 | Session: 0 · $0.0000")
  })
})
