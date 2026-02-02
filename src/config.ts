export interface Config {
  slackBotToken?: string
  slackAppToken?: string
  claudeModel: string
  claudeTimeout: number
}

export function loadConfig(): Config {
  return {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    claudeModel: process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeTimeout: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '120000', 10),
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
