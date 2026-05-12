/// <reference types="chrome" />
/**
 * Example: Chrome Extension Background Service Worker
 *
 * Bootstraps the agent runtime when the extension is installed or the
 * service worker starts. The runtime handles:
 *   - WebSocket heartbeat (if accessToken + runtimeCfg are provided)
 *   - Scheduler (chrome.alarms for interval/cron, onMessage for manual trigger)
 *   - Token refresh (persisted to chrome.storage.local)
 *
 * Trigger the agent from popup.ts:
 *   chrome.runtime.sendMessage({ type: "agent_trigger" })
 *
 * Or from a content script after extracting page text:
 *   chrome.runtime.sendMessage({ type: "agent_trigger" })
 *   // agent receives ctx.input set by the last setAgentInput() call
 */
import { createChromeRuntime } from "../../src/runtime-chrome"
import myAgent from "./my-agent"

// ─── Load persisted config from chrome.storage ───────────────────────────────

async function loadConfig(): Promise<{
  accessToken?: string
  refreshToken?: string
  agentCtxJson?: string
}> {
  const stored = await chrome.storage.local.get([
    "lifetimesoft_access_token",
    "lifetimesoft_refresh_token",
    "lifetimesoft_agent_ctx",
  ])
  return {
    accessToken: stored.lifetimesoft_access_token as string | undefined,
    refreshToken: stored.lifetimesoft_refresh_token as string | undefined,
    agentCtxJson: stored.lifetimesoft_agent_ctx as string | undefined,
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let runtimeHandle: Awaited<ReturnType<typeof createChromeRuntime>> | null = null

async function startRuntime(): Promise<void> {
  const { accessToken, refreshToken, agentCtxJson } = await loadConfig()

  // agentCtx can be stored during extension setup / OAuth flow
  // For development, you can hardcode it here
  const agentCtx = agentCtxJson
    ? JSON.parse(agentCtxJson)
    : {
        input: {},
        config: {
          agent: "chrome-page-summariser",
          version: "1.0.0",
          // scheduler: { type: "none" }  ← default, manual trigger only
        },
        env: {
          // Use agent-side AI with your own key, or omit to use platform-side AI
          // gemini_api_key: "AIzaSy...",
          ai_model: "gemini-2.0-flash",
        },
        meta: {
          run_id: `ext-${Date.now()}`,
          timestamp: Date.now(),
          // runtime: { ws_url: "...", stopped_url: "...", heartbeat_interval_ms: 30000 }
          // ↑ provide this to enable WebSocket heartbeat + platform storage
        },
      }

  runtimeHandle = createChromeRuntime(myAgent, {
    agentCtx,
    accessToken,
    refreshToken,
    storageArea: "local",
    alarmPrefix: "page_summariser",
  })

  await runtimeHandle.start()
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// Start runtime when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  void startRuntime()
})

// Restart runtime when service worker wakes up (MV3 service workers can be terminated)
// The runtime re-reads tokens from chrome.storage on each start()
void startRuntime()

// ─── Input injection from content script / popup ─────────────────────────────
//
// Before sending "agent_trigger", the popup or content script should call
// setAgentInput() to provide the page text. The runtime will use it as ctx.input
// on the next run.
//
// This is handled via a separate message type to keep concerns separated.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    typeof message === "object" &&
    message !== null &&
    message.type === "set_agent_input"
  ) {
    // Store input in chrome.storage so the runtime can pick it up
    // The runtime reads ctx.input from agentCtx — update it before triggering
    void chrome.storage.local.set({ lifetimesoft_pending_input: message.data }).then(() => {
      sendResponse({ success: true })
    })
    return true // keep channel open for async response
  }
  return undefined
})
