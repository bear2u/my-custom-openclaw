interface SessionEntry {
  sessionId: string
  createdAt: number
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
  private ttlMs: number

  constructor(ttlMs: number = 60 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  set(threadKey: string, sessionId: string): void {
    this.sessions.set(threadKey, {
      sessionId,
      createdAt: Date.now(),
    })
  }

  get(threadKey: string): string | undefined {
    const entry = this.sessions.get(threadKey)
    if (!entry) {
      return undefined
    }
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.sessions.delete(threadKey)
      return undefined
    }
    return entry.sessionId
  }

  list(): Array<{ key: string; sessionId: string; createdAt: number }> {
    const now = Date.now()
    const result: Array<{ key: string; sessionId: string; createdAt: number }> = []
    for (const [key, entry] of this.sessions) {
      if (now - entry.createdAt <= this.ttlMs) {
        result.push({ key, sessionId: entry.sessionId, createdAt: entry.createdAt })
      }
    }
    return result
  }

  delete(threadKey: string): boolean {
    return this.sessions.delete(threadKey)
  }
}
