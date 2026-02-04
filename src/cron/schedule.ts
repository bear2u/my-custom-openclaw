/**
 * 스케줄 계산 모듈
 * croner 라이브러리를 사용하여 다음 실행 시간을 계산
 */

import { Cron } from 'croner'
import type { CronSchedule } from './types.js'

/**
 * 다음 실행 시간 계산
 * @param schedule 스케줄 정보
 * @param nowMs 현재 시간 (ms)
 * @returns 다음 실행 시간 (ms) 또는 undefined (일회성 작업이 이미 지난 경우)
 */
export function computeNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number
): number | undefined {
  switch (schedule.kind) {
    case 'at':
      // 일회성: 아직 미래 시간이면 해당 시간, 이미 지났으면 undefined
      return schedule.atMs > nowMs ? schedule.atMs : undefined

    case 'every':
      // 반복: 현재 시간 + 간격
      return nowMs + schedule.everyMs

    case 'cron': {
      // Cron 표현식: croner로 다음 실행 시간 계산
      try {
        const cron = new Cron(schedule.expr, {
          timezone: schedule.tz || 'Asia/Seoul',
        })
        const next = cron.nextRun()
        return next ? next.getTime() : undefined
      } catch (err) {
        console.error('[Schedule] Invalid cron expression:', schedule.expr, err)
        return undefined
      }
    }

    default:
      return undefined
  }
}

/**
 * 스케줄이 일회성인지 확인
 */
export function isOneTimeSchedule(schedule: CronSchedule): boolean {
  return schedule.kind === 'at'
}

/**
 * 스케줄을 사람이 읽기 쉬운 형태로 변환
 */
export function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case 'at': {
      const date = new Date(schedule.atMs)
      return formatDateTime(date)
    }

    case 'every': {
      const minutes = Math.floor(schedule.everyMs / 60000)
      const hours = Math.floor(minutes / 60)
      const days = Math.floor(hours / 24)

      if (days > 0) return `매 ${days}일`
      if (hours > 0) return `매 ${hours}시간`
      return `매 ${minutes}분`
    }

    case 'cron': {
      // 간단한 cron 표현식 해석
      return formatCronExpression(schedule.expr, schedule.tz)
    }

    default:
      return '알 수 없음'
  }
}

/**
 * 날짜/시간을 한국어 형식으로 포맷
 */
function formatDateTime(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  // 상대 시간 (1일 이내)
  if (diffDays === 0) {
    if (diffHours > 0) {
      return `${diffHours}시간 후`
    }
    if (diffMinutes > 0) {
      return `${diffMinutes}분 후`
    }
    return '곧'
  }

  // 절대 시간
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()

  const ampm = hours < 12 ? '오전' : '오후'
  const hour12 = hours % 12 || 12

  if (year === now.getFullYear()) {
    return `${month}/${day} ${ampm} ${hour12}:${minutes.toString().padStart(2, '0')}`
  }

  return `${year}/${month}/${day} ${ampm} ${hour12}:${minutes.toString().padStart(2, '0')}`
}

/**
 * Cron 표현식을 한국어로 해석
 */
function formatCronExpression(expr: string, tz?: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return `크론: ${expr}`
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // 매일 특정 시간
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (hour !== '*' && minute !== '*') {
      const h = parseInt(hour)
      const m = parseInt(minute)
      const ampm = h < 12 ? '오전' : '오후'
      const hour12 = h % 12 || 12
      return `매일 ${ampm} ${hour12}:${m.toString().padStart(2, '0')}`
    }
  }

  // 매주 특정 요일
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    const dayName = days[parseInt(dayOfWeek)] || dayOfWeek
    if (hour !== '*' && minute !== '*') {
      const h = parseInt(hour)
      const m = parseInt(minute)
      const ampm = h < 12 ? '오전' : '오후'
      const hour12 = h % 12 || 12
      return `매주 ${dayName}요일 ${ampm} ${hour12}:${m.toString().padStart(2, '0')}`
    }
    return `매주 ${dayName}요일`
  }

  return `크론: ${expr}${tz ? ` (${tz})` : ''}`
}
