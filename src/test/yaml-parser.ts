/**
 * YAML 테스트 파일 파서
 *
 * Maestro 스타일 YAML을 TestFlow로 변환
 */

import type { TestFlow, TestCommand, TestConfig, YamlParseError } from './types.js'

// YAML 간단 파서 (외부 라이브러리 의존성 제거)
function parseYamlLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const colonIndex = trimmed.indexOf(':')
  if (colonIndex === -1) return null

  const key = trimmed.slice(0, colonIndex).trim()
  let value = trimmed.slice(colonIndex + 1).trim()

  // 따옴표 제거
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }

  return { key, value }
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/)
  return match ? match[1].length : 0
}

interface YamlObject {
  [key: string]: string | number | boolean | YamlObject | YamlObject[]
}

/**
 * YAML 문자열을 객체로 파싱
 */
function parseYaml(yaml: string): YamlObject[] {
  const lines = yaml.split('\n')
  const result: YamlObject[] = []
  let currentObj: YamlObject | null = null
  let inHeader = true
  let headerObj: YamlObject = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 빈 줄이나 주석 스킵
    if (!trimmed || trimmed.startsWith('#')) continue

    // --- 구분자: 헤더 끝, 명령어 시작
    if (trimmed === '---') {
      if (Object.keys(headerObj).length > 0) {
        result.push({ ...headerObj, _isHeader: true })
      }
      inHeader = false
      continue
    }

    // 헤더 영역 파싱
    if (inHeader) {
      const parsed = parseYamlLine(line)
      if (parsed) {
        headerObj[parsed.key] = parseValue(parsed.value)
      }
      continue
    }

    // 명령어 영역 파싱 (- 로 시작하는 리스트)
    if (trimmed.startsWith('-')) {
      // 새 명령어 시작
      if (currentObj) {
        result.push(currentObj)
      }

      const afterDash = trimmed.slice(1).trim()

      // 단순 명령어 (- back, - reload 등)
      if (!afterDash.includes(':')) {
        currentObj = { command: afterDash }
        continue
      }

      // 인라인 키-값 (- click: "버튼")
      const colonIdx = afterDash.indexOf(':')
      const key = afterDash.slice(0, colonIdx).trim()
      const val = afterDash.slice(colonIdx + 1).trim()

      currentObj = { command: key }
      if (val) {
        // 값이 있으면 기본 속성으로 설정
        const defaultProp = getDefaultProperty(key)
        if (defaultProp) {
          currentObj[defaultProp] = parseValue(val)
        }
      }
    } else if (currentObj) {
      // 현재 명령어의 속성
      const parsed = parseYamlLine(line)
      if (parsed) {
        currentObj[parsed.key] = parseValue(parsed.value)
      }
    }
  }

  // 마지막 명령어 추가
  if (currentObj) {
    result.push(currentObj)
  }

  return result
}

/**
 * 문자열 값을 적절한 타입으로 변환
 */
function parseValue(val: string): string | number | boolean {
  // 따옴표 제거
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1)
  }

  // 숫자
  if (/^-?\d+$/.test(val)) return parseInt(val, 10)
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val)

  // 불린
  if (val === 'true') return true
  if (val === 'false') return false

  return val
}

/**
 * 명령어별 기본 속성 매핑
 */
function getDefaultProperty(command: string): string | null {
  const defaults: Record<string, string> = {
    navigate: 'url',
    click: 'selector',
    type: 'text',
    clear: 'selector',
    pressKey: 'key',
    scroll: 'direction',
    scrollTo: 'selector',
    wait: 'ms',
    waitForElement: 'selector',
    assertVisible: 'selector',
    assertNotVisible: 'selector',
    assertText: 'selector',
    assertUrl: 'pattern',
    assertTitle: 'pattern',
    assertExists: 'selector',
    assertNotExists: 'selector',
    assertEnabled: 'selector',
    assertDisabled: 'selector',
    assertChecked: 'selector',
    assertNotChecked: 'selector',
    assertValue: 'selector',
    hover: 'selector',
    focus: 'selector',
    select: 'selector',
    uploadFile: 'selector',
    evaluate: 'script',
    log: 'message',
    screenshot: 'name',
  }
  return defaults[command] || null
}

/**
 * 파싱된 YAML 객체를 TestCommand로 변환
 */
