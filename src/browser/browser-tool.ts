import WebSocket from 'ws'
import type {
  ScreenshotResult,
  ClickOptions,
  TypeOptions,
  NavigateOptions,
  EvaluateOptions,
  CDPCommand,
  CDPResponse,
  CDPEvent,
  OpenUrlResult,
} from './types.js'
import { getRelayServer } from './relay-server.js'

const BROWSER_RELAY_PORT = parseInt(process.env.BROWSER_RELAY_PORT || '18792', 10)
const RELAY_CDP_WS_URL = `ws://127.0.0.1:${BROWSER_RELAY_PORT}/cdp`

let cdpWs: WebSocket | null = null
let nextCommandId = 1
const pendingCommands = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }
>()

async function ensureCdpConnection(): Promise<WebSocket> {
  if (cdpWs && cdpWs.readyState === WebSocket.OPEN) {
    return cdpWs
  }

  // 같은 프로세스에서 실행 중인 릴레이 서버가 있으면 사용
  const relay = getRelayServer()
  const cdpWsUrl = relay ? relay.cdpWsUrl : RELAY_CDP_WS_URL

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cdpWsUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('CDP WebSocket connection timeout'))
    }, 5000)

    ws.on('open', () => {
      clearTimeout(timeout)
      cdpWs = ws
      resolve(ws)
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`CDP WebSocket error: ${err.message}`))
    })

    ws.on('close', () => {
      cdpWs = null
      for (const [id, pending] of pendingCommands) {
        clearTimeout(pending.timer)
        pending.reject(new Error('CDP connection closed'))
        pendingCommands.delete(id)
      }
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as CDPResponse | CDPEvent
        if ('id' in msg && typeof msg.id === 'number') {
          const pending = pendingCommands.get(msg.id)
          if (pending) {
            pendingCommands.delete(msg.id)
            clearTimeout(pending.timer)
            if (msg.error) {
              pending.reject(new Error(msg.error.message))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    })
  })
}

async function sendCdpCommand(
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
): Promise<unknown> {
  const ws = await ensureCdpConnection()
  const id = nextCommandId++

  const cmd: CDPCommand = { id, method }
  if (params) cmd.params = params
  if (sessionId) cmd.sessionId = sessionId

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      reject(new Error(`CDP command timeout: ${method}`))
    }, 30000)

    pendingCommands.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify(cmd))
  })
}

// Get first available session ID
async function getSessionId(): Promise<string | undefined> {
  const relay = getRelayServer()
  if (!relay) return undefined
  const status = relay.getStatus()
  return status.targets[0]?.sessionId
}

/**
 * Check if browser is connected and available
 */
export async function isConnected(): Promise<boolean> {
  const relay = getRelayServer()
  if (!relay) return false
  return relay.extensionConnected()
}

/**
 * Get browser connection status
 */
export async function getStatus() {
  const relay = getRelayServer()
  if (!relay) {
    return {
      connected: false,
      extensionConnected: false,
      targets: [],
      activeTargetId: undefined,
    }
  }
  return relay.getStatus()
}

/**
 * Take a screenshot of the current page
 */
export async function screenshot(options?: {
  format?: 'png' | 'jpeg'
  quality?: number
  fullPage?: boolean
  sessionId?: string  // 특정 탭의 sessionId 지정
}): Promise<ScreenshotResult> {
  // 지정된 sessionId가 있으면 사용, 없으면 기본 sessionId
  const sessionId = options?.sessionId ?? (await getSessionId())

  const params: Record<string, unknown> = {
    format: options?.format ?? 'png',
  }
  if (options?.quality !== undefined) {
    params.quality = options.quality
  }
  if (options?.fullPage) {
    params.captureBeyondViewport = true
  }

  const result = (await sendCdpCommand(
    'Page.captureScreenshot',
    params,
    sessionId
  )) as { data: string }

  return {
    data: result.data,
    format: (options?.format ?? 'png') as 'png' | 'jpeg',
  }
}

/**
 * Click on an element or coordinates
 */
export async function click(options: ClickOptions): Promise<void> {
  const sessionId = await getSessionId()

  let x: number
  let y: number

  if (options.selector) {
    // Find element by selector and get its center
    const nodeResult = (await sendCdpCommand(
      'DOM.getDocument',
      {},
      sessionId
    )) as { root: { nodeId: number } }

    const queryResult = (await sendCdpCommand(
      'DOM.querySelector',
      {
        nodeId: nodeResult.root.nodeId,
        selector: options.selector,
      },
      sessionId
    )) as { nodeId: number }

    if (!queryResult.nodeId) {
      throw new Error(`Element not found: ${options.selector}`)
    }

    const boxResult = (await sendCdpCommand(
      'DOM.getBoxModel',
      { nodeId: queryResult.nodeId },
      sessionId
    )) as { model: { content: number[] } }

    const content = boxResult.model.content
    x = (content[0] + content[2]) / 2
    y = (content[1] + content[5]) / 2
  } else if (options.x !== undefined && options.y !== undefined) {
    x = options.x
    y = options.y
  } else {
    throw new Error('Either selector or x/y coordinates required')
  }

  // Dispatch mouse events
  await sendCdpCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    },
    sessionId
  )

  await sendCdpCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    },
    sessionId
  )
}

