import { describe, it, expect } from 'vitest'
import { parseTestYaml, flowToYaml, getSampleYaml } from './yaml-parser.js'

describe('parseTestYaml', () => {
  it('should parse basic YAML with url and commands', () => {
    const yaml = `
url: https://www.google.com
---
- click: "input[name='q']"
- type: "Hello World"
- pressKey: Enter
`
    const result = parseTestYaml(yaml)

    expect(result.error).toBeUndefined()
    expect(result.flow).toBeDefined()
    expect(result.flow?.url).toBe('https://www.google.com')
    expect(result.flow?.commands).toHaveLength(3)
    expect(result.flow?.commands[0]).toEqual({ command: 'click', selector: "input[name='q']" })
    expect(result.flow?.commands[1]).toEqual({ command: 'type', text: 'Hello World' })
    expect(result.flow?.commands[2]).toEqual({ command: 'pressKey', key: 'Enter' })
  })

  it('should parse config options', () => {
    const yaml = `
url: https://example.com
timeout: 5000
retryCount: 2
stepDelay: 100
screenshotOnFailure: true
---
- wait: 1000
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.config?.timeout).toBe(5000)
    expect(result.flow?.config?.retryCount).toBe(2)
    expect(result.flow?.config?.stepDelay).toBe(100)
    expect(result.flow?.config?.screenshotOnFailure).toBe(true)
  })

  it('should handle simple commands without values', () => {
    const yaml = `
url: https://example.com
---
- back
- forward
- reload
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.commands).toHaveLength(3)
    expect(result.flow?.commands[0]).toEqual({ command: 'back' })
    expect(result.flow?.commands[1]).toEqual({ command: 'forward' })
    expect(result.flow?.commands[2]).toEqual({ command: 'reload' })
  })

  it('should parse navigate command', () => {
    const yaml = `
url: https://start.com
---
- navigate: https://example.com
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.commands[0]).toEqual({ command: 'navigate', url: 'https://example.com' })
  })

  it('should parse wait command with number', () => {
    const yaml = `
url: https://example.com
---
- wait: 2000
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.commands[0]).toEqual({ command: 'wait', ms: 2000 })
  })

  it('should parse assertVisible command', () => {
    const yaml = `
url: https://example.com
---
- assertVisible: "#header"
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.commands[0]).toEqual({ command: 'assertVisible', selector: '#header' })
  })

  it('should return error for empty YAML', () => {
    const yaml = ``
    const result = parseTestYaml(yaml)

    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('Empty YAML file')
  })

  it('should return error for YAML without url', () => {
    const yaml = `
timeout: 5000
---
- click: button
`
    const result = parseTestYaml(yaml)

    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('Missing required "url" field in header')
  })

  it('should skip comments', () => {
    const yaml = `
# This is a comment
url: https://example.com
# Another comment
---
# Command comment
- click: button
`
    const result = parseTestYaml(yaml)

    expect(result.flow?.commands).toHaveLength(1)
    expect(result.flow?.commands[0]).toEqual({ command: 'click', selector: 'button' })
  })
})

describe('flowToYaml', () => {
  it('should convert flow to YAML string', () => {
    const flow = {
      url: 'https://example.com',
      commands: [
        { command: 'click' as const, selector: 'button' },
        { command: 'type' as const, text: 'Hello' },
      ],
    }

    const yaml = flowToYaml(flow)

    expect(yaml).toContain('url: https://example.com')
    expect(yaml).toContain('---')
    expect(yaml).toContain('- click: button')
    expect(yaml).toContain('- type: "Hello"')
  })

  it('should include config in YAML', () => {
    const flow = {
      url: 'https://example.com',
      config: {
        timeout: 5000,
        retryCount: 3,
      },
      commands: [],
    }

    const yaml = flowToYaml(flow)

    expect(yaml).toContain('timeout: 5000')
    expect(yaml).toContain('retryCount: 3')
  })
})

describe('getSampleYaml', () => {
  it('should return valid sample YAML', () => {
    const yaml = getSampleYaml()

    const result = parseTestYaml(yaml)

    expect(result.error).toBeUndefined()
    expect(result.flow).toBeDefined()
    expect(result.flow?.url).toBe('https://www.google.com')
    expect(result.flow?.commands.length).toBeGreaterThan(0)
  })
})
