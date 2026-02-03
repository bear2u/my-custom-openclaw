/**
 * 테스트 실행 엔진 (Orchestra 패턴)
 *
 * Maestro 스타일 YAML 명령어를 직접 실행
 */

import * as browserTool from '../browser/browser-tool.js'
import { scenarioDb } from './scenario-db.js'
import { parseTestYaml } from './yaml-parser.js'
import type {
  TestRun,
  TestCommand,
  CommandResult,
  TestEvent,
  TestConfig,
  TestFlow,
} from './types.js'

// 기본 설정
const DEFAULT_CONFIG: Required<TestConfig> = {
  timeout: 10000,
  retryCount: 3,
  stepDelay: 500,
  screenshotOnStep: false,
  screenshotOnFailure: true,
}

export interface TestRunnerOptions {
  onEvent?: (event: TestEvent) => void
  config?: Partial<TestConfig>
}

// 실행 중인 테스트 추적
const runningTests = new Map<string, { abort: boolean }>()

/**
 * 스크린샷 촬영 (base64 반환)
 */
async function takeScreenshot(): Promise<string | undefined> {
  try {
    const result = await browserTool.screenshot({ format: 'png' })
    return result.data
  } catch {
    return undefined
  }
}

/**
 * 요소를 찾는 헬퍼 (selector 또는 text 기반)
 */
async function findElement(
  options: { selector?: string; text?: string },
  timeout: number
): Promise<string> {
  if (options.selector) {
    await browserTool.waitForSelector(options.selector, timeout)
    return options.selector
  }
  if (options.text) {
    // 텍스트로 요소 찾기 - XPath 사용
    const xpath = `//*[contains(text(), "${options.text}")]`
    await browserTool.waitForSelector(`xpath=${xpath}`, timeout)
    return `xpath=${xpath}`
  }
  throw new Error('selector or text is required')
}

/**
 * 헬퍼: evaluate 실행
 */
async function evalScript(script: string): Promise<unknown> {
  return browserTool.evaluate({ script })
}

/**
 * 헬퍼: 요소가 보이는지 확인
 */
async function isVisible(selector: string): Promise<boolean> {
  const result = await evalScript(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  `)
  return Boolean(result)
}

/**
 * 헬퍼: 마우스 hover
 */
async function hover(selector: string): Promise<void> {
  await evalScript(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) {
      const event = new MouseEvent('mouseover', { bubbles: true });
      el.dispatchEvent(event);
    }
  `)
}

/**
 * 헬퍼: select 드롭다운
 */
