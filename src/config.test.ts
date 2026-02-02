import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig, validateConfig } from './config.js'

describe('loadConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should load config from environment variables', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
    process.env.SLACK_APP_TOKEN = 'xapp-test-token'
    process.env.CLAUDE_MODEL = 'sonnet'

    const config = loadConfig()

    expect(config.slackBotToken).toBe('xoxb-test-token')
    expect(config.slackAppToken).toBe('xapp-test-token')
    expect(config.claudeModel).toBe('sonnet')
  })
})

describe('validateConfig', () => {
  it('should throw error when SLACK_BOT_TOKEN is missing', () => {
    const config = {
      slackBotToken: '',
      slackAppToken: 'xapp-test',
      claudeModel: 'sonnet',
      claudeTimeout: 120000,
    }

    expect(() => validateConfig(config)).toThrow('SLACK_BOT_TOKEN is required')
  })

  it('should throw error when SLACK_APP_TOKEN is missing', () => {
    const config = {
      slackBotToken: 'xoxb-test',
      slackAppToken: '',
      claudeModel: 'sonnet',
      claudeTimeout: 120000,
    }

    expect(() => validateConfig(config)).toThrow('SLACK_APP_TOKEN is required')
  })

  it('should not throw when all required tokens are present', () => {
    const config = {
      slackBotToken: 'xoxb-test',
      slackAppToken: 'xapp-test',
      claudeModel: 'sonnet',
      claudeTimeout: 120000,
    }

    expect(() => validateConfig(config)).not.toThrow()
  })
})