function toTestCommand(obj: YamlObject): TestCommand | null {
  const command = obj.command as string
  if (!command) return null

  // 기본 명령어들
  switch (command) {
    case 'navigate':
      return { command: 'navigate', url: String(obj.url || '') }

    case 'back':
      return { command: 'back' }

    case 'forward':
      return { command: 'forward' }

    case 'reload':
      return { command: 'reload' }

    case 'click':
      return {
        command: 'click',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
        x: obj.x as number | undefined,
        y: obj.y as number | undefined,
        optional: obj.optional as boolean | undefined,
      }

    case 'doubleClick':
      return {
        command: 'doubleClick',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
      }

    case 'rightClick':
      return {
        command: 'rightClick',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
      }

    case 'type':
      return {
        command: 'type',
        text: String(obj.text || ''),
        selector: obj.selector as string | undefined,
      }

    case 'clear':
      return { command: 'clear', selector: String(obj.selector || '') }

    case 'pressKey':
      return { command: 'pressKey', key: String(obj.key || '') }

    case 'scroll':
      return {
        command: 'scroll',
        direction: obj.direction as 'up' | 'down' | 'left' | 'right' | undefined,
        distance: obj.distance as number | undefined,
        selector: obj.selector as string | undefined,
      }

    case 'scrollTo':
      return { command: 'scrollTo', selector: String(obj.selector || '') }

    case 'scrollUntilVisible':
      return {
        command: 'scrollUntilVisible',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
        direction: obj.direction as 'up' | 'down' | undefined,
        maxScrolls: obj.maxScrolls as number | undefined,
      }

    case 'wait':
      return { command: 'wait', ms: Number(obj.ms || 1000) }

    case 'waitForElement':
      return {
        command: 'waitForElement',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
        timeout: obj.timeout as number | undefined,
      }

    case 'waitForNavigation':
      return {
        command: 'waitForNavigation',
        timeout: obj.timeout as number | undefined,
      }

    case 'waitForNetwork':
      return {
        command: 'waitForNetwork',
        timeout: obj.timeout as number | undefined,
      }

    case 'assertVisible':
      return {
        command: 'assertVisible',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
        optional: obj.optional as boolean | undefined,
      }

    case 'assertNotVisible':
      return {
        command: 'assertNotVisible',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
      }

    case 'assertText':
      return {
        command: 'assertText',
        selector: String(obj.selector || ''),
        expected: String(obj.expected || ''),
      }

    case 'assertUrl':
      return { command: 'assertUrl', pattern: String(obj.pattern || '') }

    case 'assertTitle':
      return { command: 'assertTitle', pattern: String(obj.pattern || '') }

    case 'assertExists':
      return { command: 'assertExists', selector: String(obj.selector || '') }

    case 'assertNotExists':
      return { command: 'assertNotExists', selector: String(obj.selector || '') }

    case 'assertEnabled':
      return { command: 'assertEnabled', selector: String(obj.selector || '') }

    case 'assertDisabled':
      return { command: 'assertDisabled', selector: String(obj.selector || '') }

    case 'assertChecked':
      return { command: 'assertChecked', selector: String(obj.selector || '') }

    case 'assertNotChecked':
      return { command: 'assertNotChecked', selector: String(obj.selector || '') }

    case 'assertValue':
      return {
        command: 'assertValue',
        selector: String(obj.selector || ''),
        expected: String(obj.expected || ''),
      }

    case 'screenshot':
      return { command: 'screenshot', name: obj.name as string | undefined }

    case 'hover':
      return {
        command: 'hover',
        selector: obj.selector as string | undefined,
        text: obj.text as string | undefined,
      }

    case 'focus':
      return { command: 'focus', selector: String(obj.selector || '') }

    case 'blur':
      return { command: 'blur', selector: obj.selector as string | undefined }

    case 'select':
      return {
        command: 'select',
        selector: String(obj.selector || ''),
        value: obj.value as string | undefined,
        label: obj.label as string | undefined,
        index: obj.index as number | undefined,
      }

    case 'uploadFile':
      return {
        command: 'uploadFile',
        selector: String(obj.selector || ''),
        filePath: String(obj.filePath || ''),
      }

    case 'evaluate':
      return { command: 'evaluate', script: String(obj.script || '') }

    case 'log':
      return { command: 'log', message: String(obj.message || '') }

    default:
      return null
  }
}

/**
 * YAML 문자열을 TestFlow로 파싱
 */
