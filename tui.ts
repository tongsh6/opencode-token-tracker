import * as Plugin from "@opencode/plugin/tui/plugin"
import { isTrackerToast, TrackerRpc } from "./lib/rpc.js"

export default Plugin.define({
  id: "opencode-token-tracker.tui",
  setup(context) {
    const controller = new AbortController()
    const rpc = context.client.rpc(TrackerRpc)
    const unsubscribe = rpc.events.on("toast", (event) => {
      if (controller.signal.aborted || event.location.directory !== context.location?.directory) return
      if (isTrackerToast(event.data)) context.ui.toast.show(event.data)
    }, { signal: controller.signal })

    // 初始化警告通过 RPC 查询，避免服务端启动早于 TUI 导致一次性事件丢失。
    void rpc.warnings(null, { location: context.location, signal: controller.signal }).then((warnings) => {
      if (controller.signal.aborted || !Array.isArray(warnings)) return
      const messages = warnings.filter((warning): warning is string => typeof warning === "string")
      if (messages.length > 0) context.ui.toast.show({
        title: "Token Tracker: config warning", message: messages.join("; "), variant: "warning", duration: 5000,
      })
    }).catch(() => {
      // 服务端尚未加载或连接关闭时，不影响终端使用。
    })

    return () => {
      controller.abort()
      unsubscribe()
    }
  },
})
