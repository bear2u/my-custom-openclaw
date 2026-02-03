import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod'
import * as browserTool from '../browser/browser-tool.js'
import { getRelayServer } from '../browser/relay-server.js'

const BROWSER_RELAY_PORT = parseInt(process.env.BROWSER_RELAY_PORT || '18792', 10)
const SCREENSHOTS_DIR = join(process.cwd(), 'screenshots')

// MCP Server 인스턴스 생성
const server = new McpServer({
  name: 'slack-connector-browser',
  version: '1.0.0',
})

// 브라우저 상태 확인 도구
server.registerTool(
  'browser_status',
  {
    title: 'Browser Status',
    description: 'Check browser connection status. Returns whether the browser relay is running and Chrome extension is connected.',
    inputSchema: {},
  },
  async () => {
    try {
      const relay = getRelayServer()
      if (!relay) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                relayRunning: false,
                extensionConnected: false,
                targets: [],
                message: 'Browser relay server is not running',
              }),
            },
          ],
        }
      }

      const status = relay.getStatus()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              relayRunning: true,
              extensionConnected: status.extensionConnected,
              targets: status.targets.map((t) => ({
                sessionId: t.sessionId,
                title: t.targetInfo.title,
                url: t.targetInfo.url,
              })),
              activeTargetId: status.activeTargetId,
            }),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking browser status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// URL 열기 및 자동 연결 도구
