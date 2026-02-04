/**
 * Cron Job 시스템 타입 정의
 */

// 스케줄 타입
export type CronSchedule =
  | { kind: 'at'; atMs: number }                    // 일회성 (특정 시간)
  | { kind: 'every'; everyMs: number }              // 반복 (매 N분)
  | { kind: 'cron'; expr: string; tz?: string }     // Cron 표현식

// 페이로드 타입
// - notify: 단순 알림 (Claude 호출 없이 메시지만 전달)
// - agent: AI 응답 (Claude를 통해 응답 생성)
export type CronPayloadKind = 'notify' | 'agent'

export interface CronPayload {
  kind: CronPayloadKind
  message: string       // 알림 메시지 또는 Claude 프롬프트
  model?: string        // agent일 때만 사용 (sonnet, opus 등)
}

// Job 상태
export interface CronJobState {
  nextRunAtMs?: number
  lastRunAtMs?: number
  lastStatus?: 'ok' | 'error'
  lastError?: string
  lastDurationMs?: number
}

// Cron Job
export interface CronJob {
  id: string
  name: string
  enabled: boolean
  deleteAfterRun: boolean
  schedule: CronSchedule
  payload: CronPayload
  slackChannelId: string
  state: CronJobState
  createdAt: number
  updatedAt: number
}

// 생성 입력
export type CronJobCreate = Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'state'> & {
  state?: Partial<CronJobState>
}

// 수정 입력
export type CronJobPatch = Partial<Omit<CronJob, 'id' | 'createdAt' | 'state'>> & {
  state?: Partial<CronJobState>
}

// 서비스 의존성
export interface CronServiceDeps {
  nowMs?: () => number
  sendToSlack: (channelId: string, text: string) => Promise<void>
  runClaude: (options: {
    message: string
    model?: string
    cwd: string
  }) => Promise<{ text: string; sessionId?: string } | null>
  projectPath: string
}

// 서비스 상태 요약
export interface CronStatusSummary {
  enabled: boolean
  jobCount: number
  nextRunAtMs?: number
}

// 실행 결과
export interface CronRunResult {
  ok: boolean
  ran: boolean
  result?: string
  error?: string
}
