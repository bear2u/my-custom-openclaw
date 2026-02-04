/**
 * CronService - 크론 작업 스케줄러 서비스
 * OpenClaw의 패턴을 적용: armTimer + executeJob
 */

import { chatDb, type DbCronJob } from '../db/database.js'
import { computeNextRunAtMs, formatSchedule, isOneTimeSchedule } from './schedule.js'
import type {
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronSchedule,
  CronServiceDeps,
  CronStatusSummary,
  CronRunResult,
} from './types.js'

// setTimeout 최대값 (약 24.8일)
const MAX_TIMEOUT_MS = 2 ** 31 - 1

function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * DB 레코드를 CronJob 타입으로 변환
 */
function dbToCronJob(db: DbCronJob): CronJob {
  let schedule: CronSchedule
  switch (db.schedule_kind) {
    case 'at':
      schedule = { kind: 'at', atMs: db.schedule_at_ms! }
      break
    case 'every':
      schedule = { kind: 'every', everyMs: db.schedule_every_ms! }
      break
    case 'cron':
      schedule = { kind: 'cron', expr: db.schedule_cron_expr!, tz: db.schedule_tz || undefined }
      break
  }

  return {
    id: db.id,
    name: db.name,
    enabled: db.enabled === 1,
    deleteAfterRun: db.delete_after_run === 1,
    schedule,
    payload: {
      kind: 'agentTurn',
      message: db.payload_message,
      model: db.payload_model || undefined,
    },
    slackChannelId: db.slack_channel_id,
    state: {
      nextRunAtMs: db.next_run_at_ms || undefined,
      lastRunAtMs: db.last_run_at_ms || undefined,
      lastStatus: db.last_status || undefined,
      lastError: db.last_error || undefined,
      lastDurationMs: db.last_duration_ms || undefined,
    },
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  }
}

export class CronService {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private deps: CronServiceDeps & { nowMs: () => number }

  constructor(deps: CronServiceDeps) {
    this.deps = {
      ...deps,
      nowMs: deps.nowMs || (() => Date.now()),
    }
  }

  /**
   * 서비스 시작
   */
  async start(): Promise<void> {
    console.log('[CronService] Starting...')

    // 모든 작업의 다음 실행 시간 재계산
    const jobs = this.listInternal(true)
    for (const job of jobs) {
      if (job.enabled) {
        const nextRunAtMs = computeNextRunAtMs(job.schedule, this.deps.nowMs())
        chatDb.updateCronJob(job.id, { nextRunAtMs: nextRunAtMs || null })
      }
    }

    // 타이머 설정
    this.armTimer()
    console.log(`[CronService] Started with ${jobs.length} jobs`)
  }

  /**
   * 서비스 중지
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.log('[CronService] Stopped')
  }

  /**
   * 작업 목록 조회
   */
  async list(opts?: { includeDisabled?: boolean }): Promise<CronJob[]> {
    return this.listInternal(opts?.includeDisabled)
  }

  private listInternal(includeDisabled = false): CronJob[] {
    const dbJobs = chatDb.getCronJobs(includeDisabled)
    return dbJobs.map(dbToCronJob)
  }

  /**
   * 작업 추가
   */
  async add(input: CronJobCreate): Promise<CronJob> {
    const id = generateId()
    const now = this.deps.nowMs()

    // 다음 실행 시간 계산
    const nextRunAtMs = input.enabled !== false
      ? computeNextRunAtMs(input.schedule, now)
      : undefined

    // DB에 저장
    chatDb.createCronJob({
      id,
      name: input.name,
      enabled: input.enabled !== false,
      deleteAfterRun: input.deleteAfterRun || false,
      scheduleKind: input.schedule.kind,
      scheduleAtMs: input.schedule.kind === 'at' ? input.schedule.atMs : undefined,
      scheduleEveryMs: input.schedule.kind === 'every' ? input.schedule.everyMs : undefined,
      scheduleCronExpr: input.schedule.kind === 'cron' ? input.schedule.expr : undefined,
      scheduleTz: input.schedule.kind === 'cron' ? input.schedule.tz : undefined,
      payloadMessage: input.payload.message,
      payloadModel: input.payload.model,
      slackChannelId: input.slackChannelId,
      nextRunAtMs,
    })

    // 타이머 재설정
    this.armTimer()

    console.log(`[CronService] Added job: ${id} (${input.name})`)

    const dbJob = chatDb.getCronJob(id)
    return dbToCronJob(dbJob!)
  }

