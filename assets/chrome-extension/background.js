const DEFAULT_PORT = 18792

const BADGE = {
  on: { text: 'ON', color: '#FF5A36' },
  off: { text: '', color: '#000000' },
  connecting: { text: '…', color: '#F59E0B' },
  error: { text: '!', color: '#B91C1C' },
}

/** @type {WebSocket|null} */
let relayWs = null
/** @type {Promise<void>|null} */
let relayConnectPromise = null

let debuggerListenersInstalled = false

let nextSession = 1

/** @type {Map<number, {state:'connecting'|'connected', sessionId?:string, targetId?:string, attachOrder?:number}>} */
const tabs = new Map()
/** @type {Map<string, number>} */
const tabBySession = new Map()
/** @type {Map<string, number>} */
const childSessionToTab = new Map()

/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void}>} */
const pending = new Map()

/** @type {Set<number>} openAndAttach로 생성 중인 탭 ID (자동 연결 방지용) */
const pendingOpenTabs = new Set()

function nowStack() {
  try {
    return new Error().stack || ''
  } catch {
    return ''
  }
}

async function getRelayPort() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const raw = stored.relayPort
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function setBadge(tabId, kind) {
  const cfg = BADGE[kind]
  void chrome.action.setBadgeText({ tabId, text: cfg.text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.color })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
}

