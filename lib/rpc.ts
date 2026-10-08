import { Rpc } from "@opencode/plugin/rpc"

export interface TrackerToast {
  title: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
  sessionID?: string
}

export const TrackerRpc = Rpc.define({
  id: "opencode-token-tracker",
  methods: {
    warnings: {
      input: { type: "null" },
      output: { type: "array", items: { type: "string" } },
    },
  },
  events: {
    toast: {
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
          variant: { enum: ["info", "success", "warning", "error"] },
          duration: { type: "number" },
          sessionID: { type: "string" },
        },
        required: ["title", "message", "variant", "duration"],
        additionalProperties: false,
      },
    },
  },
})

export function isTrackerToast(value: unknown): value is TrackerToast {
  if (!value || typeof value !== "object") return false
  const toast = value as Record<string, unknown>
  return typeof toast.title === "string" && typeof toast.message === "string"
    && ["info", "success", "warning", "error"].includes(String(toast.variant))
    && typeof toast.duration === "number" && Number.isFinite(toast.duration) && toast.duration >= 0
    && (toast.sessionID === undefined || typeof toast.sessionID === "string")
}