  /**
   * 작업 수정
   */
  async update(id: string, patch: CronJobPatch): Promise<CronJob | undefined> {
    const existing = chatDb.getCronJob(id)
    if (!existing) return undefined

    const updates: Parameters<typeof chatDb.updateCronJob>[1] = {}

    if (patch.name !== undefined) updates.name = patch.name
    if (patch.enabled !== undefined) updates.enabled = patch.enabled
    if (patch.deleteAfterRun !== undefined) updates.deleteAfterRun = patch.deleteAfterRun
    if (patch.slackChannelId !== undefined) updates.slackChannelId = patch.slackChannelId

    if (patch.schedule) {
      updates.scheduleKind = patch.schedule.kind
      updates.scheduleAtMs = patch.schedule.kind === 'at' ? patch.schedule.atMs : null
      updates.scheduleEveryMs = patch.schedule.kind === 'every' ? patch.schedule.everyMs : null
      updates.scheduleCronExpr = patch.schedule.kind === 'cron' ? patch.schedule.expr : null
      updates.scheduleTz = patch.schedule.kind === 'cron' ? patch.schedule.tz || null : null
    }

    if (patch.payload) {
      updates.payloadMessage = patch.payload.message
      updates.payloadModel = patch.payload.model || null
    }

    // 다음 실행 시간 재계산
    const enabled = patch.enabled ?? (existing.enabled === 1)
    if (enabled) {
      const schedule = patch.schedule || dbToCronJob(existing).schedule
      updates.nextRunAtMs = computeNextRunAtMs(schedule, this.deps.nowMs()) || null
    } else {
      updates.nextRunAtMs = null
    }

    const updated = chatDb.updateCronJob(id, updates)
    if (!updated) return undefined

    // 타이머 재설정
    this.armTimer()

    console.log(`[CronService] Updated job: ${id}`)
    return dbToCronJob(updated)
  }

  /**
   * 작업 삭제
   */
  async remove(id: string): Promise<{ ok: boolean; removed: boolean }> {
    const removed = chatDb.deleteCronJob(id)

    if (removed) {
      this.armTimer()
      console.log(`[CronService] Removed job: ${id}`)
    }

    return { ok: true, removed }
  }

  /**
   * 작업 즉시 실행
   */
  async run(id: string): Promise<CronRunResult> {
    const dbJob = chatDb.getCronJob(id)
    if (!dbJob) {
      return { ok: false, ran: false, error: 'Job not found' }
    }

    const job = dbToCronJob(dbJob)
    return this.executeJob(job, { forced: true })
  }

  /**
   * 상태 요약
   */
  status(): CronStatusSummary {
    const jobs = this.listInternal(false)
    const nextJob = jobs.find(j => j.state.nextRunAtMs)

    return {
      enabled: true,
      jobCount: jobs.length,
      nextRunAtMs: nextJob?.state.nextRunAtMs,
    }
  }

