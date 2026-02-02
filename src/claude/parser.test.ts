import { describe, it, expect } from 'vitest'
import { parseCliOutput } from './parser.js'

describe('parseCliOutput', () => {
  it('should extract text from result field', () => {
    const json = JSON.stringify({
      result: 'Hello, world!',
      session_id: 'session-123',
    })

    const output = parseCliOutput(json)

    expect(output?.text).toBe('Hello, world!')
  })

  it('should extract sessionId from session_id field', () => {
    const json = JSON.stringify({
      result: 'Hello',
      session_id: 'session-abc-123',
    })

    const output = parseCliOutput(json)

    expect(output?.sessionId).toBe('session-abc-123')
  })
})
