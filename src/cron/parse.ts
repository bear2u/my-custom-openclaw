/**
 * 자연어 파싱 모듈
 * 사용자의 자연어 입력을 CronSchedule로 변환
 *
 * 지원 패턴:
 * - "20분 후에 ..." → { kind: 'at', atMs }
 * - "2시간 후에 ..." → { kind: 'at', atMs }
 * - "내일 오후 3시에 ..." → { kind: 'at', atMs }
 * - "다음주 월요일에 ..." → { kind: 'at', atMs }
 * - "매일 9시에 ..." → { kind: 'cron', expr }
 * - "매주 월요일 아침에 ..." → { kind: 'cron', expr }
 * - "매 30분마다 ..." → { kind: 'every', everyMs }
 */

import type { CronSchedule } from './types.js'

// 시간대 매핑
const PERIOD_HOURS: Record<string, number> = {
  '새벽': 5,
  '아침': 9,
  '오전': 10,
  '점심': 12,
  '오후': 14,
  '저녁': 18,
  '밤': 21,
}

// 요일 매핑 (일=0, 월=1, ...)
const DAY_OF_WEEK: Record<string, number> = {
  '일': 0,
  '월': 1,
  '화': 2,
  '수': 3,
  '목': 4,
  '금': 5,
  '토': 6,
}

export interface ParsedCronRequest {
  name: string
  message: string
  schedule: CronSchedule
  deleteAfterRun: boolean
}

/**
 * 자연어 텍스트에서 크론 요청 파싱
 */
export function parseCronRequest(text: string): ParsedCronRequest | null {
  const normalized = text.trim()

  // 1. 반복 패턴 체크 (매일, 매주, 매 N분)
  const repeatResult = parseRepeatPattern(normalized)
  if (repeatResult) return repeatResult

  // 2. 일회성 패턴 체크 (N분 후, 내일 3시)
  const oneTimeResult = parseOneTimePattern(normalized)
  if (oneTimeResult) return oneTimeResult

  return null
}

/**
 * 반복 패턴 파싱 (매일, 매주, 매 N분)
 */
function parseRepeatPattern(text: string): ParsedCronRequest | null {
  // 매 N분/시간마다
  const everyMatch = text.match(/매\s*(\d+)?\s*(분|시간)(?:마다)?/i)
  if (everyMatch) {
    const num = parseInt(everyMatch[1] || '1')
    const unit = everyMatch[2]
    const everyMs = unit === '시간' ? num * 60 * 60 * 1000 : num * 60 * 1000
    const message = extractMessage(text)

    return {
      name: message.slice(0, 20) || '반복 작업',
      message,
      schedule: { kind: 'every', everyMs },
      deleteAfterRun: false,
    }
  }

  // 매일 + 시간
  const dailyMatch = text.match(/매일\s*(.*?)(?:에|마다)?(?:\s|$)/i)
  if (dailyMatch) {
    const timeStr = dailyMatch[1]
    const { hour, minute } = parseTimeExpression(timeStr)
    const message = extractMessage(text)

    return {
      name: message.slice(0, 20) || '매일 작업',
      message,
      schedule: { kind: 'cron', expr: `${minute} ${hour} * * *`, tz: 'Asia/Seoul' },
      deleteAfterRun: false,
    }
  }

  // 매주 + 요일 + 시간
  const weeklyMatch = text.match(/매주\s*(월|화|수|목|금|토|일)?요일?\s*(.*?)(?:에|마다)?(?:\s|$)/i)
  if (weeklyMatch) {
    const dayStr = weeklyMatch[1] || '월'
    const timeStr = weeklyMatch[2]
    const dayNum = DAY_OF_WEEK[dayStr] ?? 1
    const { hour, minute } = parseTimeExpression(timeStr)
    const message = extractMessage(text)

    return {
      name: message.slice(0, 20) || `매주 ${dayStr}요일 작업`,
      message,
      schedule: { kind: 'cron', expr: `${minute} ${hour} * * ${dayNum}`, tz: 'Asia/Seoul' },
      deleteAfterRun: false,
    }
  }

  return null
}

/**
 * 일회성 패턴 파싱 (N분 후, 내일 3시)
 */