  /**
   * 타이머 설정 (OpenClaw armTimer 패턴)
   */
  private armTimer(): void {
    // 기존 타이머 해제
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // 가장 빠른 실행 시간 찾기
    const jobs = this.listInternal(false)
    const now = this.deps.nowMs()

    let nearestMs: number | undefined
    for (const job of jobs) {
      if (job.state.nextRunAtMs && job.state.nextRunAtMs > now) {
        if (!nearestMs || job.state.nextRunAtMs < nearestMs) {
          nearestMs = job.state.nextRunAtMs
        }
      }
    }

    if (!nearestMs) {
      console.log('[CronService] No upcoming jobs')
      return
    }

    // 타이머 설정 (MAX_TIMEOUT_MS 제한)
    const delayMs = Math.min(nearestMs - now, MAX_TIMEOUT_MS)
    console.log(`[CronService] Next job in ${Math.round(delayMs / 1000)}s`)

    this.timer = setTimeout(() => this.onTimer(), delayMs)
    this.timer.unref() // 프로세스 종료 방지하지 않음
  }

  /**
   * 타이머 콜백
   */
  private async onTimer(): Promise<void> {
    if (this.running) {
      console.log('[CronService] Already running, skipping')
      this.armTimer()
      return
    }

    this.running = true

    try {
      await this.runDueJobs()
    } finally {
      this.running = false
      this.armTimer()
    }
  }

  /**
   * 실행 시간이 된 작업들 실행
   */
  private async runDueJobs(): Promise<void> {
    const jobs = this.listInternal(false)
    const now = this.deps.nowMs()

    for (const job of jobs) {
      if (job.state.nextRunAtMs && job.state.nextRunAtMs <= now) {
        console.log(`[CronService] Running due job: ${job.id} (${job.name})`)
        await this.executeJob(job, { forced: false })
      }
    }
  }

  /**
   * 작업 실행
   */
  private async executeJob(
    job: CronJob,
    opts: { forced: boolean }
  ): Promise<CronRunResult> {
    const startMs = this.deps.nowMs()
    console.log(`[CronService] Executing job: ${job.id} (${job.name})${opts.forced ? ' (forced)' : ''}`)

    try {
      // Claude 실행
      const result = await this.deps.runClaude({
        message: job.payload.message,
        model: job.payload.model,
        cwd: this.deps.projectPath,
      })

      const durationMs = this.deps.nowMs() - startMs

      if (result?.text) {
        // Slack으로 결과 전송
        const scheduleInfo = formatSchedule(job.schedule)
        const header = `⏰ *[${job.name}]* (${scheduleInfo})\n\n`
        await this.deps.sendToSlack(job.slackChannelId, header + result.text)

        // 상태 업데이트
        const isOneTime = isOneTimeSchedule(job.schedule)
        const nextRunAtMs = isOneTime
          ? null
          : computeNextRunAtMs(job.schedule, this.deps.nowMs()) || null

        chatDb.updateCronJob(job.id, {
          lastRunAtMs: startMs,
          lastStatus: 'ok',
          lastError: null,
          lastDurationMs: durationMs,
          nextRunAtMs,
        })

        // 일회성 + deleteAfterRun이면 삭제
        if (isOneTime && job.deleteAfterRun) {
          chatDb.deleteCronJob(job.id)
          console.log(`[CronService] Deleted one-time job: ${job.id}`)
        }

        console.log(`[CronService] Job completed: ${job.id} (${durationMs}ms)`)
        return { ok: true, ran: true, result: result.text }
      } else {
        throw new Error('No response from Claude')
      }
    } catch (err) {
      const durationMs = this.deps.nowMs() - startMs
      const errorMessage = err instanceof Error ? err.message : String(err)

      console.error(`[CronService] Job failed: ${job.id}`, err)

      // 상태 업데이트
      const nextRunAtMs = isOneTimeSchedule(job.schedule)
        ? null
        : computeNextRunAtMs(job.schedule, this.deps.nowMs()) || null

      chatDb.updateCronJob(job.id, {
        lastRunAtMs: startMs,
        lastStatus: 'error',
        lastError: errorMessage,
        lastDurationMs: durationMs,
        nextRunAtMs,
      })

      // 실패 알림
      await this.deps.sendToSlack(
        job.slackChannelId,
        `❌ *[${job.name}]* 실행 실패\n\`\`\`${errorMessage}\`\`\``
      )

      return { ok: false, ran: true, error: errorMessage }
    }
  }
}