server.registerTool(
  'browser_open_url',
  {
    title: 'Open URL',
    description: 'Open a URL in a new browser tab and automatically connect to it. Use this to navigate to a website and enable browser automation.',
    inputSchema: {
      url: z.string().url().describe('URL to open (must be http or https)'),
      activate: z.boolean().optional().describe('Whether to activate (focus) the new tab (default: true)'),
    },
  },
  async ({ url, activate = true }) => {
    console.error('[MCP] browser_open_url called with:', { url, activate })
    try {
      const result = await browserTool.openUrl(url, activate)
      console.error('[MCP] browser_open_url success:', result)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Opened and connected to: ${url}`,
              tabId: result.tabId,
              sessionId: result.sessionId,
              targetId: result.targetId,
            }, null, 2),
          },
        ],
      }
    } catch (error) {
      console.error('[MCP] browser_open_url error:', error)
      return {
        content: [
          {
            type: 'text',
            text: `Error opening URL: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 스크린샷 도구
server.registerTool(
  'browser_screenshot',
  {
    title: 'Browser Screenshot',
    description: 'Take a screenshot of the current browser tab. Saves to file and returns the file path along with the image.',
    inputSchema: {
      format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
      quality: z.number().min(0).max(100).optional().describe('JPEG quality (0-100)'),
      fullPage: z.boolean().optional().describe('Capture full page including scrollable area'),
      saveToFile: z.boolean().optional().describe('Save screenshot to file (default: true)'),
    },
  },
  async ({ format, quality, fullPage, saveToFile = true }) => {
    try {
      const result = await browserTool.screenshot({ format, quality, fullPage })

      let filePath: string | undefined
      if (saveToFile) {
        // screenshots 디렉토리 생성
        if (!existsSync(SCREENSHOTS_DIR)) {
          mkdirSync(SCREENSHOTS_DIR, { recursive: true })
        }

        // 파일명 생성 (타임스탬프 기반)
        const timestamp = Date.now()
        const ext = result.format === 'jpeg' ? 'jpg' : 'png'
        const filename = `screenshot-${timestamp}.${ext}`
        filePath = join(SCREENSHOTS_DIR, filename)

        // base64 디코딩 후 파일 저장
        const imageBuffer = Buffer.from(result.data, 'base64')
        writeFileSync(filePath, imageBuffer)
      }

      return {
        content: [
          {
            type: 'image' as const,
            data: result.data,
            mimeType: result.format === 'jpeg' ? 'image/jpeg' : 'image/png',
          },
          {
            type: 'text',
            text: filePath
              ? `Screenshot saved: ${filePath}`
              : 'Screenshot captured (not saved to file)',
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error taking screenshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 클릭 도구
server.registerTool(
  'browser_click',
  {
    title: 'Browser Click',
    description: 'Click on an element by CSS selector or coordinates.',
    inputSchema: {
      selector: z.string().optional().describe('CSS selector of element to click'),
      x: z.number().optional().describe('X coordinate to click'),
      y: z.number().optional().describe('Y coordinate to click'),
    },
  },
  async ({ selector, x, y }) => {
    try {
      await browserTool.click({ selector, x, y })
      return {
        content: [
          {
            type: 'text',
            text: `Clicked ${selector ? `on ${selector}` : `at (${x}, ${y})`}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error clicking: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 텍스트 입력 도구
server.registerTool(
  'browser_type',
  {
    title: 'Browser Type',
    description: 'Type text into the currently focused element.',
    inputSchema: {
      text: z.string().describe('Text to type'),
      delay: z.number().optional().describe('Delay between keystrokes in ms'),
    },
  },
  async ({ text, delay }) => {
    try {
      await browserTool.type({ text, delay })
      return {
        content: [
          {
            type: 'text',
            text: `Typed: ${text}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error typing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 네비게이션 도구
server.registerTool(
  'browser_navigate',
  {
    title: 'Browser Navigate',
    description: 'Navigate to a URL in the browser.',
    inputSchema: {
      url: z.string().url().describe('URL to navigate to'),
      waitUntil: z
        .enum(['load', 'domcontentloaded', 'networkidle'])
        .optional()
        .describe('Wait until this event'),
    },
  },
  async ({ url, waitUntil }) => {
    try {
      await browserTool.navigate({ url, waitUntil })
      return {
        content: [
          {
            type: 'text',
            text: `Navigated to: ${url}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error navigating: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// JavaScript 실행 도구
server.registerTool(
  'browser_evaluate',
  {
    title: 'Browser Evaluate',
    description: 'Execute JavaScript code in the browser page context.',
    inputSchema: {
      script: z.string().describe('JavaScript code to execute'),
    },
  },
  async ({ script }) => {
    try {
      const result = await browserTool.evaluate({ script, returnByValue: true })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error evaluating script: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 페이지 제목 가져오기
server.registerTool(
  'browser_get_title',
  {
    title: 'Get Page Title',
    description: 'Get the title of the current page.',
    inputSchema: {},
  },
  async () => {
    try {
      const title = await browserTool.getTitle()
      return {
        content: [
          {
            type: 'text',
            text: title,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting title: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 현재 URL 가져오기
server.registerTool(
  'browser_get_url',
  {
    title: 'Get Current URL',
    description: 'Get the current URL of the browser.',
    inputSchema: {},
  },
  async () => {
    try {
      const url = await browserTool.getUrl()
      return {
        content: [
          {
            type: 'text',
            text: url,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting URL: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 페이지 HTML 가져오기
server.registerTool(
  'browser_get_html',
  {
    title: 'Get Page HTML',
    description: 'Get the HTML content of the current page.',
    inputSchema: {},
  },
  async () => {
    try {
      const html = await browserTool.getHtml()
      return {
        content: [
          {
            type: 'text',
            text: html,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting HTML: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 요소 텍스트 가져오기
server.registerTool(
  'browser_get_text',
  {
    title: 'Get Element Text',
    description: 'Get the text content of an element.',
    inputSchema: {
      selector: z.string().describe('CSS selector of the element'),
    },
  },
  async ({ selector }) => {
    try {
      const text = await browserTool.getText(selector)
      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting text: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 요소 존재 확인
server.registerTool(
  'browser_exists',
  {
    title: 'Check Element Exists',
    description: 'Check if an element exists on the page.',
    inputSchema: {
      selector: z.string().describe('CSS selector of the element'),
    },
  },
  async ({ selector }) => {
    try {
      const exists = await browserTool.exists(selector)
      return {
        content: [
          {
            type: 'text',
            text: exists ? 'Element exists' : 'Element not found',
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking element: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 요소 대기
server.registerTool(
  'browser_wait_for_selector',
  {
    title: 'Wait For Element',
    description: 'Wait for an element to appear on the page.',
    inputSchema: {
      selector: z.string().describe('CSS selector to wait for'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)'),
    },
  },
  async ({ selector, timeout }) => {
    try {
      const found = await browserTool.waitForSelector(selector, timeout)
      return {
        content: [
          {
            type: 'text',
            text: found ? 'Element found' : 'Element not found (timeout)',
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error waiting for element: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 스크롤 도구
server.registerTool(
  'browser_scroll',
  {
    title: 'Browser Scroll',
    description: 'Scroll the page to coordinates or to an element.',
    inputSchema: {
      x: z.number().optional().describe('X coordinate to scroll to'),
      y: z.number().optional().describe('Y coordinate to scroll to'),
      selector: z.string().optional().describe('CSS selector of element to scroll into view'),
    },
  },
  async ({ x, y, selector }) => {
    try {
      await browserTool.scroll({ x, y, selector })
      return {
        content: [
          {
            type: 'text',
            text: selector ? `Scrolled to ${selector}` : `Scrolled to (${x ?? 0}, ${y ?? 0})`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error scrolling: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 입력 필드 초기화
server.registerTool(
  'browser_clear',
  {
    title: 'Clear Input',
    description: 'Clear the value of an input field.',
    inputSchema: {
      selector: z.string().describe('CSS selector of the input element'),
    },
  },
  async ({ selector }) => {
    try {
      await browserTool.clear(selector)
      return {
        content: [
          {
            type: 'text',
            text: `Cleared: ${selector}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error clearing input: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// 요소 포커스
server.registerTool(
  'browser_focus',
  {
    title: 'Focus Element',
    description: 'Focus on an element.',
    inputSchema: {
      selector: z.string().describe('CSS selector of the element to focus'),
    },
  },
  async ({ selector }) => {
    try {
      await browserTool.focus(selector)
      return {
        content: [
          {
            type: 'text',
            text: `Focused: ${selector}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error focusing element: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }
)

// MCP 서버 시작
async function main() {
  // 참고: 릴레이 서버는 pnpm dev (메인 서버)에서 이미 실행 중
  // MCP 서버는 브라우저 도구만 제공하고, 릴레이 서버는 별도로 실행되어야 함
  console.error(`[MCP] Browser MCP server starting (relay should be running on port ${BROWSER_RELAY_PORT})`)

  // stdio transport로 MCP 서버 연결
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Browser automation MCP server started')
}

main().catch((error) => {
  console.error('[MCP] Failed to start:', error)
  process.exit(1)
})
