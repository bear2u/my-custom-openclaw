import { describe, it, expect } from 'vitest'
import { buildCodexArgs } from './runner.js'

describe('buildCodexArgs', () => {
  it('should build args for new conversation', () => {
    const args = buildCodexArgs({
      message: 'hello',
      cwd: '/project',
      sandbox: 'read-only',
    })

    expect(args).toEqual([
      'exec', '--json', '--sandbox', 'read-only',
      '--skip-git-repo-check', '-C', '/project', 'hello',
    ])
  })

  it('should build resume args with thread_id (no -C flag)', () => {
    const args = buildCodexArgs({
      message: 'follow up',
      cwd: '/project',
      sandbox: 'read-only',
      sessionId: '019c319d-0e73-7323-9385-8ca8eb1e5c26',
    })

    expect(args).toEqual([
      'exec', 'resume', '019c319d-0e73-7323-9385-8ca8eb1e5c26',
      '--json', '--skip-git-repo-check', 'follow up',
    ])
    expect(args).not.toContain('-C')
  })

  it('should include -m flag when model is provided', () => {
    const args = buildCodexArgs({
      message: 'hello',
      cwd: '/project',
      sandbox: 'read-only',
      model: 'gpt-5',
    })

    expect(args).toContain('-m')
    expect(args).toContain('gpt-5')
  })

  it('should omit -m flag when model is empty', () => {
    const args = buildCodexArgs({
      message: 'hello',
      cwd: '/project',
      sandbox: 'read-only',
      model: '',
    })

    expect(args).not.toContain('-m')
  })
})
