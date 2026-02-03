export type BrowserMode = 'off' | 'puppeteer' | 'relay'

export interface Config {
  slackBotToken?: string
  slackAppToken?: string
  claudeModel: string
  claudeTimeout: number
  projectPath: string
  claudePath: string
  browserMode: BrowserMode
  browserRelayPort: number
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

  return {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    claudeModel: process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeTimeout: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '120000', 10),
    projectPath,
    claudePath: process.env.CLAUDE_PATH ?? 'claude',
    browserMode,
    browserRelayPort: parseInt(process.env.BROWSER_RELAY_PORT ?? '18792', 10),
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