/**
 * Type text into the focused element
 */
export async function type(options: TypeOptions): Promise<void> {
  const sessionId = await getSessionId()
  const delay = options.delay ?? 0

  for (const char of options.text) {
    await sendCdpCommand(
      'Input.dispatchKeyEvent',
      {
        type: 'keyDown',
        text: char,
      },
      sessionId
    )
    await sendCdpCommand(
      'Input.dispatchKeyEvent',
      {
        type: 'keyUp',
        text: char,
      },
      sessionId
    )

    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

/**
 * Navigate to a URL
 */
export async function navigate(options: NavigateOptions): Promise<void> {
  const sessionId = await getSessionId()

  await sendCdpCommand(
    'Page.navigate',
    { url: options.url },
    sessionId
  )

  // Wait for load if requested
  if (options.waitUntil) {
    // Simple wait for load event
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/**
 * Execute JavaScript in the page context
 */
export async function evaluate(options: EvaluateOptions & { sessionId?: string }): Promise<unknown> {
  const sessionId = options.sessionId ?? await getSessionId()

  const result = (await sendCdpCommand(
    'Runtime.evaluate',
    {
      expression: options.script,
      returnByValue: options.returnByValue ?? true,
      awaitPromise: true,
    },
    sessionId
  )) as {
    result: { value?: unknown; description?: string }
    exceptionDetails?: { text: string }
  }

  if (result.exceptionDetails) {
    throw new Error(`JavaScript error: ${result.exceptionDetails.text}`)
  }

  return result.result.value
}

/**
 * Get page title
 */
export async function getTitle(): Promise<string> {
  const result = await evaluate({ script: 'document.title' })
  return String(result ?? '')
}

/**
 * Get current URL
 */
export async function getUrl(): Promise<string> {
  const result = await evaluate({ script: 'window.location.href' })
  return String(result ?? '')
}

/**
 * Get page HTML content
 */
export async function getHtml(sessionId?: string): Promise<string> {
  const result = await evaluate({ script: 'document.documentElement.outerHTML', sessionId })
  return String(result ?? '')
}

/**
 * Get text content of an element
 */
export async function getText(selector: string): Promise<string> {
  const result = await evaluate({
    script: `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`,
  })
  return String(result ?? '')
}

/**
 * Check if an element exists
 */
export async function exists(selector: string): Promise<boolean> {
  const result = await evaluate({
    script: `document.querySelector(${JSON.stringify(selector)}) !== null`,
  })
  return Boolean(result)
}

/**
 * Wait for an element to appear
 */
export async function waitForSelector(
  selector: string,
  timeout = 5000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await exists(selector)) {
      return true
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

/**
 * Scroll to coordinates or element
 */
export async function scroll(options: {
  x?: number
  y?: number
  selector?: string
}): Promise<void> {
  if (options.selector) {
    await evaluate({
      script: `document.querySelector(${JSON.stringify(options.selector)})?.scrollIntoView({ behavior: 'smooth', block: 'center' })`,
    })
  } else {
    await evaluate({
      script: `window.scrollTo(${options.x ?? 0}, ${options.y ?? 0})`,
    })
  }
}

/**
 * Clear the value of an input element
 */
export async function clear(selector: string): Promise<void> {
  await evaluate({
    script: `
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `,
  })
}

/**
 * Focus on an element
 */
export async function focus(selector: string): Promise<void> {
  await evaluate({
    script: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
  })
}

/**
 * Open a URL in a new tab and automatically attach debugger
 * This creates a new browser tab, navigates to the URL, and connects it to the relay
 */
export async function openUrl(
  url: string,
  activate = true
): Promise<OpenUrlResult> {
  // 같은 프로세스에서 실행 중인 릴레이 서버가 있으면 직접 사용
  const relay = getRelayServer()
  if (relay) {
    if (!relay.extensionConnected()) {
      throw new Error('Chrome extension not connected')
    }
    return await relay.openUrl(url, activate)
  }

  // 별도 프로세스 (MCP 서버)에서 실행 중이면 HTTP API 사용
  const relayBaseUrl = `http://127.0.0.1:${BROWSER_RELAY_PORT}`

  const response = await fetch(`${relayBaseUrl}/open-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, activate }),
  })

  const result = await response.json() as OpenUrlResult | { error: string }

  if (!response.ok || 'error' in result) {
    throw new Error((result as { error: string }).error || `HTTP ${response.status}`)
  }

  return result as OpenUrlResult
}

/**
 * Close CDP connection
 */
export function disconnect(): void {
  if (cdpWs) {
    cdpWs.close()
    cdpWs = null
  }
}
