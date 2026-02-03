import 'dotenv/config'
import { loadConfig } from './config.js'
import { createGatewayServer } from './websocket/server.js'
import { SessionManager } from './session/manager.js'
import { createSlackApp } from './slack/client.js'
import { setupSlackHandlers } from './slack/handler.js'
import { initBrowser, closeBrowser } from './browser/unified-browser.js'

const config = loadConfig()
const sessions = new SessionManager()

const WS_PORT = parseInt(process.env.WS_PORT || '4900', 10)
const ENABLE_SLACK = process.env.ENABLE_SLACK === 'true'

const gateway = createGatewayServer(WS_PORT, config, sessions)

async function startSlack(): Promise<boolean> {
  if (!config.slackBotToken || !config.slackAppToken) {
    console.error('[Slack] SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required')
    return false
  }

  const slackApp = createSlackApp(config)
  setupSlackHandlers(slackApp, config)

  await slackApp.start()
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

  // 브라우저 초기화 (모드에 따라)
  if (config.browserMode !== 'off') {
    try {
      await initBrowser(config.browserMode, { port: config.browserRelayPort })
      console.log(`[Browser] ${config.browserMode} mode started`)
    } catch (err) {
      console.error(`[Browser] Failed to start ${config.browserMode} mode:`, err)
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
  gateway.stop()
  await closeBrowser()
  process.exit(0)
})

main().catch(console.error)
