/**
 * Cron MCP Server
 * Claude가 크론 작업을 자연어로 조작할 수 있게 해주는 MCP 서버
 *
 * 주의: 이 MCP 서버는 별도 프로세스로 실행되므로 DB 직접 접근 대신
 * 메인 프로세스의 REST API를 통해 통신합니다.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// REST API 기본 URL (메인 프로세스)
const API_BASE = process.env.CRON_API_URL || 'http://localhost:4900'

// API 호출 헬퍼
async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error (${response.status}): ${error}`)
  }
  return response.json() as Promise<T>
}

// 크론 작업 타입 (API 응답)
interface CronJob {
  id: string
  jobNumber: number
  name: string
  enabled: boolean
  schedule: {
    kind: 'at' | 'every' | 'cron'
    atMs?: number
    everyMs?: number
    expr?: string
  }
  payload: {
    kind: 'notify' | 'agent'
    message: string
  }
  slackChannelId: string
  state: {
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastStatus?: string
  }
}

// 크론 작업 포맷팅
function formatCronJob(job: CronJob) {
  let scheduleStr = ''
  switch (job.schedule.kind) {
    case 'at':
      scheduleStr = `일회성: ${new Date(job.schedule.atMs!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
      break
    case 'every':
      const mins = Math.floor(job.schedule.everyMs! / 60000)
      scheduleStr = mins >= 60 ? `${Math.floor(mins / 60)}시간마다` : `${mins}분마다`
      break
    case 'cron':
      scheduleStr = `cron: ${job.schedule.expr}`
      break
  }

  return {
    번호: job.jobNumber,
    이름: job.name,
    스케줄: scheduleStr,
    타입: job.payload.kind === 'notify' ? '알림' : 'AI 실행',
    메시지: job.payload.message,
    활성화: job.enabled,
  }
}

// MCP 서버 생성
const server = new McpServer({
  name: 'slack-connector-cron',
  version: '1.0.0',
})

// Tool: 크론 목록 조회
server.tool(
  'cron_list',
  '등록된 크론 작업 목록을 조회합니다',
  {},
  async () => {
    try {
      const { jobs } = await apiCall<{ jobs: CronJob[] }>('GET', '/api/cron')

      if (jobs.length === 0) {
        return {
          content: [{ type: 'text', text: '[MCP] 등록된 크론 작업이 없습니다.' }],
        }
      }

      const formatted = jobs.map(formatCronJob)
      return {
        content: [{
          type: 'text',
          text: `[MCP] 크론 작업 목록 (${jobs.length}개):\n\n${JSON.stringify(formatted, null, 2)}`,
        }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// Tool: 크론 삭제 (번호)
server.tool(
  'cron_delete',
  '크론 작업을 삭제합니다. 번호 또는 "all"로 전체 삭제',
  {
    target: z.union([z.number(), z.literal('all')]).describe('삭제할 작업 번호 또는 "all"'),
  },
  async ({ target }) => {
    try {
      if (target === 'all') {
        const result = await apiCall<{ removedCount: number }>('DELETE', '/api/cron')
        return {
          content: [{ type: 'text', text: `[MCP] 모든 크론 작업 삭제됨 (${result.removedCount}개)` }],
        }
      }

      const result = await apiCall<{ ok: boolean; removed: boolean; jobName?: string }>('DELETE', `/api/cron/${target}`)
      if (!result.removed) {
        return {
          content: [{ type: 'text', text: `[MCP] ${target}번 크론 작업을 찾을 수 없습니다.` }],
        }
      }

      return {
        content: [{ type: 'text', text: `[MCP] ${target}번 크론 작업 "${result.jobName}" 삭제됨` }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// Tool: 크론 상태
server.tool(
  'cron_status',
  '크론 서비스 상태를 확인합니다',
  {},
  async () => {
    try {
      const status = await apiCall<{ enabled: boolean; jobCount: number; nextRunAtMs?: number }>('GET', '/api/cron/status')

      const formatted = {
        활성_작업_수: status.jobCount,
        다음_실행: status.nextRunAtMs
          ? new Date(status.nextRunAtMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
          : '없음',
      }

      return {
        content: [{ type: 'text', text: `[MCP] 크론 상태:\n${JSON.stringify(formatted, null, 2)}` }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// Tool: 크론 추가
server.tool(
  'cron_add',
  '새로운 크론 작업을 추가합니다',
  {
    name: z.string().describe('작업 이름'),
    schedule_type: z.enum(['at', 'every', 'cron']).describe('스케줄 타입'),
    schedule_value: z.string().describe('at: ISO 날짜/시간, every: 밀리초, cron: cron 표현식'),
    message: z.string().describe('실행할 메시지/프롬프트'),
    payload_type: z.enum(['notify', 'agent']).default('agent').describe('notify: 알림만, agent: Claude 실행'),
    slack_channel: z.string().describe('결과를 보낼 Slack 채널 ID'),
    one_time: z.boolean().default(false).describe('일회성 작업 여부'),
  },
  async ({ name, schedule_type, schedule_value, message, payload_type, slack_channel, one_time }) => {
    try {
      const { job } = await apiCall<{ job: CronJob }>('POST', '/api/cron', {
        name,
        schedule_type,
        schedule_value,
        message,
        payload_type,
        slack_channel,
        one_time,
      })

      return {
        content: [{
          type: 'text',
          text: `[MCP] 크론 작업 추가됨:\n번호: ${job.jobNumber}\n이름: ${name}\n타입: ${payload_type}`,
        }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// Tool: 크론 즉시 실행
server.tool(
  'cron_run',
  '크론 작업을 즉시 실행합니다',
  {
    job_number: z.number().describe('실행할 작업 번호'),
  },
  async ({ job_number }) => {
    try {
      const result = await apiCall<{ ok: boolean; ran: boolean; result?: string; error?: string }>(
        'POST',
        `/api/cron/${job_number}/run`
      )

      if (!result.ran) {
        return {
          content: [{ type: 'text', text: `[MCP] ${job_number}번 작업을 찾을 수 없습니다.` }],
        }
      }

      if (result.ok) {
        return {
          content: [{ type: 'text', text: `[MCP] ${job_number}번 작업 실행 완료\n\n결과:\n${result.result || '(없음)'}` }],
        }
      } else {
        return {
          content: [{ type: 'text', text: `[MCP] ${job_number}번 작업 실행 실패: ${result.error}` }],
        }
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// Tool: 대화 검색
server.tool(
  'conversation_search',
  '과거 대화 내용을 검색합니다. 사용자가 이전에 논의했던 내용을 찾을 때 사용하세요.',
  {
    query: z.string().describe('검색할 키워드나 문장'),
    session_id: z.string().optional().describe('특정 세션(채널)으로 제한 (선택)'),
    limit: z.number().default(5).describe('최대 결과 수 (기본: 5)'),
  },
  async ({ query, session_id, limit }) => {
    try {
      const params = new URLSearchParams({ q: query, limit: String(limit) })
      if (session_id) {
        params.set('session_id', session_id)
      }

      const result = await apiCall<{
        query: string
        count: number
        results: Array<{
          id: string
          sessionId: string
          role: string
          content: string
          timestamp: number
          date: string
          rank: number
        }>
      }>('GET', `/api/messages/search?${params.toString()}`)

      if (result.count === 0) {
        return {
          content: [{ type: 'text', text: `[MCP] "${query}" 검색 결과가 없습니다.` }],
        }
      }

      const formatted = result.results.map((r, i) => ({
        순번: i + 1,
        역할: r.role === 'user' ? '사용자' : 'AI',
        내용: r.content.length > 200 ? r.content.slice(0, 200) + '...' : r.content,
        날짜: new Date(r.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      }))

      return {
        content: [{
          type: 'text',
          text: `[MCP] "${query}" 검색 결과 (${result.count}개):\n\n${JSON.stringify(formatted, null, 2)}`,
        }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `[MCP] 검색 오류: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
)

// 서버 시작
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Cron MCP Server started (REST API mode)')
  console.error(`[MCP] API Base: ${API_BASE}`)
}

main().catch(console.error)
