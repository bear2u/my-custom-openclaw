/**
 * 웹 E2E 테스트 시스템 - Maestro 스타일
 *
 * YAML 기반 테스트 시나리오 정의 및 실행
 */

// ============================================
// 테스트 시나리오 (DB 저장용)
// ============================================

export interface TestScenario {
  id: string
  projectId: string
  name: string
  description: string
  /** YAML 형식의 테스트 정의 */
  yaml: string
  createdAt: number
  updatedAt: number
}

// ============================================
// YAML 파싱 결과 (테스트 플로우)
// ============================================

export interface TestFlow {
  /** 시작 URL */
  url: string
  /** 테스트 설정 */
  config?: TestConfig
  /** 실행할 명령어 목록 */
  commands: TestCommand[]
}

export interface TestConfig {
  /** 요소 찾기 타임아웃 (ms) */
  timeout?: number
  /** 실패 시 재시도 횟수 */
  retryCount?: number
  /** 명령어 사이 대기 시간 (ms) */
  stepDelay?: number
  /** 스크린샷 자동 저장 */
  screenshotOnStep?: boolean
  /** 스크린샷 자동 저장 (실패 시) */
  screenshotOnFailure?: boolean
}

// ============================================
// 명령어 타입들 (Maestro 스타일)
// ============================================

export type TestCommand =
  // 네비게이션
  | { command: 'navigate'; url: string }
  | { command: 'back' }
  | { command: 'forward' }
  | { command: 'reload' }

  // 클릭/탭
  | { command: 'click'; selector?: string; text?: string; x?: number; y?: number; optional?: boolean }
  | { command: 'doubleClick'; selector?: string; text?: string }
  | { command: 'rightClick'; selector?: string; text?: string }

  // 텍스트 입력
  | { command: 'type'; text: string; selector?: string }
  | { command: 'clear'; selector: string }
  | { command: 'pressKey'; key: string }  // Enter, Tab, Escape, etc.

  // 스크롤
  | { command: 'scroll'; direction?: 'up' | 'down' | 'left' | 'right'; distance?: number; selector?: string }
  | { command: 'scrollTo'; selector: string }
  | { command: 'scrollUntilVisible'; selector?: string; text?: string; direction?: 'up' | 'down'; maxScrolls?: number }

  // 대기
  | { command: 'wait'; ms: number }
  | { command: 'waitForElement'; selector?: string; text?: string; timeout?: number }
  | { command: 'waitForNavigation'; timeout?: number }
  | { command: 'waitForNetwork'; timeout?: number }

  // 검증 (Assert)
  | { command: 'assertVisible'; selector?: string; text?: string; optional?: boolean }
  | { command: 'assertNotVisible'; selector?: string; text?: string }
  | { command: 'assertText'; selector: string; expected: string }
  | { command: 'assertUrl'; pattern: string }  // 정규식 또는 포함 문자열
  | { command: 'assertTitle'; pattern: string }
  | { command: 'assertExists'; selector: string }
  | { command: 'assertNotExists'; selector: string }
  | { command: 'assertEnabled'; selector: string }
  | { command: 'assertDisabled'; selector: string }
  | { command: 'assertChecked'; selector: string }
  | { command: 'assertNotChecked'; selector: string }
  | { command: 'assertValue'; selector: string; expected: string }

  // 스크린샷
  | { command: 'screenshot'; name?: string }

  // 흐름 제어
  | { command: 'retry'; maxRetries: number; commands: TestCommand[] }
  | { command: 'repeat'; times: number; commands: TestCommand[] }

  // 호버/포커스
  | { command: 'hover'; selector?: string; text?: string }
  | { command: 'focus'; selector: string }
  | { command: 'blur'; selector?: string }

  // 선택 (드롭다운)
  | { command: 'select'; selector: string; value?: string; label?: string; index?: number }

  // 파일 업로드
  | { command: 'uploadFile'; selector: string; filePath: string }

  // JavaScript 실행
  | { command: 'evaluate'; script: string }

  // 설명 (로그용)
  | { command: 'log'; message: string }

// ============================================
// 테스트 실행 결과
// ============================================

export interface TestRun {
  id: string
  scenarioId: string
  status: TestRunStatus
  startedAt: number
  finishedAt?: number
  /** 실행된 명령어 결과들 */
  commands: CommandResult[]
  /** 최종 에러 메시지 */
  error?: string
  /** 총 소요 시간 (ms) */
  duration?: number
  /** 성공/실패/스킵 카운트 */
  summary?: {
    total: number
    passed: number
    failed: number
    skipped: number
    warned: number
  }
}

export type TestRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'stopped'

export interface CommandResult {
  /** 명령어 인덱스 */
  index: number
  /** 원본 명령어 */
  command: TestCommand
  /** 실행 상태 */
  status: CommandStatus
  /** 시작 시간 */
  startedAt: number
  /** 종료 시간 */
  finishedAt?: number
  /** 소요 시간 (ms) */
  duration?: number
  /** 재시도 횟수 */
  attempts: number
  /** 스크린샷 (base64) */
  screenshot?: string
  /** 에러 메시지 */
  error?: string
  /** 경고 메시지 */
  warning?: string
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>
}

