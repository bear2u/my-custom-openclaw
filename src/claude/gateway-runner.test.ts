import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GatewayRunner } from './gateway-runner.js'

// WebSocket mock
vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // OPEN
    })),
  }
})

describe('GatewayRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create instance with url', () => {
      const runner = new GatewayRunner({
        url: 'ws://localhost:18789',
      })

      expect(runner).toBeInstanceOf(GatewayRunner)
    })

    it('should create instance with url and token', () => {
      const runner = new GatewayRunner({
        url: 'ws://localhost:18789',
        token: 'test-token',
      })

      expect(runner).toBeInstanceOf(GatewayRunner)
    })
  })

  describe('stop', () => {
    it('should close websocket connection', () => {
      const runner = new GatewayRunner({
        url: 'ws://localhost:18789',
      })

      // stop 호출 시 에러 없이 동작해야 함
      expect(() => runner.stop()).not.toThrow()
    })
  })
})
