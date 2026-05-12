/// <reference types="chrome" />
/**
 * Example: Chrome Extension Popup
 *
 * Extracts the current tab's text content, sends it to the background
 * service worker as agent input, then triggers the agent to run.
 * Displays the summary result when done.
 */

interface SummaryResult {
  success: boolean
  result?: { summary: string; wordCount: number }
  error?: string
}

interface StoredSummary {
  summary: string
  url?: string
  timestamp: number
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function setStatus(text: string, isError = false): void {
  const status = el<HTMLParagraphElement>("status")
  status.textContent = text
  status.style.color = isError ? "#e53e3e" : "#718096"
}

function setSummary(text: string): void {
  el<HTMLParagraphElement>("summary").textContent = text
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const summariseBtn = el<HTMLButtonElement>("summarise-btn")
  const lastSummarySection = el<HTMLDivElement>("last-summary")

  // load last cached summary from storage
  const stored = await chrome.storage.local.get("lifetimesoft_storage_last_summary")
  const cached = stored["lifetimesoft_storage_last_summary"] as
    | { value: StoredSummary }
    | undefined

  if (cached?.value) {
    const { summary, url, timestamp } = cached.value
    const age = Math.round((Date.now() - timestamp) / 1000)
    lastSummarySection.style.display = "block"
    el<HTMLParagraphElement>("last-summary-text").textContent = summary
    el<HTMLSpanElement>("last-summary-meta").textContent =
      `${url ?? "unknown page"} · ${age}s ago`
  }

  summariseBtn.addEventListener("click", async () => {
    summariseBtn.disabled = true
    setStatus("Extracting page content...")

    try {
      // get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) throw new Error("No active tab")

      // inject content script to extract page text
      const [{ result: pageText }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText,
      })

      if (!pageText?.trim()) throw new Error("Page has no readable text")

      setStatus("Sending to agent...")

      // send input to background service worker
      await chrome.runtime.sendMessage({
        type: "set_agent_input",
        data: { pageText, url: tab.url },
      })

      setStatus("Running agent...")

      // trigger the agent — background.ts handles this via chrome.runtime.onMessage
      const response = await chrome.runtime.sendMessage({
        type: "agent_trigger",
      }) as SummaryResult | undefined

      if (response?.success && response.result) {
        setSummary(response.result.summary)
        setStatus(`Done · ${response.result.wordCount} words`)
      } else {
        throw new Error(response?.error ?? "Agent returned no result")
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Error: ${msg}`, true)
    } finally {
      summariseBtn.disabled = false
    }
  })
}

void run()
