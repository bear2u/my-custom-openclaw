import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCliArgs, runClaude, createRunner, CliRunner, GatewayRunnerWrapper } from './runner.js'
import { spawn } from 'node:child_process'
import type { Config } from '../config.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '/usr/local/bin/claude'),
}))

describe('buildCliArgs', () => {
  it('should build args for new conversation', () => {
    const args = buildCliArgs({
      message: 'Hello, Claude!',
      model: 'sonnet',
    })

    expect(args).toEqual([
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
      'Hello, Claude!',
    ])
  })

  it('should include --resume for existing session without --model', () => {
    // resume 모드에서는 --model을 생략해야 함 (기존 세션의 모델 사용)
    const validUuid = '550e8400-e29b-41d4-a716-446655440000'
    const args = buildCliArgs({
      message: 'Follow up message',
      model: 'sonnet',
      sessionId: validUuid,
    })

    expect(args).toEqual([
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--resume', validUuid,
      'Follow up message',
    ])
  })

  it('should handle new conversation without model', () => {
    const args = buildCliArgs({
      message: 'Hello',
      model: '',
    })

    expect(args).toEqual([
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      'Hello',
    ])
  })
})

describe('runClaude', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should spawn claude CLI with correct args', async () => {
    const mockStdout = {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"result": "Hello", "session_id": "s1"}'))
        }
      }),
    }
    const mockStderr = { on: vi.fn() }
    const mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0)
        }
      }),
    }
    vi.mocked(spawn).mockReturnValue(mockProcess as never)

    const result = await runClaude({
      message: 'Test message',
      model: 'sonnet',
    })

    // spawn이 호출되었는지 확인 (경로는 동적으로 결정됨)
    expect(spawn).toHaveBeenCalled()
    const callArgs = vi.mocked(spawn).mock.calls[0]
    expect(callArgs[1]).toEqual([
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
      'Test message',
    ])
    expect(result?.text).toBe('Hello')
    expect(result?.sessionId).toBe('s1')
  })
})

describe('createRunner', () => {
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

  it('should return CliRunner when claudeMode is cli', () => {
    const runner = createRunner({ ...baseConfig, claudeMode: 'cli' })
    expect(runner).toBeInstanceOf(CliRunner)
  })

  it('should return GatewayRunnerWrapper when claudeMode is gateway', () => {
    const runner = createRunner({ ...baseConfig, claudeMode: 'gateway' })
    expect(runner).toBeInstanceOf(GatewayRunnerWrapper)
    // 정리
    runner.stop?.()
  })
})