function parseOneTimePattern(text: string): ParsedCronRequest | null {
  const now = new Date()

  // N분/시간/일 후
  const relativeMatch = text.match(/(\d+)\s*(분|시간|일)\s*후/i)
  if (relativeMatch) {
    const num = parseInt(relativeMatch[1])
    const unit = relativeMatch[2]
    let deltaMs = 0

    switch (unit) {
      case '분':
        deltaMs = num * 60 * 1000
        break
      case '시간':
        deltaMs = num * 60 * 60 * 1000
        break
      case '일':
        deltaMs = num * 24 * 60 * 60 * 1000
        break
    }

    const message = extractMessage(text)
    return {
      name: message.slice(0, 20) || '예약 작업',
      message,
      schedule: { kind: 'at', atMs: now.getTime() + deltaMs },
      deleteAfterRun: true,
    }
  }

  // 오늘/내일/모레 + 시간
  const dayMatch = text.match(/(오늘|내일|모레|다음주)\s*(.*?)(?:에)?(?:\s|$)/i)
  if (dayMatch) {
    const dayStr = dayMatch[1]
    const timeStr = dayMatch[2]
    let targetDate = new Date(now)

    switch (dayStr) {
      case '오늘':
        break
      case '내일':
        targetDate.setDate(targetDate.getDate() + 1)
        break
      case '모레':
        targetDate.setDate(targetDate.getDate() + 2)
        break
      case '다음주':
        targetDate.setDate(targetDate.getDate() + 7)
        break
    }

    const { hour, minute } = parseTimeExpression(timeStr)
    targetDate.setHours(hour, minute, 0, 0)

    // 이미 지난 시간이면 내일로
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1)
    }

    const message = extractMessage(text)
    return {
      name: message.slice(0, 20) || '예약 작업',
      message,
      schedule: { kind: 'at', atMs: targetDate.getTime() },
      deleteAfterRun: true,
    }
  }

  // 다음주 + 요일 + 시간
  const nextWeekDayMatch = text.match(/다음\s*(?:주)?\s*(월|화|수|목|금|토|일)요일?\s*(.*?)(?:에)?(?:\s|$)/i)
  if (nextWeekDayMatch) {
    const dayStr = nextWeekDayMatch[1]
    const timeStr = nextWeekDayMatch[2]
    const targetDayNum = DAY_OF_WEEK[dayStr] ?? 1
    const currentDayNum = now.getDay()

    let daysToAdd = targetDayNum - currentDayNum
    if (daysToAdd <= 0) daysToAdd += 7
    daysToAdd += 7 // 다음 주

    const targetDate = new Date(now)
    targetDate.setDate(targetDate.getDate() + daysToAdd)

    const { hour, minute } = parseTimeExpression(timeStr)
    targetDate.setHours(hour, minute, 0, 0)

    const message = extractMessage(text)
    return {
      name: message.slice(0, 20) || '예약 작업',
      message,
      schedule: { kind: 'at', atMs: targetDate.getTime() },
      deleteAfterRun: true,
    }
  }

  // 오전/오후 N시 (오늘 또는 내일)
  const timeOnlyMatch = text.match(/(오전|오후)?\s*(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/i)
  if (timeOnlyMatch) {
    const { hour, minute } = parseTimeExpression(text)
    const targetDate = new Date(now)
    targetDate.setHours(hour, minute, 0, 0)

    // 이미 지난 시간이면 내일로
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1)
    }

    const message = extractMessage(text)
    return {
      name: message.slice(0, 20) || '예약 작업',
      message,
      schedule: { kind: 'at', atMs: targetDate.getTime() },
      deleteAfterRun: true,
    }
  }

  return null
}

/**
 * 시간 표현 파싱
 */
function parseTimeExpression(text: string): { hour: number; minute: number } {
  // 기본값
  let hour = 9
  let minute = 0

  // 시간대 (아침, 저녁 등)
  for (const [period, h] of Object.entries(PERIOD_HOURS)) {
    if (text.includes(period)) {
      hour = h
      break
    }
  }

  // 오전/오후 + 시간
  const ampmMatch = text.match(/(오전|오후)?\s*(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/i)
  if (ampmMatch) {
    const ampm = ampmMatch[1]
    let h = parseInt(ampmMatch[2])
    const m = ampmMatch[3] ? parseInt(ampmMatch[3]) : 0

    if (ampm === '오후' && h < 12) h += 12
    if (ampm === '오전' && h === 12) h = 0

    hour = h
    minute = m
  }

  return { hour, minute }
}

/**
 * 텍스트에서 메시지 추출
 * 따옴표로 감싸진 부분 또는 동사(~해줘, ~알려줘) 앞의 내용
 */
function extractMessage(text: string): string {
  // 따옴표로 감싸진 내용
  const quoteMatch = text.match(/["""''](.+?)["""'']/i)
  if (quoteMatch) {
    return quoteMatch[1].trim()
  }

  // 동사 패턴 앞의 내용
  const verbMatch = text.match(/(?:에|후에?)\s*(.+?)\s*(?:해줘|알려줘|보내줘|알림|해)/i)
  if (verbMatch) {
    return verbMatch[1].trim()
  }

  // 시간 표현 이후의 내용
  const afterTimeMatch = text.match(/(?:후에?|에|마다)\s+(.+)/i)
  if (afterTimeMatch) {
    let msg = afterTimeMatch[1].trim()
    // 끝의 동사 제거
    msg = msg.replace(/\s*(해줘|알려줘|보내줘|해)$/, '')
    return msg.trim()
  }

  return text.trim()
}

/**
 * 크론 명령어인지 확인
 */
export function isCronRequest(text: string): boolean {
  const keywords = ['크론', 'cron', '스케줄', '예약', '알림', '리마인더']
  const patterns = [
    /\d+\s*(분|시간|일)\s*후/,
    /매(일|주)\s/,
    /매\s*\d+\s*(분|시간)/,
    /(오늘|내일|모레|다음주)/,
    /크론\s*(목록|추가|삭제|실행|상태)/,
  ]

  const lower = text.toLowerCase()

  // 키워드 확인
  if (keywords.some(k => lower.includes(k))) return true

  // 패턴 확인
  if (patterns.some(p => p.test(text))) return true

  return false
}

/**
 * 크론 관리 명령어 파싱
 */
export function parseCronManageCommand(text: string): {
  action: 'list' | 'delete' | 'run' | 'status' | null
  jobId?: string
} {
  const lower = text.toLowerCase()

  // 목록
  if (/크론\s*(목록|리스트|list)/i.test(text) || lower === '크론') {
    return { action: 'list' }
  }

  // 상태
  if (/크론\s*(상태|status)/i.test(text)) {
    return { action: 'status' }
  }

  // 삭제
  const deleteMatch = text.match(/크론\s*(삭제|제거|delete|remove)\s*(\w+)/i)
  if (deleteMatch) {
    return { action: 'delete', jobId: deleteMatch[2] }
  }

  // 실행
  const runMatch = text.match(/크론\s*(실행|run)\s*(\w+)/i)
  if (runMatch) {
    return { action: 'run', jobId: runMatch[2] }
  }

  return { action: null }
}