async function ensureRelayConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return
  if (relayConnectPromise) return await relayConnectPromise

  relayConnectPromise = (async () => {
    const port = await getRelayPort()
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = `ws://127.0.0.1:${port}/extension`

    // Fast preflight: is the relay server up?
    try {
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
    }

    const ws = new WebSocket(wsUrl)
    relayWs = ws

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('WebSocket connect failed'))
      }
      ws.onclose = (ev) => {
        clearTimeout(t)
        reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`))
      }
    })

    ws.onmessage = (event) => void onRelayMessage(String(event.data || ''))
    ws.onclose = () => onRelayClosed('closed')
    ws.onerror = () => onRelayClosed('error')

    if (!debuggerListenersInstalled) {
      debuggerListenersInstalled = true
      chrome.debugger.onEvent.addListener(onDebuggerEvent)
      chrome.debugger.onDetach.addListener(onDebuggerDetach)
    }
  })()

  try {
    await relayConnectPromise
  } finally {
    relayConnectPromise = null
  }
}

function onRelayClosed(reason) {
  relayWs = null
  for (const [id, p] of pending.entries()) {
    pending.delete(id)
    p.reject(new Error(`Relay disconnected (${reason})`))
  }

  for (const tabId of tabs.keys()) {
    void chrome.debugger.detach({ tabId }).catch(() => {})
    setBadge(tabId, 'connecting')
    void chrome.action.setTitle({
      tabId,
      title: 'OpenClaw Browser Relay: disconnected (click to re-attach)',
    })
  }
  tabs.clear()
  tabBySession.clear()
  childSessionToTab.clear()
}

function sendToRelay(payload) {
  const ws = relayWs
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  ws.send(JSON.stringify(payload))
}

async function maybeOpenHelpOnce() {
  try {
    const stored = await chrome.storage.local.get(['helpOnErrorShown'])
    if (stored.helpOnErrorShown === true) return
    await chrome.storage.local.set({ helpOnErrorShown: true })
    await chrome.runtime.openOptionsPage()
  } catch {
    // ignore
  }
}

function requestFromRelay(command) {
  const id = command.id
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      sendToRelay(command)
    } catch (err) {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

async function onRelayMessage(text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  if (msg && msg.method === 'ping') {
    try {
      sendToRelay({ method: 'pong' })
    } catch {
      // ignore
    }
    return
  }

  if (msg && typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(String(msg.error)))
    else p.resolve(msg.result)
    return
  }

  if (msg && typeof msg.id === 'number' && msg.method === 'forwardCDPCommand') {
    try {
      const result = await handleForwardCdpCommand(msg)
      sendToRelay({ id: msg.id, result })
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  // 릴레이에서 URL을 열고 자동 연결하는 명령
  if (msg && typeof msg.id === 'number' && msg.method === 'openAndAttach') {
    try {
      const result = await handleOpenAndAttach(msg)
      sendToRelay({ id: msg.id, result })
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
    return
  }
}

function getTabBySessionId(sessionId) {
  const direct = tabBySession.get(sessionId)
  if (direct) return { tabId: direct, kind: 'main' }
  const child = childSessionToTab.get(sessionId)
  if (child) return { tabId: child, kind: 'child' }
  return null
}

function getTabByTargetId(targetId) {
  for (const [tabId, tab] of tabs.entries()) {
    if (tab.targetId === targetId) return tabId
  }
  return null
}

async function attachTab(tabId, opts = {}) {
  const debuggee = { tabId }
  await chrome.debugger.attach(debuggee, '1.3')
  await chrome.debugger.sendCommand(debuggee, 'Page.enable').catch(() => {})

  const info = /** @type {any} */ (await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo'))
  const targetInfo = info?.targetInfo
  const targetId = String(targetInfo?.targetId || '').trim()
  if (!targetId) {
    throw new Error('Target.getTargetInfo returned no targetId')
  }

  const sessionId = `cb-tab-${nextSession++}`
  const attachOrder = nextSession

  tabs.set(tabId, { state: 'connected', sessionId, targetId, attachOrder })
  tabBySession.set(sessionId, tabId)
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay: attached (click to detach)',
  })

  if (!opts.skipAttachedEvent) {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    })
  }

  setBadge(tabId, 'on')
  return { sessionId, targetId }
}

async function detachTab(tabId, reason) {
  const tab = tabs.get(tabId)
  if (tab?.sessionId && tab?.targetId) {
    try {
      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tab.sessionId, targetId: tab.targetId, reason },
        },
      })
    } catch {
      // ignore
    }
  }

  if (tab?.sessionId) tabBySession.delete(tab.sessionId)
  tabs.delete(tabId)

  for (const [childSessionId, parentTabId] of childSessionToTab.entries()) {
    if (parentTabId === tabId) childSessionToTab.delete(childSessionId)
  }

  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // ignore
  }

  setBadge(tabId, 'off')
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay (click to attach/detach)',
  })
}

async function connectOrToggleForActiveTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) return

  const existing = tabs.get(tabId)
  if (existing?.state === 'connected') {
    await detachTab(tabId, 'toggle')
    return
  }

  tabs.set(tabId, { state: 'connecting' })
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay: connecting to local relay…',
  })

  try {
    await ensureRelayConnection()
    await attachTab(tabId)
  } catch (err) {
    tabs.delete(tabId)
    setBadge(tabId, 'error')
    void chrome.action.setTitle({
      tabId,
      title: 'OpenClaw Browser Relay: relay not running (open options for setup)',
    })
    void maybeOpenHelpOnce()
    // Extra breadcrumbs in chrome://extensions service worker logs.
    const message = err instanceof Error ? err.message : String(err)
    console.warn('attach failed', message, nowStack())
  }
}

async function handleForwardCdpCommand(msg) {
  const method = String(msg?.params?.method || '').trim()
  const params = msg?.params?.params || undefined
  const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : undefined

  // Map command to tab
  const bySession = sessionId ? getTabBySessionId(sessionId) : null
  const targetId = typeof params?.targetId === 'string' ? params.targetId : undefined
  const tabId =
    bySession?.tabId ||
    (targetId ? getTabByTargetId(targetId) : null) ||
    (() => {
      // No sessionId: pick the first connected tab (stable-ish).
      for (const [id, tab] of tabs.entries()) {
        if (tab.state === 'connected') return id
      }
      return null
    })()

  if (!tabId) throw new Error(`No attached tab for method ${method}`)

  /** @type {chrome.debugger.DebuggerSession} */
  const debuggee = { tabId }

  if (method === 'Runtime.enable') {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
      await new Promise((r) => setTimeout(r, 50))
    } catch {
      // ignore
    }
    return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', params)
  }

  if (method === 'Target.createTarget') {
    const url = typeof params?.url === 'string' ? params.url : 'about:blank'
    const tab = await chrome.tabs.create({ url, active: false })
    if (!tab.id) throw new Error('Failed to create tab')
    await new Promise((r) => setTimeout(r, 100))
    const attached = await attachTab(tab.id)
    return { targetId: attached.targetId }
  }

  if (method === 'Target.closeTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toClose = target ? getTabByTargetId(target) : tabId
    if (!toClose) return { success: false }
    try {
      await chrome.tabs.remove(toClose)
    } catch {
      return { success: false }
    }
    return { success: true }
  }

  if (method === 'Target.activateTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toActivate = target ? getTabByTargetId(target) : tabId
    if (!toActivate) return {}
    const tab = await chrome.tabs.get(toActivate).catch(() => null)
    if (!tab) return {}
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(toActivate, { active: true }).catch(() => {})
    return {}
  }

  const tabState = tabs.get(tabId)
  const mainSessionId = tabState?.sessionId
  const debuggerSession =
    sessionId && mainSessionId && sessionId !== mainSessionId
      ? { ...debuggee, sessionId }
      : debuggee

  return await chrome.debugger.sendCommand(debuggerSession, method, params)
}

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId
  if (!tabId) return
  const tab = tabs.get(tabId)
  if (!tab?.sessionId) return

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    childSessionToTab.set(String(params.sessionId), tabId)
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    childSessionToTab.delete(String(params.sessionId))
  }

  try {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    })
  } catch {
    // ignore
  }
}

function onDebuggerDetach(source, reason) {
  const tabId = source.tabId
  if (!tabId) return
  if (!tabs.has(tabId)) return
  void detachTab(tabId, reason)
}

/**
 * 릴레이에서 받은 openAndAttach 명령 처리
 * 새 탭을 열고 URL로 이동 후 자동으로 디버거 연결
 */
async function handleOpenAndAttach(msg) {
  console.log('[extension] handleOpenAndAttach called:', msg)
  const url = typeof msg?.params?.url === 'string' ? msg.params.url : null
  const activate = msg?.params?.activate !== false // 기본값 true

  if (!url) {
    throw new Error('url parameter is required')
  }

  // URL 유효성 검사 (보안)
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are allowed')
    }
  } catch (e) {
    throw new Error(`Invalid URL: ${e.message}`)
  }

  // 새 탭 생성
  console.log('[extension] Creating tab for URL:', url)
  const tab = await chrome.tabs.create({ url, active: activate })
  if (!tab.id) {
    throw new Error('Failed to create tab')
  }
  console.log('[extension] Tab created:', tab.id)

  // 자동 연결 방지를 위해 등록
  pendingOpenTabs.add(tab.id)

  try {
    // 페이지 로드 대기
    console.log('[extension] Waiting for tab to load...')
    await waitForTabLoad(tab.id)
    console.log('[extension] Tab loaded')

    // 디버거 연결
    console.log('[extension] Attaching debugger...')
    const attached = await attachTab(tab.id)
    console.log('[extension] Debugger attached:', attached)

    return {
      tabId: tab.id,
      sessionId: attached.sessionId,
      targetId: attached.targetId,
      url: url,
    }
  } finally {
    // 완료 후 목록에서 제거
    pendingOpenTabs.delete(tab.id)
  }
}

/**
 * 탭이 완전히 로드될 때까지 대기
 */
function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const checkTab = async () => {
      try {
        const tab = await chrome.tabs.get(tabId)
        if (tab.status === 'complete') {
          resolve()
          return
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Tab load timeout'))
          return
        }

        setTimeout(checkTab, 100)
      } catch (err) {
        reject(new Error(`Tab not found: ${err.message}`))
      }
    }

    checkTab()
  })
}

chrome.action.onClicked.addListener(() => void connectOrToggleForActiveTab())

chrome.runtime.onInstalled.addListener(() => {
  // Useful: first-time instructions.
  void chrome.runtime.openOptionsPage()
})

// 메시지 핸들러 (options.js에서 호출)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'attachAllTabs') {
    attachAllTabs().then(sendResponse)
    return true // async response
  }
  if (message.action === 'detachAllTabs') {
    detachAllTabs().then(sendResponse)
    return true
  }
})

// 모든 탭에 디버거 연결
async function attachAllTabs() {
  try {
    // 먼저 릴레이 연결 확인
    await ensureRelayConnection()

    const allTabs = await chrome.tabs.query({})
    let attachedCount = 0

    for (const tab of allTabs) {
      if (!tab.id) continue
      // http/https URL만 처리
      if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
        continue
      }
      // 이미 연결된 탭은 스킵
      if (tabs.has(tab.id)) {
        attachedCount++
        continue
      }

      try {
        await attachTab(tab.id)
        attachedCount++
        console.log('[extension] Attached to tab:', tab.id, tab.url)
      } catch (err) {
        console.log('[extension] Failed to attach to tab:', tab.id, err.message)
      }
    }

    return { success: true, count: attachedCount }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 모든 탭에서 디버거 분리
async function detachAllTabs() {
  try {
    const tabIds = Array.from(tabs.keys())
    let detachedCount = 0

    for (const tabId of tabIds) {
      try {
        await detachTab(tabId, 'user-requested')
        detachedCount++
      } catch (err) {
        console.log('[extension] Failed to detach from tab:', tabId, err.message)
      }
    }

    return { success: true, count: detachedCount }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 확장 프로그램 시작 시 자동으로 릴레이 서버에 연결 시도
async function autoConnectToRelay() {
  console.log('[extension] Attempting auto-connect to relay...')
  try {
    await ensureRelayConnection()
    console.log('[extension] Auto-connected to relay server')
  } catch (err) {
    // 릴레이 서버가 실행 중이 아니면 무시
    console.log('[extension] Auto-connect failed (relay not running):', err.message)
  }
}

// Chrome Alarms API를 사용한 주기적 재연결 (서비스 워커가 비활성화되어도 동작)
const ALARM_NAME = 'relay-reconnect'

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    if (!relayWs || relayWs.readyState !== WebSocket.OPEN) {
      void autoConnectToRelay()
    }
  }
})

// 알람 설정 (10초마다 체크)
chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.167 }) // 약 10초

// 서비스 워커 시작 시 즉시 연결 시도
void autoConnectToRelay()

// 탭 활성화 시 자동으로 디버거 연결
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId

  // openAndAttach로 생성 중인 탭이면 스킵 (충돌 방지)
  if (pendingOpenTabs.has(tabId)) {
    return
  }

  // 릴레이 연결 확인
  if (!relayWs || relayWs.readyState !== WebSocket.OPEN) {
    await autoConnectToRelay()
  }

  // 릴레이가 연결되어 있으면 현재 탭에 디버거 자동 연결
  if (relayWs && relayWs.readyState === WebSocket.OPEN) {
    try {
      const tab = await chrome.tabs.get(tabId)
      // http/https URL만 처리
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        // 이미 연결된 탭인지 확인
        if (!tabs.has(tabId)) {
          console.log('[extension] Auto-attaching to active tab:', tabId, tab.url)
          await attachTab(tabId)
        }
      }
    } catch (err) {
      console.log('[extension] Auto-attach failed:', err.message)
    }
  }
})

// 탭 업데이트 시 자동으로 디버거 연결
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // openAndAttach로 생성 중인 탭이면 스킵 (충돌 방지)
    if (pendingOpenTabs.has(tabId)) {
      return
    }

    // 릴레이 연결 확인
    if (!relayWs || relayWs.readyState !== WebSocket.OPEN) {
      await autoConnectToRelay()
    }

    // 릴레이가 연결되어 있고 http/https URL이면 자동 연결
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        if (!tabs.has(tabId)) {
          console.log('[extension] Auto-attaching to updated tab:', tabId, tab.url)
          try {
            await attachTab(tabId)
          } catch (err) {
            console.log('[extension] Auto-attach failed:', err.message)
          }
        }
      }
    }
  }
})
