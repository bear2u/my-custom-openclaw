export type BrowserMode = 'off' | 'puppeteer' | 'relay'
export type ClaudeMode = 'cli' | 'pty' | 'gateway'

export interface Config {
  slackBotToken?: string
  slackAppToken?: string
  claudeModel: string
  claudeTimeout: number
  projectPath: string
  claudePath: string
  browserMode: BrowserMode
  browserRelayPort: number
  // Gateway 모드 설정
  claudeMode: ClaudeMode
  gatewayUrl: string
  gatewayToken?: string
}

export function loadConfig(): Config {
  const projectPath = process.env.PROJECT_PATH
  if (!projectPath) {
    throw new Error('PROJECT_PATH is required in .env')
  }

  // BROWSER_MODE: off, puppeteer, relay (기본값: off)
  const browserModeEnv = process.env.BROWSER_MODE?.toLowerCase() ?? 'off'
  let browserMode: BrowserMode = 'off'
  if (browserModeEnv === 'puppeteer') {
    browserMode = 'puppeteer'
  } else if (browserModeEnv === 'relay') {
    browserMode = 'relay'
  }

  // CLAUDE_MODE: cli | pty | gateway (기본값: pty)
  const claudeModeEnv = process.env.CLAUDE_MODE?.toLowerCase() ?? 'pty'
  let claudeMode: ClaudeMode = 'pty'
  if (claudeModeEnv === 'cli') {
    claudeMode = 'cli'
  } else if (claudeModeEnv === 'gateway') {
    claudeMode = 'gateway'
  }

  return {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    claudeModel: process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeTimeout: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '120000', 10),
    projectPath,
    claudePath: process.env.CLAUDE_PATH ?? 'claude',
    browserMode,
    browserRelayPort: parseInt(process.env.BROWSER_RELAY_PORT ?? '18792', 10),
    // Gateway 모드 설정
    claudeMode,
    gatewayUrl: process.env.GATEWAY_URL ?? 'ws://127.0.0.1:18789',
    gatewayToken: process.env.GATEWAY_TOKEN,
  }
}

export function validateConfig(config: Config): void {
  if (!config.slackBotToken) {
    throw new Error('SLACK_BOT_TOKEN is required')
  }
  if (!config.slackAppToken) {
    throw new Error('SLACK_APP_TOKEN is required')
  }
}
