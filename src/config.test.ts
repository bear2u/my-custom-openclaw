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

  it('should default to pty mode when CLAUDE_MODE is not set', () => {
    process.env.PROJECT_PATH = '/test/project'
    delete process.env.CLAUDE_MODE

    const config = loadConfig()

    expect(config.claudeMode).toBe('pty')
  })

  it('should set gateway mode when CLAUDE_MODE=gateway', () => {
    process.env.PROJECT_PATH = '/test/project'
    process.env.CLAUDE_MODE = 'gateway'
    process.env.GATEWAY_URL = 'ws://localhost:9999'
    process.env.GATEWAY_TOKEN = 'test-token'

    const config = loadConfig()

    expect(config.claudeMode).toBe('gateway')
    expect(config.gatewayUrl).toBe('ws://localhost:9999')
    expect(config.gatewayToken).toBe('test-token')
  })

  it('should load codex config with defaults', () => {
    process.env.PROJECT_PATH = '/test/project'
    delete process.env.CODEX_PATH
    delete process.env.CODEX_MODEL
    delete process.env.CODEX_SANDBOX

    const config = loadConfig()

    expect(config.codexPath).toBe('codex')
    expect(config.codexModel).toBe('')
    expect(config.codexSandbox).toBe('yolo')
  })

  it('should load codex config from env vars', () => {
    process.env.PROJECT_PATH = '/test/project'
    process.env.CODEX_PATH = '/usr/local/bin/codex'
    process.env.CODEX_MODEL = 'gpt-5'
    process.env.CODEX_SANDBOX = 'workspace-write'

    const config = loadConfig()

    expect(config.codexPath).toBe('/usr/local/bin/codex')
    expect(config.codexModel).toBe('gpt-5')
    expect(config.codexSandbox).toBe('workspace-write')
  })

  it('should use default gateway URL when not specified', () => {
    process.env.PROJECT_PATH = '/test/project'
    process.env.CLAUDE_MODE = 'gateway'
    delete process.env.GATEWAY_URL

    const config = loadConfig()

    expect(config.gatewayUrl).toBe('ws://127.0.0.1:18789')
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
    claudeMode: 'cli',
    gatewayUrl: 'ws://127.0.0.1:18789',
    gatewayToken: undefined,
    codexPath: 'codex',
    codexModel: '',
    codexSandbox: 'read-only',
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
