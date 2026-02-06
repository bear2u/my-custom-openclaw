#!/usr/bin/env node

import { chatDb } from '../src/db/database.js'

const CHANNEL_ID = 'C0AB414R0Q6'

// 해당 채널의 모든 크론 작업 조회 (비활성화된 것도 포함)
const jobs = chatDb.getCronJobs(true).filter(job => job.slack_channel_id === CHANNEL_ID)

console.log(`\n📋 채널 ${CHANNEL_ID}의 크론 작업 목록 (총 ${jobs.length}개)\n`)

if (jobs.length === 0) {
  console.log('등록된 크론 작업이 없습니다.')
} else {
  jobs.forEach(job => {
    const enabled = job.enabled === 1
    const kind = job.payload_kind
    const status = job.last_status

    // 스케줄 정보 포맷
    let schedule = ''
    if (job.schedule_kind === 'at') {
      const date = new Date(job.schedule_at_ms!)
      schedule = `한 번 (${date.toLocaleString('ko-KR')})`
    } else if (job.schedule_kind === 'every') {
      const hours = job.schedule_every_ms! / (60 * 60 * 1000)
      const minutes = (job.schedule_every_ms! % (60 * 60 * 1000)) / (60 * 1000)
      if (hours >= 1) {
        schedule = `${hours}시간마다`
      } else {
        schedule = `${minutes}분마다`
      }
    } else if (job.schedule_kind === 'cron') {
      schedule = `크론: ${job.schedule_cron_expr} (${job.schedule_tz || 'UTC'})`
    }

    // 다음 실행 시간
    let nextRun = '-'
    if (job.next_run_at_ms && enabled) {
      const nextDate = new Date(job.next_run_at_ms)
      const now = Date.now()
      const diffMs = job.next_run_at_ms - now
      const diffMin = Math.round(diffMs / (60 * 1000))
      const diffHour = Math.round(diffMs / (60 * 60 * 1000))

      if (diffMs < 0) {
        nextRun = `${nextDate.toLocaleString('ko-KR')} (지남)`
      } else if (diffMin < 60) {
        nextRun = `${nextDate.toLocaleString('ko-KR')} (약 ${diffMin}분 후)`
      } else {
        nextRun = `${nextDate.toLocaleString('ko-KR')} (약 ${diffHour}시간 후)`
      }
    }

    // 마지막 실행 정보
    let lastRun = '-'
    if (job.last_run_at_ms) {
      const lastDate = new Date(job.last_run_at_ms)
      const statusEmoji = status === 'ok' ? '✅' : status === 'error' ? '❌' : '❓'
      lastRun = `${lastDate.toLocaleString('ko-KR')} ${statusEmoji}`
      if (status === 'error' && job.last_error) {
        lastRun += `\n     오류: ${job.last_error.substring(0, 50)}...`
      }
    }

    const statusIcon = enabled ? '✅' : '⏸️'
    const kindIcon = kind === 'notify' ? '🔔' : '🤖'

    console.log(`${job.job_number}. ${statusIcon} ${kindIcon} ${job.name}`)
    console.log(`   스케줄: ${schedule}`)
    console.log(`   메시지: ${job.payload_message.substring(0, 60)}${job.payload_message.length > 60 ? '...' : ''}`)
    console.log(`   다음 실행: ${nextRun}`)
    console.log(`   마지막 실행: ${lastRun}`)
    console.log('')
  })
}

chatDb.close()