async function selectOption(selector: string, options: { value?: string; label?: string; index?: number }): Promise<void> {
  if (options.value) {
    await evalScript(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.value = ${JSON.stringify(options.value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `)
  } else if (options.label) {
    await evalScript(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        const option = Array.from(el.options).find(o => o.text === ${JSON.stringify(options.label)});
        if (option) {
          el.value = option.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    `)
  } else if (options.index !== undefined) {
    await evalScript(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el && el.options[${options.index}]) {
        el.selectedIndex = ${options.index};
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `)
  }
}

/**
 * 단일 명령어 실행
 */
async function executeCommand(
  cmd: TestCommand,
  config: Required<TestConfig>
): Promise<void> {
  const { timeout } = config

  switch (cmd.command) {
    // 네비게이션
    case 'navigate':
      await browserTool.navigate({ url: cmd.url })
      break

    case 'back':
      await evalScript('window.history.back()')
      break

    case 'forward':
      await evalScript('window.history.forward()')
      break

    case 'reload':
      await evalScript('window.location.reload()')
      break

    // 클릭/탭
    case 'click': {
      if (cmd.x !== undefined && cmd.y !== undefined) {
        await browserTool.click({ x: cmd.x, y: cmd.y })
      } else {
        const selector = await findElement(cmd, timeout)
        await browserTool.click({ selector })
      }
      break
    }

    case 'doubleClick': {
      const selector = await findElement(cmd, timeout)
      await evalScript(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          const event = new MouseEvent('dblclick', { bubbles: true });
          el.dispatchEvent(event);
        }
      `)
      break
    }

    case 'rightClick': {
      const selector = await findElement(cmd, timeout)
      await evalScript(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          const event = new MouseEvent('contextmenu', { bubbles: true });
          el.dispatchEvent(event);
        }
      `)
      break
    }

    // 텍스트 입력
    case 'type': {
      if (cmd.selector) {
        await browserTool.focus(cmd.selector)
      }
      await browserTool.type({ text: cmd.text })
      break
    }

    case 'clear': {
      await browserTool.clear(cmd.selector)
      break
    }

    case 'pressKey': {
      // 키 이벤트를 JavaScript로 시뮬레이션
      const keyMap: Record<string, { key: string; keyCode: number }> = {
        Enter: { key: 'Enter', keyCode: 13 },
        Tab: { key: 'Tab', keyCode: 9 },
        Escape: { key: 'Escape', keyCode: 27 },
        Backspace: { key: 'Backspace', keyCode: 8 },
        Delete: { key: 'Delete', keyCode: 46 },
        ArrowUp: { key: 'ArrowUp', keyCode: 38 },
        ArrowDown: { key: 'ArrowDown', keyCode: 40 },
        ArrowLeft: { key: 'ArrowLeft', keyCode: 37 },
        ArrowRight: { key: 'ArrowRight', keyCode: 39 },
      }
      const keyInfo = keyMap[cmd.key] || { key: cmd.key, keyCode: cmd.key.charCodeAt(0) }
      await evalScript(`
        const event = new KeyboardEvent('keydown', {
          key: ${JSON.stringify(keyInfo.key)},
          keyCode: ${keyInfo.keyCode},
          bubbles: true
        });
        document.activeElement?.dispatchEvent(event);
      `)
      break
    }

    // 스크롤
    case 'scroll': {
      const distance = cmd.distance ?? 300
      let x = 0, y = 0
      switch (cmd.direction ?? 'down') {
        case 'up': y = -distance; break
        case 'down': y = distance; break
        case 'left': x = -distance; break
        case 'right': x = distance; break
      }
      if (cmd.selector) {
        await browserTool.scroll({ selector: cmd.selector })
      } else {
        await evalScript(`window.scrollBy(${x}, ${y})`)
      }
      break
    }

    case 'scrollTo': {
      await browserTool.scroll({ selector: cmd.selector })
      break
    }

    case 'scrollUntilVisible': {
      const maxScrolls = cmd.maxScrolls ?? 10
      const direction = cmd.direction ?? 'down'
      const distance = direction === 'down' ? 300 : -300

      for (let i = 0; i < maxScrolls; i++) {
        try {
          await findElement(cmd, 1000)
          return // 요소 발견
        } catch {
          await evalScript(`window.scrollBy(0, ${distance})`)
          await new Promise(r => setTimeout(r, 500))
        }
      }
      throw new Error(`Element not found after ${maxScrolls} scrolls`)
    }

    // 대기
    case 'wait':
      await new Promise(r => setTimeout(r, cmd.ms))
      break

    case 'waitForElement': {
      await findElement(cmd, cmd.timeout ?? timeout)
      break
    }

    case 'waitForNavigation': {
      await new Promise(r => setTimeout(r, cmd.timeout ?? 5000))
      break
    }

    case 'waitForNetwork': {
      await new Promise(r => setTimeout(r, cmd.timeout ?? 3000))
      break
    }

    // 검증 (Assert)
    case 'assertVisible': {
      const selector = await findElement(cmd, timeout)
      const visible = await isVisible(selector)
      if (!visible) {
        throw new Error(`Element is not visible: ${cmd.selector || cmd.text}`)
      }
      break
    }

    case 'assertNotVisible': {
      try {
        const selector = await findElement(cmd, 2000)
        const visible = await isVisible(selector)
        if (visible) {
          throw new Error(`Element is visible but should not be: ${cmd.selector || cmd.text}`)
        }
      } catch {
        // 요소를 찾지 못하면 성공
      }
      break
    }

    case 'assertText': {
      const text = await browserTool.getText(cmd.selector)
      if (!text.includes(cmd.expected)) {
        throw new Error(`Text mismatch: expected "${cmd.expected}" but got "${text}"`)
      }
      break
    }

    case 'assertUrl': {
      const url = await evalScript('window.location.href') as string
      const pattern = cmd.pattern
      if (!url.includes(pattern) && !new RegExp(pattern).test(url)) {
        throw new Error(`URL mismatch: expected "${pattern}" but got "${url}"`)
      }
      break
    }

    case 'assertTitle': {
      const title = await evalScript('document.title') as string
      const pattern = cmd.pattern
      if (!title.includes(pattern) && !new RegExp(pattern).test(title)) {
        throw new Error(`Title mismatch: expected "${pattern}" but got "${title}"`)
      }
      break
    }

    case 'assertExists': {
      const exists = await browserTool.exists(cmd.selector)
      if (!exists) {
        throw new Error(`Element does not exist: ${cmd.selector}`)
      }
      break
    }

    case 'assertNotExists': {
      const exists = await browserTool.exists(cmd.selector)
      if (exists) {
        throw new Error(`Element exists but should not: ${cmd.selector}`)
      }
      break
    }

    case 'assertEnabled': {
      const disabled = await evalScript(
        `document.querySelector(${JSON.stringify(cmd.selector)})?.disabled`
      )
      if (disabled) {
        throw new Error(`Element is disabled: ${cmd.selector}`)
      }
      break
    }

    case 'assertDisabled': {
      const disabled = await evalScript(
        `document.querySelector(${JSON.stringify(cmd.selector)})?.disabled`
      )
      if (!disabled) {
        throw new Error(`Element is enabled but should be disabled: ${cmd.selector}`)
      }
      break
    }

    case 'assertChecked': {
      const checked = await evalScript(
        `document.querySelector(${JSON.stringify(cmd.selector)})?.checked`
      )
      if (!checked) {
        throw new Error(`Element is not checked: ${cmd.selector}`)
      }
      break
    }

    case 'assertNotChecked': {
      const checked = await evalScript(
        `document.querySelector(${JSON.stringify(cmd.selector)})?.checked`
      )
      if (checked) {
        throw new Error(`Element is checked but should not be: ${cmd.selector}`)
      }
      break
    }

    case 'assertValue': {
      const value = await evalScript(
        `document.querySelector(${JSON.stringify(cmd.selector)})?.value`
      ) as string
      if (value !== cmd.expected) {
        throw new Error(`Value mismatch: expected "${cmd.expected}" but got "${value}"`)
      }
      break
    }

    // 스크린샷
    case 'screenshot':
      // 스크린샷은 결과에서 처리
      break

    // 호버/포커스
    case 'hover': {
      const selector = await findElement(cmd, timeout)
      await hover(selector)
      break
    }

    case 'focus': {
      await browserTool.focus(cmd.selector)
      break
    }

    case 'blur': {
      if (cmd.selector) {
        await evalScript(`document.querySelector(${JSON.stringify(cmd.selector)})?.blur()`)
      } else {
        await evalScript('document.activeElement?.blur()')
      }
      break
    }

    // 선택 (드롭다운)
    case 'select': {
      await selectOption(cmd.selector, { value: cmd.value, label: cmd.label, index: cmd.index })
      break
    }

    // 파일 업로드 (제한적 지원)
    case 'uploadFile': {
      console.warn('[Test] File upload is not fully supported via CDP')
      break
    }

    // JavaScript 실행
    case 'evaluate': {
      await evalScript(cmd.script)
      break
    }

    // 로그
    case 'log':
      console.log(`[Test Log] ${cmd.message}`)
      break

    // 흐름 제어 (retry, repeat)는 runFlow에서 처리
    case 'retry':
    case 'repeat':
      // 별도 처리
      break

    default:
      throw new Error(`Unknown command: ${(cmd as TestCommand).command}`)
  }
}

/**
 * 명령어 실행 (재시도 포함)
 */
async function executeWithRetry(
  cmd: TestCommand,
  index: number,
  runId: string,
  config: Required<TestConfig>,
  emit: (event: TestEvent) => void
): Promise<CommandResult> {
  const startTime = Date.now()
  let lastError: string | undefined
  const maxAttempts = config.retryCount

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 명령어 실행
      await executeCommand(cmd, config)

      // 성공 시 스크린샷 (설정에 따라)
      let screenshot: string | undefined
      if (config.screenshotOnStep || cmd.command === 'screenshot') {
        screenshot = await takeScreenshot()
      }

      return {
        index,
        command: cmd,
        status: 'passed',
        startedAt: startTime,
        finishedAt: Date.now(),
        duration: Date.now() - startTime,
        attempts: attempt,
        screenshot,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)

      // optional 명령어는 실패해도 경고로 처리
      if ('optional' in cmd && cmd.optional) {
        return {
          index,
          command: cmd,
          status: 'warned',
          startedAt: startTime,
          finishedAt: Date.now(),
          duration: Date.now() - startTime,
          attempts: attempt,
          warning: lastError,
        }
      }

      if (attempt < maxAttempts) {
        emit({
          type: 'test.command.retry',
          runId,
          index,
          attempt,
          maxAttempts,
          error: lastError,
        })

        // 재시도 전 대기
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  // 모든 재시도 실패
  let screenshot: string | undefined
  if (config.screenshotOnFailure) {
    screenshot = await takeScreenshot()
  }

  return {
    index,
    command: cmd,
    status: 'failed',
    startedAt: startTime,
    finishedAt: Date.now(),
    duration: Date.now() - startTime,
    attempts: maxAttempts,
    screenshot,
    error: lastError,
  }
}

/**
 * 테스트 플로우 실행
 */
async function runFlow(
  flow: TestFlow,
  runId: string,
  config: Required<TestConfig>,
  emit: (event: TestEvent) => void,
  runningState: { abort: boolean }
): Promise<CommandResult[]> {
  const results: CommandResult[] = []

  for (let i = 0; i < flow.commands.length; i++) {
    // 중단 체크
    if (runningState.abort) {
      // 나머지 명령어는 skipped로 처리
      for (let j = i; j < flow.commands.length; j++) {
        results.push({
          index: j,
          command: flow.commands[j],
          status: 'skipped',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          duration: 0,
          attempts: 0,
        })
      }
      break
    }

    const cmd = flow.commands[i]

    // 명령어 시작 이벤트
    emit({
      type: 'test.command.start',
      runId,
      index: i,
      command: cmd,
    })

    let result: CommandResult

    // 특수 명령어 처리
    if (cmd.command === 'retry') {
      // retry 블록 실행
      result = await executeRetryBlock(cmd, i, runId, config, emit, runningState)
    } else if (cmd.command === 'repeat') {
      // repeat 블록 실행
      result = await executeRepeatBlock(cmd, i, runId, config, emit, runningState)
    } else {
      // 일반 명령어 실행
      result = await executeWithRetry(cmd, i, runId, config, emit)
    }

    results.push(result)

    // 스크린샷 이벤트 (있는 경우)
    if (result.screenshot) {
      emit({
        type: 'test.command.screenshot',
        runId,
        index: i,
        screenshot: result.screenshot,
      })
    }

    // 명령어 완료 이벤트
    emit({
      type: 'test.command.complete',
      runId,
      index: i,
      result,
    })

    // 실패 시 중단
    if (result.status === 'failed') {
      // 나머지 명령어는 skipped로 처리
      for (let j = i + 1; j < flow.commands.length; j++) {
        results.push({
          index: j,
          command: flow.commands[j],
          status: 'skipped',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          duration: 0,
          attempts: 0,
        })
      }
      break
    }

    // 명령어 간 대기
    await new Promise(r => setTimeout(r, config.stepDelay))
  }

  return results
}

/**
 * retry 블록 실행
 */
async function executeRetryBlock(
  cmd: { command: 'retry'; maxRetries: number; commands: TestCommand[] },
  index: number,
  runId: string,
  config: Required<TestConfig>,
  emit: (event: TestEvent) => void,
  runningState: { abort: boolean }
): Promise<CommandResult> {
  const startTime = Date.now()
  let lastError: string | undefined

  for (let attempt = 1; attempt <= cmd.maxRetries; attempt++) {
    try {
      const subFlow: TestFlow = {
        url: '',
        commands: cmd.commands,
      }

      const subResults = await runFlow(subFlow, runId, config, emit, runningState)
      const allPassed = subResults.every(r => r.status === 'passed' || r.status === 'warned')

      if (allPassed) {
        return {
          index,
          command: cmd,
          status: 'passed',
          startedAt: startTime,
          finishedAt: Date.now(),
          duration: Date.now() - startTime,
          attempts: attempt,
          metadata: { subResults },
        }
      }

      lastError = subResults.find(r => r.status === 'failed')?.error
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    if (attempt < cmd.maxRetries) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return {
    index,
    command: cmd,
    status: 'failed',
    startedAt: startTime,
    finishedAt: Date.now(),
    duration: Date.now() - startTime,
    attempts: cmd.maxRetries,
    error: lastError,
  }
}

/**
 * repeat 블록 실행
 */
async function executeRepeatBlock(
  cmd: { command: 'repeat'; times: number; commands: TestCommand[] },
  index: number,
  runId: string,
  config: Required<TestConfig>,
  emit: (event: TestEvent) => void,
  runningState: { abort: boolean }
): Promise<CommandResult> {
  const startTime = Date.now()

  for (let i = 0; i < cmd.times; i++) {
    const subFlow: TestFlow = {
      url: '',
      commands: cmd.commands,
    }

    const subResults = await runFlow(subFlow, runId, config, emit, runningState)
    const failed = subResults.find(r => r.status === 'failed')

    if (failed) {
      return {
        index,
        command: cmd,
        status: 'failed',
        startedAt: startTime,
        finishedAt: Date.now(),
        duration: Date.now() - startTime,
        attempts: i + 1,
        error: failed.error,
      }
    }
  }

  return {
    index,
    command: cmd,
    status: 'passed',
    startedAt: startTime,
    finishedAt: Date.now(),
    duration: Date.now() - startTime,
    attempts: cmd.times,
  }
}

/**
 * 테스트 시나리오 실행
 */
export async function runTestScenario(
  scenarioId: string,
  options?: TestRunnerOptions
): Promise<TestRun> {
  const scenario = scenarioDb.getScenario(scenarioId)
  if (!scenario) {
    throw new Error(`Scenario not found: ${scenarioId}`)
  }

  // YAML 파싱
  const parseResult = parseTestYaml(scenario.yaml)
  if (parseResult.error || !parseResult.flow) {
    throw new Error(`Failed to parse YAML: ${parseResult.error?.message}`)
  }

  const flow = parseResult.flow

  // 설정 병합
  const config: Required<TestConfig> = {
    ...DEFAULT_CONFIG,
    ...flow.config,
    ...options?.config,
  }

  // 테스트 실행 생성
  let run = scenarioDb.createRun(scenarioId)
  run = scenarioDb.updateRun(run.id, { status: 'running' })!

  // 실행 상태 추적
  const runningState = { abort: false }
  runningTests.set(run.id, runningState)

  const emit = (event: TestEvent) => {
    options?.onEvent?.(event)
  }

  emit({
    type: 'test.run.start',
    runId: run.id,
    scenarioId,
    totalCommands: flow.commands.length,
  })

  const startTime = Date.now()

  try {
    // 1. 시작 URL로 이동
    await browserTool.openUrl(flow.url, true)
    await new Promise(r => setTimeout(r, 2000))  // 페이지 로드 대기

    // 2. 명령어 실행
    const results = await runFlow(flow, run.id, config, emit, runningState)

    // 3. 결과 요약
    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      warned: results.filter(r => r.status === 'warned').length,
    }

    // 4. 최종 상태 결정
    let finalStatus: TestRun['status']
    if (runningState.abort) {
      finalStatus = 'stopped'
    } else if (summary.failed > 0) {
      finalStatus = 'failed'
    } else {
      finalStatus = 'passed'
    }

    const finishedAt = Date.now()

    run = scenarioDb.updateRun(run.id, {
      status: finalStatus,
      finishedAt,
      commands: results,
      duration: finishedAt - startTime,
      summary,
      error: results.find(r => r.status === 'failed')?.error,
    })!

    emit({
      type: 'test.run.complete',
      runId: run.id,
      result: run,
    })

    return run
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const finishedAt = Date.now()

    run = scenarioDb.updateRun(run.id, {
      status: 'error',
      finishedAt,
      commands: [],
      duration: finishedAt - startTime,
      error,
    })!

    emit({
      type: 'test.run.error',
      runId: run.id,
      error,
    })

    return run
  } finally {
    runningTests.delete(run.id)
  }
}

/**
 * 테스트 실행 중단
 */
export function stopTestRun(runId: string): boolean {
  const running = runningTests.get(runId)
  if (running) {
    running.abort = true
    return true
  }
  return false
}

export default { runTestScenario, stopTestRun }
