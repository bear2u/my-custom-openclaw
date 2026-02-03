/**
 * 통합 브라우저 인터페이스
 * Relay 모드와 Puppeteer 모드를 동일한 API로 제공
 */
import type { BrowserMode } from '../config.js'
import * as puppeteerTool from './puppeteer-tool.js'
import * as relayBrowserTool from './browser-tool.js'
import { startRelayServer, stopRelayServer, getRelayServer } from './relay-server.js'

let currentMode: BrowserMode = 'off'
let initialized = false

export interface BrowserStatus {
  connected: boolean
  extensionConnected: boolean
  targets: Array<{
    targetId: string
    sessionId: string
    targetInfo: { title: string; url: string }
  }>
  activeTargetId: string | undefined
  relayRunning: boolean
  mode: BrowserMode
}

export interface ScreenshotResult {
  data: string
  format: string
}

export interface OpenUrlResult {
  tabId: number
  sessionId: string
  url: string
}

/**
 * 브라우저 초기화
 */
export async function initBrowser(mode: BrowserMode, options?: { port?: number }): Promise<void> {
  if (mode === 'off') {
    console.log('[Browser] Browser automation disabled')
    return
  }

  currentMode = mode

  if (mode === 'puppeteer') {
    await puppeteerTool.initPuppeteer()
    initialized = true
    console.log('[Browser] Puppeteer mode initialized')
  } else if (mode === 'relay') {
    await startRelayServer({ port: options?.port })
    initialized = true
    console.log('[Browser] Relay mode initialized')
  }
}

/**
 * 브라우저 종료
 */
export async function closeBrowser(): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.closePuppeteer()
  } else if (currentMode === 'relay') {
    await stopRelayServer()
  }
  initialized = false
  currentMode = 'off'
}

/**
 * 브라우저 연결 여부
 */
export function isConnected(): boolean {
  if (currentMode === 'puppeteer') {
    return puppeteerTool.isConnected()
  } else if (currentMode === 'relay') {
    const relay = getRelayServer()
    return relay?.extensionConnected() ?? false
  }
  return false
}

/**
 * 브라우저 상태
 */
export function getStatus(): BrowserStatus {
  if (currentMode === 'puppeteer') {
    return puppeteerTool.getStatus()
  } else if (currentMode === 'relay') {
    const relay = getRelayServer()
    if (relay) {
      const status = relay.getStatus()
      return {
        connected: status.connected,
        extensionConnected: status.extensionConnected,
        targets: status.targets.map(t => ({
          targetId: t.targetId,
          sessionId: t.sessionId,
          targetInfo: {
            title: t.targetInfo.title ?? '',
            url: t.targetInfo.url ?? '',
          },
        })),
        activeTargetId: status.activeTargetId,
        relayRunning: true,
        mode: 'relay',
      }
    }
  }

  return {
    connected: false,
    extensionConnected: false,
    targets: [],
    activeTargetId: undefined,
    relayRunning: false,
    mode: currentMode,
  }
}

/**
 * 스크린샷
 */
export async function screenshot(options: {
  format?: 'png' | 'jpeg'
  quality?: number
  fullPage?: boolean
  sessionId?: string
} = {}): Promise<ScreenshotResult> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.screenshot(options)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.screenshot(options)
  }
  throw new Error('Browser not initialized')
}

/**
 * URL로 이동
 */
export async function navigate(options: {
  url: string
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
}): Promise<void> {
  if (currentMode === 'puppeteer') {
    const waitUntil = options.waitUntil === 'networkidle' ? 'networkidle0' : (options.waitUntil ?? 'load')
    await puppeteerTool.navigate(options.url, waitUntil)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.navigate(options)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * 클릭
 */
export async function click(options: {
  selector?: string
  x?: number
  y?: number
}): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.click(options)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.click(options)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * 텍스트 입력
 */
export async function type(options: {
  text: string
  selector?: string
  delay?: number
}): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.type(options)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.type(options)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * JavaScript 실행
 */
export async function evaluate(options: {
  script: string
  returnByValue?: boolean
}): Promise<unknown> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.evaluate(options.script)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.evaluate(options)
  }
  throw new Error('Browser not initialized')
}

/**
 * 페이지 제목
 */
export async function getTitle(): Promise<string> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.getTitle()
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.getTitle()
  }
  throw new Error('Browser not initialized')
}

/**
 * 현재 URL
 */
export async function getUrl(): Promise<string> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.getUrl()
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.getUrl()
  }
  throw new Error('Browser not initialized')
}

/**
 * 페이지 HTML
 */
export async function getHtml(): Promise<string> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.getHtml()
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.getHtml()
  }
  throw new Error('Browser not initialized')
}

/**
 * 요소 텍스트
 */
export async function getText(selector: string): Promise<string> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.getText(selector)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.getText(selector)
  }
  throw new Error('Browser not initialized')
}

/**
 * 요소 존재 여부
 */
export async function exists(selector: string): Promise<boolean> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.exists(selector)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.exists(selector)
  }
  throw new Error('Browser not initialized')
}

/**
 * 요소 대기
 */
export async function waitForSelector(selector: string, timeout?: number): Promise<boolean> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.waitForSelector(selector, timeout)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.waitForSelector(selector, timeout)
  }
  throw new Error('Browser not initialized')
}

/**
 * 스크롤
 */
export async function scroll(options: {
  x?: number
  y?: number
  selector?: string
}): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.scroll(options)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.scroll(options)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * 입력 필드 지우기
 */
export async function clear(selector: string): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.clear(selector)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.clear(selector)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * 포커스
 */
export async function focus(selector: string): Promise<void> {
  if (currentMode === 'puppeteer') {
    await puppeteerTool.focus(selector)
  } else if (currentMode === 'relay') {
    await relayBrowserTool.focus(selector)
  } else {
    throw new Error('Browser not initialized')
  }
}

/**
 * URL 열기
 */
export async function openUrl(url: string, activate: boolean = true): Promise<OpenUrlResult> {
  if (currentMode === 'puppeteer') {
    return await puppeteerTool.openUrl(url, activate)
  } else if (currentMode === 'relay') {
    return await relayBrowserTool.openUrl(url, activate)
  }
  throw new Error('Browser not initialized')
}

/**
 * 현재 모드 반환
 */
export function getCurrentMode(): BrowserMode {
  return currentMode
}

/**
 * 초기화 여부
 */
export function isInitialized(): boolean {
  return initialized
}
