export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
}

export interface RpcRequest {
  id: string
  method: string
  params?: unknown
}

export interface RpcResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export interface EventMessage {
  event: string
  data: unknown
}

export interface ChatSendResult {
  sessionId: string
  text: string
}

export interface ChatDeltaData {
  sessionId: string
  text: string
}

export interface ChatDoneData {
  sessionId: string
  text: string
}

export interface ChatErrorData {
  sessionId: string
  error: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface ChatSession {
  id: string
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface DbMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// 프로젝트 설정 관련 타입
export interface ClaudeMdInfo {
  exists: boolean
  content: string
  path: string
}

export interface PlanMdInfo {
  exists: boolean
  content: string
  path: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  content: string
}

export interface AgentInfo {
  name: string
  description: string
  path: string
  content: string
  model?: string
  tools?: string[]
}

// Kanban Board 타입
export interface KanbanTask {
  id: string
  project_id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  position: number
  created_at: number
  updated_at: number
}

// Slack 설정 타입
export interface SlackConfig {
  enabled: boolean
  botToken: string
  appToken: string
}

// Browser Relay 상태 타입
export interface BrowserTarget {
  sessionId: string
  targetId: string
  targetInfo: {
    targetId: string
    type?: string
    title?: string
    url?: string
    attached?: boolean
  }
}

export interface BrowserStatus {
  connected: boolean
  extensionConnected: boolean
  targets: BrowserTarget[]
  activeTargetId?: string
  relayRunning: boolean
}

// 테스트 시나리오 타입 (YAML 기반 Maestro 스타일)
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

// 테스트 명령어 타입 (주요 명령어들)
export type TestCommand =
  | { command: 'navigate'; url: string }
  | { command: 'back' }
  | { command: 'forward' }
  | { command: 'reload' }
  | { command: 'click'; selector?: string; text?: string; x?: number; y?: number; optional?: boolean }
  | { command: 'type'; text: string; selector?: string }
  | { command: 'clear'; selector: string }
  | { command: 'pressKey'; key: string }
  | { command: 'scroll'; direction?: 'up' | 'down' | 'left' | 'right'; distance?: number }
  | { command: 'scrollTo'; selector: string }
  | { command: 'wait'; ms: number }
  | { command: 'waitForElement'; selector?: string; text?: string; timeout?: number }
  | { command: 'assertVisible'; selector?: string; text?: string }
  | { command: 'assertNotVisible'; selector?: string; text?: string }
  | { command: 'assertText'; selector: string; expected: string }
  | { command: 'assertUrl'; pattern: string }
  | { command: 'assertTitle'; pattern: string }
  | { command: 'assertExists'; selector: string }
  | { command: 'screenshot'; name?: string }
  | { command: 'log'; message: string }
  | { command: string; [key: string]: unknown }

// 명령어 실행 결과
export interface CommandResult {
  index: number
  command: TestCommand
  status: CommandStatus
  startedAt: number
  finishedAt?: number
  duration?: number
  attempts: number
  screenshot?: string
  error?: string
  warning?: string
}

export type CommandStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'warned'

// 테스트 실행 결과
export interface TestRun {
  id: string
  scenarioId: string
  status: TestRunStatus
  startedAt: number
  finishedAt?: number
  commands: CommandResult[]
  error?: string
  duration?: number
  summary?: {
    total: number
    passed: number
    failed: number
    skipped: number
    warned: number
  }
}

export type TestRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'stopped'

// 테스트 이벤트 타입
export interface TestRunStartEvent {
  type: 'test.run.start'
  runId: string
  scenarioId: string
  totalCommands: number
}

export interface TestCommandStartEvent {
  type: 'test.command.start'
  runId: string
  index: number
  command: TestCommand
}

export interface TestCommandScreenshotEvent {
  type: 'test.command.screenshot'
  runId: string
  index: number
  screenshot: string
}

export interface TestCommandRetryEvent {
  type: 'test.command.retry'
  runId: string
  index: number
  attempt: number
  maxAttempts: number
  error: string
}

export interface TestCommandCompleteEvent {
  type: 'test.command.complete'
  runId: string
  index: number
  result: CommandResult
}

export interface TestRunCompleteEvent {
  type: 'test.run.complete'
  runId: string
  result: TestRun
}

export interface TestRunErrorEvent {
  type: 'test.run.error'
  runId: string
  error: string
}

export type TestEvent =
  | TestRunStartEvent
  | TestCommandStartEvent
  | TestCommandScreenshotEvent
  | TestCommandRetryEvent
  | TestCommandCompleteEvent
  | TestRunCompleteEvent
  | TestRunErrorEvent
