/**
 * Puppeteer 기반 브라우저 자동화 도구
 * 서버 환경(headless)에서 브라우저 제어 가능
 */
import type { Browser, Page } from 'puppeteer'

let browser: Browser | null = null
let page: Page | null = null
let initialized = false

export interface PuppeteerOptions {
  headless?: boolean
  args?: string[]
}

/**
 * Puppeteer 브라우저 초기화
 */
export async function initPuppeteer(options: PuppeteerOptions = {}): Promise<void> {
  if (initialized && browser) {
    return
  }

  // 동적 import (puppeteer가 설치되어 있지 않을 수 있음)
  const puppeteer = await import('puppeteer')

  browser = await puppeteer.default.launch({
    headless: options.headless ?? true,
    args: options.args ?? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })

  page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  initialized = true
  console.log('[Puppeteer] Browser initialized')
}

/**
 * Puppeteer 브라우저 종료
 */
export async function closePuppeteer(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
    page = null
    initialized = false
    console.log('[Puppeteer] Browser closed')
  }
}

/**
 * 브라우저 연결 상태 확인
 */
export function isConnected(): boolean {
  return initialized && browser !== null && page !== null
}

/**
 * 현재 페이지 가져오기 (필요시 초기화)
 */
async function getPage(): Promise<Page> {
  if (!page) {
    await initPuppeteer()
  }
  if (!page) {
    throw new Error('Puppeteer browser not initialized')
  }
  return page
}

/**
 * URL로 이동
 */
export async function navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' = 'load'): Promise<void> {
  const p = await getPage()
  await p.goto(url, { waitUntil })
  console.log(`[Puppeteer] Navigated to: ${url}`)
}

/**
 * 스크린샷 촬영
 */
export async function screenshot(options: {
  format?: 'png' | 'jpeg'
  quality?: number
  fullPage?: boolean
} = {}): Promise<{ data: string; format: string }> {
  const p = await getPage()

  const format = options.format ?? 'png'

  const result = await p.screenshot({
    encoding: 'base64',
    type: format,
    fullPage: options.fullPage ?? false,
    quality: format === 'jpeg' ? (options.quality ?? 80) : undefined,
  }) as string | Buffer

  // result가 Buffer일 수 있으므로 string으로 변환
  const data = typeof result === 'string' ? result : Buffer.from(result).toString('base64')
  return { data, format }
}

/**
 * 요소 클릭
 */
export async function click(options: {
  selector?: string
  x?: number
  y?: number
}): Promise<void> {
  const p = await getPage()

  if (options.selector) {
    await p.click(options.selector)
  } else if (options.x !== undefined && options.y !== undefined) {
    await p.mouse.click(options.x, options.y)
  } else {
    throw new Error('Either selector or x/y coordinates required')
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
  const p = await getPage()

  if (options.selector) {
    await p.type(options.selector, options.text, { delay: options.delay })
  } else {
    await p.keyboard.type(options.text, { delay: options.delay })
  }
}

/**
 * JavaScript 실행
 */
export async function evaluate<T>(script: string): Promise<T> {
  const p = await getPage()
  return await p.evaluate(script) as T
}

/**
 * 페이지 제목 가져오기
 */
export async function getTitle(): Promise<string> {
  const p = await getPage()
  return await p.title()
}

/**
 * 현재 URL 가져오기
 */
export async function getUrl(): Promise<string> {
  const p = await getPage()
  return p.url()
}

/**
 * 페이지 HTML 가져오기
 */
export async function getHtml(): Promise<string> {
  const p = await getPage()
  return await p.content()
}

/**
 * 요소의 텍스트 가져오기
 */
export async function getText(selector: string): Promise<string> {
  const p = await getPage()
  const element = await p.$(selector)
  if (!element) {
    throw new Error(`Element not found: ${selector}`)
  }
  return await p.evaluate(el => el.textContent || '', element)
}

/**
 * 요소 존재 여부 확인
 */
export async function exists(selector: string): Promise<boolean> {
  const p = await getPage()
  const element = await p.$(selector)
  return element !== null
}

/**
 * 요소가 나타날 때까지 대기
 */
export async function waitForSelector(selector: string, timeout: number = 30000): Promise<boolean> {
  const p = await getPage()
  try {
    await p.waitForSelector(selector, { timeout })
    return true
  } catch {
    return false
  }
}

/**
 * 스크롤
 */
export async function scroll(options: {
  x?: number
  y?: number
  selector?: string
}): Promise<void> {
  const p = await getPage()

  if (options.selector) {
    await p.evaluate((sel) => {
      const el = document.querySelector(sel)
      el?.scrollIntoView({ behavior: 'smooth' })
    }, options.selector)
  } else {
    await p.evaluate((x, y) => {
      window.scrollBy(x ?? 0, y ?? 0)
    }, options.x, options.y)
  }
}

/**
 * 입력 필드 지우기
 */
export async function clear(selector: string): Promise<void> {
  const p = await getPage()
  await p.click(selector, { clickCount: 3 })
  await p.keyboard.press('Backspace')
}

/**
 * 요소에 포커스
 */
export async function focus(selector: string): Promise<void> {
  const p = await getPage()
  await p.focus(selector)
}

/**
 * URL 열기 (새 탭/기존 탭)
 */
export async function openUrl(url: string, _activate: boolean = true): Promise<{
  tabId: number
  sessionId: string
  url: string
}> {
  await navigate(url)

  // Puppeteer에서는 탭 ID 개념이 다르므로 가상의 값 반환
  return {
    tabId: 1,
    sessionId: 'puppeteer-session',
    url,
  }
}

/**
 * 상태 정보 반환
 */
export function getStatus(): {
  connected: boolean
  extensionConnected: boolean
  targets: Array<{ targetId: string; sessionId: string; targetInfo: { title: string; url: string } }>
  activeTargetId: string | undefined
  relayRunning: boolean
  mode: 'puppeteer'
} {
  const currentUrl = page?.url() ?? ''
  const hasPage = page !== null

  return {
    connected: isConnected(),
    extensionConnected: false, // Puppeteer 모드에서는 항상 false
    targets: hasPage ? [{
      targetId: 'puppeteer-target',
      sessionId: 'puppeteer-session',
      targetInfo: {
        title: 'Puppeteer Page',
        url: currentUrl,
      },
    }] : [],
    activeTargetId: hasPage ? 'puppeteer-target' : undefined,
    relayRunning: false,
    mode: 'puppeteer',
  }
}
