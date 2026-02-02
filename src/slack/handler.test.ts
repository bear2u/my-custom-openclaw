import { describe, it, expect } from 'vitest'
import { shouldProcessMessage, extractUserMessage, chunkMessage } from './handler.js'

describe('shouldProcessMessage', () => {
  const botUserId = 'U123BOT'

  it('should process message mentioning bot', () => {
    const text = `<@${botUserId}> hello`
    expect(shouldProcessMessage(text, botUserId)).toBe(true)
  })

  it('should not process message without bot mention', () => {
    const text = 'hello everyone'
    expect(shouldProcessMessage(text, botUserId)).toBe(false)
  })

  it('should not process empty message', () => {
    expect(shouldProcessMessage('', botUserId)).toBe(false)
  })
})

describe('extractUserMessage', () => {
  const botUserId = 'U123BOT'

  it('should remove bot mention and trim', () => {
    const text = `<@${botUserId}> hello world`
    expect(extractUserMessage(text, botUserId)).toBe('hello world')
  })

  it('should handle multiple spaces after mention', () => {
    const text = `<@${botUserId}>   test message`
    expect(extractUserMessage(text, botUserId)).toBe('test message')
  })

  it('should remove multiple bot mentions', () => {
    const text = `<@${botUserId}> hello <@${botUserId}> world`
    expect(extractUserMessage(text, botUserId)).toBe('hello  world')
  })
})

describe('chunkMessage', () => {
  it('should return single chunk for short messages', () => {
    const text = 'Hello, world!'
    const chunks = chunkMessage(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  it('should split long messages into multiple chunks', () => {
    // 4000자 이상의 메시지 생성
    const text = 'A'.repeat(5000)
    const chunks = chunkMessage(text)
    expect(chunks.length).toBeGreaterThan(1)
    // 모든 청크가 합쳐지면 원본과 같아야 함
    expect(chunks.join('')).toBe(text)
  })

  it('should prefer splitting at newlines', () => {
    const line1 = 'A'.repeat(3000)
    const line2 = 'B'.repeat(3000)
    const text = `${line1}\n${line2}`
    const chunks = chunkMessage(text)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe(line1)
    expect(chunks[1]).toBe(line2)
  })
})
