// @ts-expect-error - @lydell/node-pty has type issues with exports
import * as pty from '@lydell/node-pty'
import { execSync } from 'node:child_process'
import type { CliOutput } from './parser.js'

// PTY 종료 이벤트
interface PtyExitEvent {
  exitCode: number
  signal?: number
}

// 스트리밍 이벤트 타입
interface StreamEvent {
  type: 'system' | 'assistant' | 'result' | 'error'
  subtype?: string
  session_id?: string
  message?: {
    content?: Array<{ type: string; text?: string }>
  }
  result?: string
  error?: string
}

export interface PtyRunOptions {
  message: string
  model: string
  sessionId?: string
  timeoutMs?: number
  cwd?: string
  claudePath?: string
  signal?: AbortSignal
  onChunk?: (chunk: string, accumulated: string) => void
  chunkInterval?: number
}

// Claude CLI 경로 캐시
let cachedClaudePath: string | null = null

function resolveClaudePath(): string {
  if (process.env.CLAUDE_CLI_PATH) {
    return process.env.CLAUDE_CLI_PATH
  }

  const commonPaths = [
    `${process.env.HOME}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]

  for (const p of commonPaths) {
    try {
      execSync(`test -x "${p}"`, { stdio: 'ignore' })
      return p
    } catch {
      // 경로가 존재하지 않음
    }
  }

  try {
    const result = execSync('command -v claude 2>/dev/null || which claude 2>/dev/null', {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim()
    if (result && !result.includes('aliased')) {
      return result
    }
  } catch {
    // which 실패
  }

  return `${process.env.HOME}/.claude/local/claude`
}

function getClaudePath(): string {
  if (!cachedClaudePath) {
    cachedClaudePath = resolveClaudePath()
    console.log(`[PTY] Using Claude CLI path: ${cachedClaudePath}`)
  }
  return cachedClaudePath
}

// UUID 형식 검증
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

// CLI 인자 빌드
function buildPtyArgs(options: PtyRunOptions): string[] {
  const args = [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
  ]

  // 모델은 resume 모드가 아닐 때만 지정
  if (!options.sessionId && options.model) {
    args.push('--model', options.model)
  }

  // 세션 ID가 유효한 UUID 형식인 경우에만 resume 사용
  if (options.sessionId && isValidUUID(options.sessionId)) {
    args.push('--resume', options.sessionId)
  }

  // 메시지는 마지막 인자
  args.push(options.message)
  return args
}

// 스트림 라인 파싱
function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null

  try {
    return JSON.parse(line) as StreamEvent
  } catch {
    return null
  }
}

/**
 * PTY 기반 Claude CLI 실행
 */
export function runClaudePty(options: PtyRunOptions): Promise<CliOutput | null> {
  return new Promise((resolve, reject) => {
    const claudePath = options.claudePath || getClaudePath()
    const args = buildPtyArgs(options)
    const timeoutMs = options.timeoutMs ?? 120000
    const chunkInterval = options.chunkInterval ?? 1000
    const cwd = options.cwd || process.cwd()

    console.log(`[PTY] Running: ${claudePath} ${args.join(' ')}`)
    console.log(`[PTY] Working directory: ${cwd}`)

    // PTY로 프로세스 시작
    const ptyProcess = pty.spawn(claudePath, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        IS_SANDBOX: '1',
      },
    })

    let buffer = ''
    let accumulatedText = ''
    let sessionId: string | undefined
    let lastChunkTime = 0
    let killed = false

    // 타임아웃 설정
    const timer = setTimeout(() => {
      killed = true
      ptyProcess.kill()
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    // AbortSignal 처리
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (!killed) {
          killed = true
          clearTimeout(timer)
          ptyProcess.kill()
          reject(new Error('Request cancelled'))
        }
      }, { once: true })
    }

    // 출력 수신
    ptyProcess.onData((data: string) => {
      buffer += data

      // 완성된 라인 처리
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''  // 마지막 불완전한 라인 보관

      for (const line of lines) {
        const event = parseStreamLine(line)
        if (!event) continue

        // 세션 ID 추출
        if (event.session_id) {
          sessionId = event.session_id
        }

        // 텍스트 추출
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              accumulatedText = block.text  // 누적 텍스트로 교체

              // 콜백 호출 (간격 제한)
              const now = Date.now()
              if (options.onChunk && now - lastChunkTime >= chunkInterval) {
                lastChunkTime = now
                options.onChunk(block.text, accumulatedText)
              }
            }
          }
        }

        // 최종 결과
        if (event.type === 'result') {
          accumulatedText = event.result || accumulatedText
        }

        // 에러 처리
        if (event.type === 'error') {
          reject(new Error(event.error || 'Unknown error from Claude CLI'))
          return
        }
      }
    })

    // 종료 이벤트
    ptyProcess.onExit((e: PtyExitEvent) => {
      clearTimeout(timer)
      if (killed) return

      // 마지막 청크 콜백 호출
      if (options.onChunk && accumulatedText) {
        options.onChunk('', accumulatedText)
      }

      if (e.exitCode !== 0) {
        reject(new Error(`Claude CLI exited with code ${e.exitCode}`))
        return
      }

      resolve({
        text: accumulatedText,
        sessionId,
      })
    })
  })
}
