import 'dotenv/config'
import { loadConfig, type BrowserMode } from './config.js'
import { createGatewayServer } from './websocket/server.js'
import { SessionManager } from './session/manager.js'
import { createSlackApp } from './slack/client.js'
import { setupSlackHandlers } from './slack/handler.js'
import { initBrowser, closeBrowser } from './browser/unified-browser.js'
import { chatDb } from './db/database.js'
import { CronService, type CronServiceDeps } from './cron/index.js'
import { runClaudeStreaming } from './claude/runner.js'

const config = loadConfig()
const sessions = new SessionManager()

const WS_PORT = parseInt(process.env.WS_PORT || '4900', 10)
const ENABLE_SLACK = process.env.ENABLE_SLACK === 'true'

// CronService 초기화 (Slack 클라이언트는 나중에 설정)
type SlackPostMessageFn = (channel: string, text: string) => Promise<void>
let slackPostMessage: SlackPostMessageFn | null = null

export function setSlackPostMessage(fn: SlackPostMessageFn): void {
  slackPostMessage = fn
}

const cronDeps: CronServiceDeps = {
  projectPath: config.projectPath,
  sendToSlack: async (channelId: string, text: string) => {
    const fn = slackPostMessage
    if (!fn) {
      console.error('[Cron] Slack client not available')
      return
    }
    await fn(channelId, text)
  },
  runClaude: async (options) => {
    const result = await runClaudeStreaming({
      message: options.message,
      model: options.model || config.claudeModel,
      timeoutMs: 600000,
      cwd: options.cwd,
    })
    return result ? { text: result.text, sessionId: result.sessionId } : null
  },
}

const cronService = new CronService(cronDeps)

export { cronService }

const gateway = createGatewayServer(WS_PORT, config, sessions, cronService)

async function startSlack(): Promise<boolean> {
  if (!config.slackBotToken || !config.slackAppToken) {
    console.error('[Slack] SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required')
    return false
  }

  const slackApp = createSlackApp(config)

  // Slack 클라이언트를 CronService에 연결
  setSlackPostMessage(async (channel: string, text: string) => {
    await slackApp.client.chat.postMessage({ channel, text })
  })

  // 핸들러 설정 (cronService 전달)
  setupSlackHandlers(slackApp, config, cronService)

  await slackApp.start()

  // CronService 시작
  await cronService.start()
  console.log('[Cron] Service started')

  console.log('[Slack] Socket Mode connected')
  return true
}

function maskToken(token: string | undefined): string {
  if (!token || token.length < 10) return token ? '****' : '(미설정)'
  return token.substring(0, 8) + '...' + token.substring(token.length - 4)
}

async function main() {
  console.log('')
  console.log('─'.repeat(50))
  console.log('[Config] Project path:', config.projectPath)
  console.log('[Config] Claude path:', config.claudePath)
  console.log('[Config] Browser mode:', config.browserMode)
  console.log('─'.repeat(50))
  console.log('[Slack] ENABLE_SLACK:', ENABLE_SLACK ? '활성화' : '비활성화')
  console.log('[Slack] Bot Token:', maskToken(config.slackBotToken))
  console.log('[Slack] App Token:', maskToken(config.slackAppToken))
  console.log('─'.repeat(50))
  console.log('')

  // WebSocket Gateway 시작
  gateway.start()
  console.log(`Claude Gateway is running on ws://localhost:${WS_PORT}`)

  // 브라우저 초기화 (DB 저장된 설정 우선, 그다음 환경변수)
  const savedBrowserMode = chatDb.getSetting('browser_mode') as BrowserMode | undefined
  const effectiveBrowserMode = savedBrowserMode || config.browserMode

  if (effectiveBrowserMode !== 'off') {
    try {
      await initBrowser(effectiveBrowserMode, { port: config.browserRelayPort })
      console.log(`[Browser] ${effectiveBrowserMode} mode started${savedBrowserMode ? ' (from saved settings)' : ''}`)
    } catch (err) {
      console.error(`[Browser] Failed to start ${effectiveBrowserMode} mode:`, err)
    }
  } else {
    console.log('[Browser] Disabled (set BROWSER_MODE=puppeteer or BROWSER_MODE=relay to enable)')
  }

  // Slack 앱 시작
  if (ENABLE_SLACK) {
    const started = await startSlack()
    if (!started) {
      console.log('[Slack] Skipping Slack integration (no valid config)')
    }
  } else {
    console.log('[Slack] Slack integration disabled (set ENABLE_SLACK=true to enable)')
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  cronService.stop()
  gateway.stop()
  await closeBrowser()
  process.exit(0)
})

main().catch(console.error)
