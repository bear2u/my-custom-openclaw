import { describe, it, expect } from 'vitest'
import { parseCodexJsonl } from './parser.js'

describe('parseCodexJsonl', () => {
  it('should extract text and thread_id from JSONL', () => {
    const raw = [
      '{"type":"thread.started","thread_id":"019c319d-0e73-7323-9385-8ca8eb1e5c26"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":10}}',
    ].join('\n')

    const result = parseCodexJsonl(raw)

    expect(result).toEqual({
      text: 'Hello',
      sessionId: '019c319d-0e73-7323-9385-8ca8eb1e5c26',
    })
  })

  it('should ignore reasoning type and collect only agent_message', () => {
    const raw = [
      '{"type":"thread.started","thread_id":"abc-123"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Thinking..."}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Goodbye"}}',
    ].join('\n')

    const result = parseCodexJsonl(raw)

    expect(result).toEqual({
      text: 'Goodbye',
      sessionId: 'abc-123',
    })
  })

  it('should return null for empty input', () => {
    expect(parseCodexJsonl('')).toBeNull()
    expect(parseCodexJsonl('  \n  ')).toBeNull()
  })

  it('should join multiple agent_message texts', () => {
    const raw = [
      '{"type":"thread.started","thread_id":"t-1"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Line 1"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Line 2"}}',
    ].join('\n')

    const result = parseCodexJsonl(raw)

    expect(result).toEqual({
      text: 'Line 1\nLine 2',
      sessionId: 't-1',
    })
  })
})
