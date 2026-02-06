import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GatewayServer } from './server.js'
import type { Config } from '../config.js'

// Mock WebSocketServer as a class
const mockOn = vi.fn()
const mockClose = vi.fn()

vi.mock('ws', () => {
  return {
    WebSocketServer: class MockWebSocketServer {
      constructor() {
        // constructor
      }
      on = mockOn
      close = mockClose
    },
    WebSocket: class MockWebSocket {},
  }
})

describe('GatewayServer', () => {
  const baseConfig: Config = {
    slackBotToken: 'xoxb-test',
    slackAppToken: 'xapp-test',
    claudeModel: 'sonnet',
    claudeTimeout: 120000,
    projectPath: '/test/project',
    claudePath: 'claude',
    browserMode: 'off',
    browserRelayPort: 18792,
    claudeMode: 'gateway',
    gatewayUrl: 'ws://127.0.0.1:18789',
    gatewayToken: undefined,
    codexPath: 'codex',
    codexModel: '',
    codexSandbox: 'read-only',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create instance with config', () => {
      const server = new GatewayServer(baseConfig)
      expect(server).toBeInstanceOf(GatewayServer)
    })
  })

  describe('start', () => {
    it('should start WebSocket server', () => {
      const server = new GatewayServer(baseConfig)
      server.start()

      // on 메서드가 호출되었는지 확인 (connection, error 리스너)
      expect(mockOn).toHaveBeenCalled()

      server.stop()
    })
  })

  describe('stop', () => {
    it('should stop server without error', () => {
      const server = new GatewayServer(baseConfig)
      server.start()

      expect(() => server.stop()).not.toThrow()
      expect(mockClose).toHaveBeenCalled()
    })

    it('should be safe to call stop without start', () => {
      const server = new GatewayServer(baseConfig)
      expect(() => server.stop()).not.toThrow()
    })
  })
})
