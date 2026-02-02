import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionManager } from './manager.js'

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
  it('should create a session for a thread', () => {
    const manager = new SessionManager()
    const threadKey = 'C123-1234567890.123456'
    const sessionId = 'session-abc123'

    manager.set(threadKey, sessionId)

    expect(manager.get(threadKey)).toBe(sessionId)
  })

  it('should return undefined for non-existent thread', () => {
    const manager = new SessionManager()

    expect(manager.get('non-existent-thread')).toBeUndefined()
  })

  it('should expire session after TTL', () => {
    const ttlMs = 60 * 60 * 1000 // 1 hour
    const manager = new SessionManager(ttlMs)
    const threadKey = 'C123-1234567890.123456'

    manager.set(threadKey, 'session-abc123')

    // Move time forward past TTL
    vi.advanceTimersByTime(ttlMs + 1)

    expect(manager.get(threadKey)).toBeUndefined()
  })
})
