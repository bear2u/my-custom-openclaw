import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createHandlers, type RpcRequest, type RpcResponse, type EventMessage } from './handlers.js'
import type { SessionManager } from '../session/manager.js'
import type { Config } from '../config.js'
import type { CronService } from '../cron/index.js'
import { chatDb } from '../db/database.js'

export interface WebSocketClient {
  id: string
  ws: WebSocket
  sessionId?: string
}

export interface GatewayServer {
  wss: WebSocketServer
  httpServer: HttpServer
  clients: Map<string, WebSocketClient>
  broadcast: (event: string, data: unknown) => void
  sendToClient: (clientId: string, message: RpcResponse | EventMessage) => void
  start: () => void
  stop: () => void
}

/**
 * HTTP REST API 핸들러
 */
function createHttpHandler(cronService?: CronService) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // CORS 헤더
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const pathname = url.pathname

    // JSON 응답 헬퍼
    const json = (data: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    // Body 파싱 헬퍼
    const parseBody = async (): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {})
          } catch {
            reject(new Error('Invalid JSON'))
          }
        })
        req.on('error', reject)
      })
    }

    try {
      // 크론 API 라우팅
      if (pathname.startsWith('/api/cron')) {
        if (!cronService) {
          return json({ error: 'Cron service not available' }, 503)
        }

        // GET /api/cron - 목록 조회
        if (req.method === 'GET' && pathname === '/api/cron') {
          const jobs = await cronService.list({ includeDisabled: true })
          return json({ jobs })
        }

        // GET /api/cron/status - 상태 조회
        if (req.method === 'GET' && pathname === '/api/cron/status') {
          const status = cronService.status()
          return json(status)
        }

        // DELETE /api/cron - 전체 삭제
        if (req.method === 'DELETE' && pathname === '/api/cron') {
          const result = await cronService.removeAll()
          return json(result)
        }

        // DELETE /api/cron/:number - 번호로 삭제
        const deleteMatch = pathname.match(/^\/api\/cron\/(\d+)$/)
        if (req.method === 'DELETE' && deleteMatch) {
          const jobNumber = parseInt(deleteMatch[1], 10)
          const result = await cronService.removeByNumber(jobNumber)
          return json(result)
        }

        // POST /api/cron - 새 작업 추가
        if (req.method === 'POST' && pathname === '/api/cron') {
          const body = await parseBody() as {
            name: string
            schedule_type: 'at' | 'every' | 'cron'
            schedule_value: string
            message: string
            payload_type?: 'notify' | 'agent'
            slack_channel: string
            one_time?: boolean
          }

          // 스케줄 변환
          let schedule: { kind: 'at'; atMs: number } | { kind: 'every'; everyMs: number } | { kind: 'cron'; expr: string }
          switch (body.schedule_type) {
            case 'at':
              schedule = { kind: 'at', atMs: new Date(body.schedule_value).getTime() }
              break
            case 'every':
              schedule = { kind: 'every', everyMs: parseInt(body.schedule_value) }
              break
            case 'cron':
              schedule = { kind: 'cron', expr: body.schedule_value }
              break
          }

          const job = await cronService.add({
            name: body.name,
            enabled: true,
            deleteAfterRun: body.one_time ?? false,
            schedule,
            payload: {
              kind: body.payload_type ?? 'agent',
              message: body.message,
            },
            slackChannelId: body.slack_channel,
          })

          return json({ job })
        }

        // POST /api/cron/:number/run - 즉시 실행
        const runMatch = pathname.match(/^\/api\/cron\/(\d+)\/run$/)
        if (req.method === 'POST' && runMatch) {
          const jobNumber = parseInt(runMatch[1], 10)
          const result = await cronService.runByNumber(jobNumber)
          return json(result)
        }

        return json({ error: 'Not found' }, 404)
      }

      // 메시지 검색 API
      if (pathname === '/api/messages/search' && req.method === 'GET') {
        const query = url.searchParams.get('q') || ''
        const sessionId = url.searchParams.get('session_id') || undefined
        const limit = parseInt(url.searchParams.get('limit') || '10', 10)

        if (!query.trim()) {
          return json({ error: 'Query parameter "q" is required' }, 400)
        }

        const results = chatDb.searchMessages({
          query: query.trim(),
          sessionId,
          limit: Math.min(limit, 50), // 최대 50개 제한
        })

        return json({
          query,
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            sessionId: r.session_id,
            role: r.role,
            content: r.content,
            timestamp: r.timestamp,
            date: new Date(r.timestamp).toISOString(),
            rank: r.rank,
          })),
        })
      }

      // 헬스 체크
      if (pathname === '/health') {
        return json({ status: 'ok' })
      }

      return json({ error: 'Not found' }, 404)
    } catch (err) {
      console.error('[HTTP] Error:', err)
      return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
    }
  }
}

export function createGatewayServer(
  port: number,
  config: Config,
  sessions: SessionManager,
  cronService?: CronService
): GatewayServer {
  // HTTP 서버 생성 (REST API용)
  const httpServer = createServer(createHttpHandler(cronService))

  // WebSocket 서버를 HTTP 서버에 붙임
  const wss = new WebSocketServer({ server: httpServer })
  const clients = new Map<string, WebSocketClient>()
  const handlers = createHandlers(config, sessions, cronService)

  const sendToClient = (clientId: string, message: RpcResponse | EventMessage) => {
    const client = clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message))
    }
  }

  const broadcast = (event: string, data: unknown) => {
    const message: EventMessage = { event, data }
    const payload = JSON.stringify(message)
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload)
      }
    }
  }

  const handleMessage = async (client: WebSocketClient, raw: string) => {
    let request: RpcRequest
    try {
      request = JSON.parse(raw) as RpcRequest
    } catch {
      sendToClient(client.id, {
        id: '',
        ok: false,
        error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      })
      return
    }

    const { id, method, params } = request
    const handler = handlers[method]

    if (!handler) {
      sendToClient(client.id, {
        id,
        ok: false,
        error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${method}` },
      })
      return
    }

    try {
      const result = await handler(params, client, {
        sendEvent: (event, data) => sendToClient(client.id, { event, data }),
        broadcast,
      })
      sendToClient(client.id, { id, ok: true, result })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      sendToClient(client.id, {
        id,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: error.message },
      })
    }
  }

  wss.on('connection', (ws) => {
    const clientId = randomUUID()
    const client: WebSocketClient = { id: clientId, ws }
    clients.set(clientId, client)

    console.log(`[WS] Client connected: ${clientId}`)

    sendToClient(clientId, {
      event: 'connected',
      data: { clientId },
    })

    ws.on('message', (data) => {
      handleMessage(client, String(data))
    })

    ws.on('close', () => {
      clients.delete(clientId)
      console.log(`[WS] Client disconnected: ${clientId}`)
    })

    ws.on('error', (err) => {
      console.error(`[WS] Client error (${clientId}):`, err)
    })
  })

  return {
    wss,
    httpServer,
    clients,
    broadcast,
    sendToClient,
    start: () => {
      httpServer.listen(port, () => {
        console.log(`[WS] Gateway server listening on port ${port}`)
        console.log(`[HTTP] REST API available at http://localhost:${port}/api/cron`)
      })
    },
    stop: () => {
      for (const client of clients.values()) {
        client.ws.close()
      }
      wss.close()
      httpServer.close()
    },
  }
}
