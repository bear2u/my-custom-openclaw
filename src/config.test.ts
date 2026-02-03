import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig, validateConfig, type Config } from './config.js'

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
    process.env.PROJECT_PATH = '/test/project'
    process.env.CLAUDE_PATH = '/usr/local/bin/claude'

    const config = loadConfig()

    expect(config.slackBotToken).toBe('xoxb-test-token')
    expect(config.slackAppToken).toBe('xapp-test-token')
    expect(config.claudeModel).toBe('sonnet')
    expect(config.projectPath).toBe('/test/project')
    expect(config.claudePath).toBe('/usr/local/bin/claude')
  })

  it('should throw error when PROJECT_PATH is missing', () => {
    delete process.env.PROJECT_PATH

    expect(() => loadConfig()).toThrow('PROJECT_PATH is required in .env')
  })

  it('should use default claude path when not specified', () => {
    process.env.PROJECT_PATH = '/test/project'
    delete process.env.CLAUDE_PATH

    const config = loadConfig()

    expect(config.claudePath).toBe('claude')
  })
})

describe('validateConfig', () => {
  const baseConfig: Config = {
    slackBotToken: 'xoxb-test',
    slackAppToken: 'xapp-test',
    claudeModel: 'sonnet',
    claudeTimeout: 120000,
    projectPath: '/test/project',
    claudePath: 'claude',
    browserMode: 'off',
    browserRelayPort: 18792,
  }

  it('should throw error when SLACK_BOT_TOKEN is missing', () => {
    const config = { ...baseConfig, slackBotToken: '' }

    expect(() => validateConfig(config)).toThrow('SLACK_BOT_TOKEN is required')
  })

  it('should throw error when SLACK_APP_TOKEN is missing', () => {
    const config = { ...baseConfig, slackAppToken: '' }

    expect(() => validateConfig(config)).toThrow('SLACK_APP_TOKEN is required')
  })

  it('should not throw when all required tokens are present', () => {
    expect(() => validateConfig(baseConfig)).not.toThrow()
  })
})