export type CommandStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'warned'

// ============================================
// 실시간 이벤트 (WebSocket)
// ============================================

export type TestEvent =
  | { type: 'test.run.start'; runId: string; scenarioId: string; totalCommands: number }
  | { type: 'test.command.start'; runId: string; index: number; command: TestCommand }
  | { type: 'test.command.screenshot'; runId: string; index: number; screenshot: string }
  | { type: 'test.command.retry'; runId: string; index: number; attempt: number; maxAttempts: number; error: string }
  | { type: 'test.command.complete'; runId: string; index: number; result: CommandResult }
  | { type: 'test.run.complete'; runId: string; result: TestRun }
  | { type: 'test.run.error'; runId: string; error: string }
  | { type: 'test.log'; runId: string; message: string; level: 'info' | 'warn' | 'error' }

// ============================================
// API 요청/응답 타입
// ============================================

export interface CreateScenarioRequest {
  projectId: string
  name: string
  description?: string
  yaml: string
}

export interface UpdateScenarioRequest {
  name?: string
  description?: string
  yaml?: string
}

export interface RunTestRequest {
  scenarioId: string
  /** 환경 변수 오버라이드 */
  env?: Record<string, string>
}

export interface TestHistoryRequest {
  scenarioId: string
  limit?: number
  offset?: number
}

// ============================================
// YAML 파서 에러
// ============================================

export interface YamlParseError {
  line?: number
  column?: number
  message: string
}

// ============================================
// 명령어 설명 (UI 표시용)
// ============================================

export function getCommandDescription(cmd: TestCommand): string {
  switch (cmd.command) {
    case 'navigate': return `Navigate to ${cmd.url}`
    case 'back': return 'Go back'
    case 'forward': return 'Go forward'
    case 'reload': return 'Reload page'
    case 'click': return cmd.text ? `Click "${cmd.text}"` : cmd.selector ? `Click ${cmd.selector}` : `Click at (${cmd.x}, ${cmd.y})`
    case 'doubleClick': return cmd.text ? `Double-click "${cmd.text}"` : `Double-click ${cmd.selector}`
    case 'rightClick': return cmd.text ? `Right-click "${cmd.text}"` : `Right-click ${cmd.selector}`
    case 'type': return `Type "${cmd.text.slice(0, 20)}${cmd.text.length > 20 ? '...' : ''}"`
    case 'clear': return `Clear ${cmd.selector}`
    case 'pressKey': return `Press ${cmd.key}`
    case 'scroll': return `Scroll ${cmd.direction || 'down'}`
    case 'scrollTo': return `Scroll to ${cmd.selector}`
    case 'scrollUntilVisible': return cmd.text ? `Scroll until "${cmd.text}" visible` : `Scroll until ${cmd.selector} visible`
    case 'wait': return `Wait ${cmd.ms}ms`
    case 'waitForElement': return cmd.text ? `Wait for "${cmd.text}"` : `Wait for ${cmd.selector}`
    case 'waitForNavigation': return 'Wait for navigation'
    case 'waitForNetwork': return 'Wait for network idle'
    case 'assertVisible': return cmd.text ? `Assert "${cmd.text}" visible` : `Assert ${cmd.selector} visible`
    case 'assertNotVisible': return cmd.text ? `Assert "${cmd.text}" not visible` : `Assert ${cmd.selector} not visible`
    case 'assertText': return `Assert text "${cmd.expected}"`
    case 'assertUrl': return `Assert URL matches "${cmd.pattern}"`
    case 'assertTitle': return `Assert title matches "${cmd.pattern}"`
    case 'assertExists': return `Assert ${cmd.selector} exists`
    case 'assertNotExists': return `Assert ${cmd.selector} not exists`
    case 'assertEnabled': return `Assert ${cmd.selector} enabled`
    case 'assertDisabled': return `Assert ${cmd.selector} disabled`
    case 'assertChecked': return `Assert ${cmd.selector} checked`
    case 'assertNotChecked': return `Assert ${cmd.selector} not checked`
    case 'assertValue': return `Assert value "${cmd.expected}"`
    case 'screenshot': return cmd.name ? `Screenshot "${cmd.name}"` : 'Take screenshot'
    case 'retry': return `Retry ${cmd.maxRetries} times (${cmd.commands.length} commands)`
    case 'repeat': return `Repeat ${cmd.times} times (${cmd.commands.length} commands)`
    case 'hover': return cmd.text ? `Hover "${cmd.text}"` : `Hover ${cmd.selector}`
    case 'focus': return `Focus ${cmd.selector}`
    case 'blur': return 'Blur active element'
    case 'select': return `Select ${cmd.value || cmd.label || `index ${cmd.index}`}`
    case 'uploadFile': return `Upload file to ${cmd.selector}`
    case 'evaluate': return `Execute script`
    case 'log': return `Log: ${cmd.message}`
    default: return 'Unknown command'
  }
}