export function parseTestYaml(yaml: string): { flow?: TestFlow; error?: YamlParseError } {
  try {
    const objects = parseYaml(yaml)

    if (objects.length === 0) {
      return { error: { message: 'Empty YAML file' } }
    }

    // 헤더 찾기
    const header = objects.find(obj => obj._isHeader)
    if (!header || !header.url) {
      return { error: { message: 'Missing required "url" field in header' } }
    }

    // 설정 추출
    const config: TestConfig = {}
    if (header.timeout) config.timeout = Number(header.timeout)
    if (header.retryCount) config.retryCount = Number(header.retryCount)
    if (header.stepDelay) config.stepDelay = Number(header.stepDelay)
    if (header.screenshotOnStep !== undefined) config.screenshotOnStep = Boolean(header.screenshotOnStep)
    if (header.screenshotOnFailure !== undefined) config.screenshotOnFailure = Boolean(header.screenshotOnFailure)

    // 명령어 변환
    const commands: TestCommand[] = []
    for (const obj of objects) {
      if (obj._isHeader) continue

      const cmd = toTestCommand(obj)
      if (cmd) {
        commands.push(cmd)
      }
    }

    return {
      flow: {
        url: String(header.url),
        config: Object.keys(config).length > 0 ? config : undefined,
        commands,
      },
    }
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Failed to parse YAML',
      },
    }
  }
}

/**
 * TestFlow를 YAML 문자열로 변환 (편집기용)
 */
export function flowToYaml(flow: TestFlow): string {
  const lines: string[] = []

  // 헤더
  lines.push(`url: ${flow.url}`)
  if (flow.config) {
    if (flow.config.timeout) lines.push(`timeout: ${flow.config.timeout}`)
    if (flow.config.retryCount) lines.push(`retryCount: ${flow.config.retryCount}`)
    if (flow.config.stepDelay) lines.push(`stepDelay: ${flow.config.stepDelay}`)
    if (flow.config.screenshotOnStep) lines.push(`screenshotOnStep: ${flow.config.screenshotOnStep}`)
    if (flow.config.screenshotOnFailure) lines.push(`screenshotOnFailure: ${flow.config.screenshotOnFailure}`)
  }
  lines.push('---')

  // 명령어들
  for (const cmd of flow.commands) {
    lines.push(commandToYaml(cmd))
  }

  return lines.join('\n')
}

function commandToYaml(cmd: TestCommand): string {
  switch (cmd.command) {
    case 'navigate':
      return `- navigate: ${cmd.url}`
    case 'back':
      return '- back'
    case 'forward':
      return '- forward'
    case 'reload':
      return '- reload'
    case 'click':
      if (cmd.text) return `- click: "${cmd.text}"`
      if (cmd.selector) return `- click: ${cmd.selector}`
      return `- click:\n    x: ${cmd.x}\n    y: ${cmd.y}`
    case 'type':
      if (cmd.selector) {
        return `- type:\n    selector: ${cmd.selector}\n    text: "${cmd.text}"`
      }
      return `- type: "${cmd.text}"`
    case 'clear':
      return `- clear: ${cmd.selector}`
    case 'pressKey':
      return `- pressKey: ${cmd.key}`
    case 'wait':
      return `- wait: ${cmd.ms}`
    case 'waitForElement':
      if (cmd.text) return `- waitForElement: "${cmd.text}"`
      return `- waitForElement: ${cmd.selector}`
    case 'assertVisible':
      if (cmd.text) return `- assertVisible: "${cmd.text}"`
      return `- assertVisible: ${cmd.selector}`
    case 'assertUrl':
      return `- assertUrl: "${cmd.pattern}"`
    case 'assertTitle':
      return `- assertTitle: "${cmd.pattern}"`
    case 'screenshot':
      return cmd.name ? `- screenshot: ${cmd.name}` : '- screenshot'
    case 'log':
      return `- log: "${cmd.message}"`
    default:
      return `- ${cmd.command}`
  }
}

/**
 * 샘플 YAML 생성
 */
export function getSampleYaml(): string {
  return `# 테스트 시나리오 설정
url: https://www.google.com
timeout: 10000
retryCount: 3
screenshotOnFailure: true
---
# 검색 테스트
- waitForElement: "input[name='q']"
- click: "input[name='q']"
- type: "Hello World"
- pressKey: Enter
- wait: 2000
- assertVisible: "#search"
- screenshot: search-results
`
}
