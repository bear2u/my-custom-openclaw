import 'dotenv/config'
import { loadConfig } from './config.js'
import { createGatewayServer } from './websocket/server.js'
import { SessionManager } from './session/manager.js'
import { ProjectManager } from './project/manager.js'
import { createSlackApp, createSlackAppFromProjectConfig } from './slack/client.js'
import { setupSlackHandlers } from './slack/handler.js'
import { getSlackConfig } from './project/config.js'
import { startRelayServer, stopRelayServer } from './browser/index.js'

const config = loadConfig()
const sessions = new SessionManager()
const projects = new ProjectManager()

const WS_PORT = parseInt(process.env.WS_PORT || '4900', 10)
const ENABLE_SLACK = process.env.ENABLE_SLACK === 'true'
const ENABLE_BROWSER_RELAY = process.env.ENABLE_BROWSER_RELAY !== 'false' // 기본값 true
const BROWSER_RELAY_PORT = parseInt(process.env.BROWSER_RELAY_PORT || '18792', 10)

const gateway = createGatewayServer(WS_PORT, config, sessions, projects)

async function startSlackFromProject(): Promise<boolean> {
  // 프로젝트 목록에서 첫 번째 프로젝트의 Slack 설정 사용
  const projectList = await projects.list()

  for (const project of projectList) {
    const slackConfig = await getSlackConfig(project.path)

    if (slackConfig.enabled && slackConfig.botToken && slackConfig.appToken) {
      console.log(`[Slack] Using project config from: ${project.name}`)

      const slackApp = createSlackAppFromProjectConfig(slackConfig)
      setupSlackHandlers(slackApp, config)

      await slackApp.start()
      console.log('[Slack] Socket Mode connected (project config)')
      return true
    }
  }

  return false
}

async function startSlackFromEnv(): Promise<boolean> {
  if (!config.slackBotToken || !config.slackAppToken) {
    console.error('[Slack] SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required')
    return false
  }

  const slackApp = createSlackApp(config)
  setupSlackHandlers(slackApp, config)

  await slackApp.start()
  console.log('[Slack] Socket Mode connected (env config)')
  return true
}

async function main() {
  // WebSocket Gateway 시작
  gateway.start()
  console.log(`Claude Gateway is running on ws://localhost:${WS_PORT}`)

  // Browser Relay 서버 시작
  if (ENABLE_BROWSER_RELAY) {
    try {
      const relay = await startRelayServer({ port: BROWSER_RELAY_PORT })
      console.log(`Browser Relay is running at ${relay.baseUrl}`)
    } catch (err) {
      console.error('[Browser Relay] Failed to start:', err)
    }
  } else {
    console.log('[Browser Relay] Disabled (set ENABLE_BROWSER_RELAY=true to enable)')
  }

  // Slack 앱 시작
  if (ENABLE_SLACK) {
    // 1. 먼저 프로젝트 설정에서 시도
    const startedFromProject = await startSlackFromProject()

    // 2. 프로젝트 설정이 없으면 환경변수 사용
    if (!startedFromProject) {
      console.log('[Slack] No enabled project config found, trying env...')
      const startedFromEnv = await startSlackFromEnv()

      if (!startedFromEnv) {
        console.log('[Slack] Skipping Slack integration (no valid config)')
      }
    }
  } else {
    console.log('[Slack] Slack integration disabled (set ENABLE_SLACK=true to enable)')
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  gateway.stop()
  await stopRelayServer()
  process.exit(0)
})

main().catch(console.error)
