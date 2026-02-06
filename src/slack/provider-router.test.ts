import { describe, it, expect } from 'vitest'
import { routeMessage } from './provider-router.js'

describe('routeMessage', () => {
  it('should route /codex prefixed messages to codex provider', () => {
    const result = routeMessage('/codex REST API 만들어줘')
    expect(result).toEqual({ provider: 'codex', message: 'REST API 만들어줘' })
  })

  it('should route messages without prefix to claude', () => {
    const result = routeMessage('hello world')
    expect(result).toEqual({ provider: 'claude', message: 'hello world' })
  })

  it('should be case-insensitive for /codex prefix', () => {
    expect(routeMessage('/Codex build it')).toEqual({ provider: 'codex', message: 'build it' })
    expect(routeMessage('/CODEX build it')).toEqual({ provider: 'codex', message: 'build it' })
  })

  it('should not route messages containing codex without / prefix', () => {
    const result = routeMessage('codex 관련 질문이야')
    expect(result).toEqual({ provider: 'claude', message: 'codex 관련 질문이야' })
  })
})
