import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import type { CliOutput } from './parser.js'

export interface GatewayRunnerOptions {
  url: string
  token?: string
}

export interface GatewayRunOptions {
  message: string
  sessionKey: string
  model?: string
  timeoutMs?: number
  signal?: AbortSignal
  onChunk?: (chunk: string, accumulated: string) => void
  chunkInterval?: number
}

// chat.send 요청 파라미터
interface ChatSendParams {
  sessionKey: string
  message: string
  thinking?: string
  timeoutMs?: number
  idempotencyKey: string
}

// chat 이벤트 구조
interface ChatEvent {
  runId: string
  sessionKey: string
  seq: number
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: {
    role: string
    content: Array<{ type: string; text?: string }>
  }
  errorMessage?: string
}

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

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

/**
 * OpenClaw Gateway WebSocket 클라이언트
 * chat.send 메서드를 통해 Claude와 통신
 */
export class GatewayRunner {
  private ws: WebSocket | null = null
  private opts: GatewayRunnerOptions
  private pending = new Map<string, Pending>()
  private connected = false
  private connectPromise: Promise<void> | null = null
  private eventHandlers = new Map<string, (evt: ChatEvent) => void>()

  constructor(opts: GatewayRunnerOptions) {
    this.opts = opts
  }

  /**
   * Gateway 서버에 연결
   */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const url = this.opts.url
      console.log(`[GatewayRunner] Connecting to ${url}`)

      this.ws = new WebSocket(url, {
        maxPayload: 25 * 1024 * 1024,
      })

      const timeout = setTimeout(() => {
        reject(new Error('Gateway connection timeout'))
        this.ws?.close()
      }, 10000)

      this.ws.on('open', () => {
        console.log('[GatewayRunner] WebSocket connected, sending connect request')
        // connect 요청 전송
        this.sendConnect()
          .then(() => {
            clearTimeout(timeout)
            this.connected = true
            this.connectPromise = null
            console.log('[GatewayRunner] Connected successfully')
            resolve()
          })
          .catch((err) => {
            clearTimeout(timeout)
            this.connectPromise = null
            reject(err)
          })
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[GatewayRunner] WebSocket closed: ${code} ${reason}`)
        this.connected = false
        this.connectPromise = null
        this.flushPendingErrors(new Error(`Gateway closed: ${code}`))
      })

      this.ws.on('error', (err) => {
        console.error('[GatewayRunner] WebSocket error:', err)
        clearTimeout(timeout)
        this.connectPromise = null
        reject(err)
      })
    })

    return this.connectPromise
  }

  /**
   * connect 메서드 호출
   */
  private async sendConnect(): Promise<void> {
    const params = {
      minProtocol: 2,
      maxProtocol: 2,
      client: {
        id: 'slack-connector',
        displayName: 'Slack Connector',
        version: '1.0.0',
        platform: process.platform,
        mode: 'backend',
      },
      caps: [],
      auth: this.opts.token ? { token: this.opts.token } : undefined,
      role: 'operator',
      scopes: ['operator.admin'],
    }

    await this.request('connect', params)
  }

  /**
   * 메시지 처리
   */
  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw)

      // 이벤트 프레임 (chat 이벤트 등)
      if (parsed.type === 'event') {
        const evt = parsed as EventFrame

        // chat 이벤트 처리
        if (evt.event === 'chat') {
          const chatEvt = evt.payload as ChatEvent
          const handler = this.eventHandlers.get(chatEvt.runId)
          if (handler) {
            handler(chatEvt)
          }
        }
        return
      }

      // 응답 프레임
      if (parsed.type === 'res') {
        const res = parsed as ResponseFrame
        const pending = this.pending.get(res.id)
        if (!pending) return

        this.pending.delete(res.id)
        if (res.ok) {
          pending.resolve(res.payload)
        } else {
          pending.reject(new Error(res.error?.message ?? 'Unknown error'))
        }
      }
    } catch (err) {
      console.error('[GatewayRunner] Parse error:', err)
    }
  }

  /**
   * 요청 전송
   */
  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway not connected')
    }

    const id = randomUUID()
    const frame: RequestFrame = { type: 'req', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.ws!.send(JSON.stringify(frame))
    })
  }

  /**
   * 대기 중인 요청들에 에러 전파
   */
  private flushPendingErrors(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err)
    }
    this.pending.clear()
  }

  /**
   * Claude 실행 (스트리밍)
   */
  async run(options: GatewayRunOptions): Promise<CliOutput | null> {
    await this.connect()

    const {
      message,
      sessionKey,
      timeoutMs = 120000,
      signal,
      onChunk,
      chunkInterval = 1000,
    } = options

    const idempotencyKey = randomUUID()
    let accumulatedText = ''
    let lastChunkTime = 0
    let runId: string | null = null

    return new Promise((resolve, reject) => {
      // 타임아웃 설정
      const timer = setTimeout(() => {
        if (runId) {
          this.eventHandlers.delete(runId)
        }
        reject(new Error(`Gateway request timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      // AbortSignal 처리
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          if (runId) {
            this.eventHandlers.delete(runId)
            // chat.abort 요청
            this.request('chat.abort', { sessionKey, runId }).catch(() => {})
          }
          reject(new Error('Request cancelled'))
        }, { once: true })
      }

      // chat 이벤트 핸들러 등록 (runId는 응답에서 받음)
      const handleChatEvent = (evt: ChatEvent) => {
        if (!runId) {
          runId = evt.runId
        }

        if (evt.state === 'delta' && evt.message?.content) {
          // 텍스트 추출
          for (const block of evt.message.content) {
            if (block.type === 'text' && block.text) {
              accumulatedText = block.text

              // 콜백 호출 (간격 제한)
              const now = Date.now()
              if (onChunk && now - lastChunkTime >= chunkInterval) {
                lastChunkTime = now
                onChunk(block.text, accumulatedText)
              }
            }
          }
        } else if (evt.state === 'final') {
          clearTimeout(timer)
          this.eventHandlers.delete(evt.runId)

          // 최종 텍스트 추출
          if (evt.message?.content) {
            for (const block of evt.message.content) {
              if (block.type === 'text' && block.text) {
                accumulatedText = block.text
              }
            }
          }

          // 마지막 청크 콜백
          if (onChunk && accumulatedText) {
            onChunk('', accumulatedText)
          }

          resolve({
            text: accumulatedText,
            sessionId: sessionKey,
          })
        } else if (evt.state === 'error') {
          clearTimeout(timer)
          this.eventHandlers.delete(evt.runId)
          reject(new Error(evt.errorMessage ?? 'Unknown error'))
        } else if (evt.state === 'aborted') {
          clearTimeout(timer)
          this.eventHandlers.delete(evt.runId)
          reject(new Error('Request aborted'))
        }
      }

      // chat.send 요청
      const params: ChatSendParams = {
        sessionKey,
        message,
        timeoutMs,
        idempotencyKey,
      }

      this.request<{ runId: string }>('chat.send', params)
        .then((result) => {
          runId = result.runId
          this.eventHandlers.set(runId, handleChatEvent)
          console.log(`[GatewayRunner] chat.send started, runId: ${runId}`)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  /**
   * 연결 종료
   */
  stop(): void {
    this.connected = false
    this.ws?.close()
    this.ws = null
    this.flushPendingErrors(new Error('Gateway runner stopped'))
  }
}
