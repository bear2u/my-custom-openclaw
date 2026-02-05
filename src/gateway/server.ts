import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { runClaudePty, type PtyRunOptions } from '../claude/pty-runner.js'
import type { Config } from '../config.js'

// WebSocket 프레임 타입
interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { message: string }
}

interface EventFrame {
  type: 'event'
  event: string
  payload?: unknown
}

// chat.send 요청 파라미터
interface ChatSendParams {
  sessionKey: string
  message: string
  timeoutMs?: number
}

// 세션 정보
interface Session {
  sessionId?: string  // Claude CLI 세션 ID (UUID)
  abortController?: AbortController
}

/**
 * 내장 Gateway WebSocket 서버
 * Claude CLI를 WebSocket으로 래핑하여 제공
 */
export class GatewayServer {
  private wss: WebSocketServer | null = null
  private config: Config
  private sessions = new Map<string, Session>()  // sessionKey -> Session
  private clients = new Set<WebSocket>()

  constructor(config: Config) {
    this.config = config
  }

  /**
   * Gateway 서버 시작
   */
  start(): void {
    const port = parseInt(this.config.gatewayUrl.split(':').pop() || '18789', 10)

    this.wss = new WebSocketServer({ port })
    console.log(`[GatewayServer] Started on port ${port}`)

    this.wss.on('connection', (ws) => {
      console.log('[GatewayServer] Client connected')
      this.clients.add(ws)

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString())
      })

      ws.on('close', () => {
        console.log('[GatewayServer] Client disconnected')
        this.clients.delete(ws)
      })

      ws.on('error', (err) => {
        console.error('[GatewayServer] WebSocket error:', err)
        this.clients.delete(ws)
      })
    })

    this.wss.on('error', (err) => {
      console.error('[GatewayServer] Server error:', err)
    })
  }

  /**
   * Gateway 서버 중지
   */
  stop(): void {
    // 모든 진행 중인 요청 취소
    for (const session of this.sessions.values()) {
      session.abortController?.abort()
    }
    this.sessions.clear()

    // 클라이언트 연결 종료
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    // 서버 종료
    this.wss?.close()
    this.wss = null
    console.log('[GatewayServer] Stopped')
  }

  /**
   * 메시지 처리
   */
  private handleMessage(ws: WebSocket, raw: string): void {
    try {
      const parsed = JSON.parse(raw)

      if (parsed.type === 'req') {
        const req = parsed as RequestFrame
        this.handleRequest(ws, req)
      }
    } catch (err) {
      console.error('[GatewayServer] Parse error:', err)
    }
  }

  /**
   * 요청 처리
   */
  private async handleRequest(ws: WebSocket, req: RequestFrame): Promise<void> {
    try {
      switch (req.method) {
        case 'connect':
          this.sendResponse(ws, req.id, true, { protocol: 2 })
          break

        case 'chat.send':
          await this.handleChatSend(ws, req)
          break

        case 'chat.abort':
          this.handleChatAbort(req)
          this.sendResponse(ws, req.id, true, {})
          break

        default:
          this.sendResponse(ws, req.id, false, undefined, { message: `Unknown method: ${req.method}` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.sendResponse(ws, req.id, false, undefined, { message })
    }
  }

  /**
   * chat.send 처리
   */
  private async handleChatSend(ws: WebSocket, req: RequestFrame): Promise<void> {
    const params = req.params as ChatSendParams
    const { sessionKey, message, timeoutMs } = params
    const runId = randomUUID()

    // 세션 가져오기 또는 생성
    let session = this.sessions.get(sessionKey)
    if (!session) {
      session = {}
      this.sessions.set(sessionKey, session)
    }

    // AbortController 설정
    const abortController = new AbortController()
    session.abortController = abortController

    // runId 응답
    this.sendResponse(ws, req.id, true, { runId })

    try {
      const options: PtyRunOptions = {
        message,
        model: this.config.claudeModel,
        sessionId: session.sessionId,
        timeoutMs: timeoutMs ?? this.config.claudeTimeout,
        cwd: this.config.projectPath,
        claudePath: this.config.claudePath,
        signal: abortController.signal,
        chunkInterval: 500,
        onChunk: (_chunk: string, accumulated: string) => {
          // delta 이벤트 전송
          this.sendEvent(ws, 'chat', {
            runId,
            sessionKey,
            seq: 0,
            state: 'delta',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: accumulated }],
            },
          })
        },
      }

      const result = await runClaudePty(options)

      // 세션 ID 저장
      if (result?.sessionId) {
        session.sessionId = result.sessionId
      }

      // final 이벤트 전송
      this.sendEvent(ws, 'chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: result?.text ?? '' }],
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'

      if (message === 'Request cancelled') {
        // aborted 이벤트
        this.sendEvent(ws, 'chat', {
          runId,
          sessionKey,
          seq: 1,
          state: 'aborted',
        })
      } else {
        // error 이벤트
        this.sendEvent(ws, 'chat', {
          runId,
          sessionKey,
          seq: 1,
          state: 'error',
          errorMessage: message,
        })
      }
    } finally {
      session.abortController = undefined
    }
  }

  /**
   * chat.abort 처리
   */
  private handleChatAbort(req: RequestFrame): void {
    const params = req.params as { sessionKey: string }
    const session = this.sessions.get(params.sessionKey)
    session?.abortController?.abort()
  }

  /**
   * 응답 전송
   */
  private sendResponse(
    ws: WebSocket,
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { message: string }
  ): void {
    const frame: ResponseFrame = { type: 'res', id, ok, payload, error }
    ws.send(JSON.stringify(frame))
  }

  /**
   * 이벤트 전송
   */
  private sendEvent(ws: WebSocket, event: string, payload: unknown): void {
    const frame: EventFrame = { type: 'event', event, payload }
    ws.send(JSON.stringify(frame))
  }
}
