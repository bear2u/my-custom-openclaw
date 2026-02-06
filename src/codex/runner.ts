// @ts-expect-error - @lydell/node-pty has type issues with exports
import * as pty from '@lydell/node-pty'
import type { CliOutput } from '../claude/parser.js'
import type { ClaudeRunner, StreamingRunOptions } from '../claude/runner.js'
import type { Config } from '../config.js'
import { parseCodexJsonl } from './parser.js'

interface PtyExitEvent {
  exitCode: number
  signal?: number
}

export interface CodexRunOptions {
  message: string
  model?: string
  sessionId?: string
  timeoutMs?: number
  cwd?: string
  codexPath?: string
  sandbox?: string
  signal?: AbortSignal
  onChunk?: (chunk: string, accumulated: string) => void
  chunkInterval?: number
}

export function buildCodexArgs(options: CodexRunOptions): string[] {
  const isResume = Boolean(options.sessionId)

  if (isResume) {
    const args = [
      'exec', 'resume', options.sessionId!,
      '--json', '--skip-git-repo-check',
    ]
    // resume 모드에서는 -C 플래그 미지원
    args.push(options.message)
    return args
  }

  const args = ['exec', '--json']

  if (options.sandbox === 'full-auto') {
    args.push('--full-auto')
  } else if (options.sandbox) {
    args.push('--sandbox', options.sandbox)
  }

  args.push('--skip-git-repo-check')

  if (options.model) {
    args.push('-m', options.model)
  }

  if (options.cwd) {
    args.push('-C', options.cwd)
  }

  args.push(options.message)
  return args
}

export function runCodexPty(options: CodexRunOptions): Promise<CliOutput | null> {
  return new Promise((resolve, reject) => {
    const codexPath = options.codexPath || 'codex'
    const args = buildCodexArgs(options)
    const timeoutMs = options.timeoutMs ?? 120000
    const chunkInterval = options.chunkInterval ?? 1000
    const cwd = options.cwd || process.cwd()

    console.log(`[Codex PTY] Running: ${codexPath} ${args.join(' ')}`)
    console.log(`[Codex PTY] Working directory: ${cwd}`)

    const ptyProcess = pty.spawn(codexPath, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    })

    let buffer = ''
    let fullOutput = ''
    let accumulatedText = ''
    let sessionId: string | undefined
    let lastChunkTime = 0
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      ptyProcess.kill()
      reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

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

    ptyProcess.onData((data: string) => {
      buffer += data
      fullOutput += data

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const event = JSON.parse(trimmed)

          if (event.thread_id) {
            sessionId = event.thread_id
          }

          if (event.type === 'item.completed' && event.item) {
            if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
              accumulatedText += (accumulatedText ? '\n' : '') + event.item.text

              const now = Date.now()
              if (options.onChunk && now - lastChunkTime >= chunkInterval) {
                lastChunkTime = now
                options.onChunk(event.item.text, accumulatedText)
              }
            }
          }
        } catch {
          // JSON 파싱 실패 - ANSI 코드 등 무시
        }
      }
    })

    ptyProcess.onExit((e: PtyExitEvent) => {
      clearTimeout(timer)
      if (killed) return

      if (options.onChunk && accumulatedText) {
        options.onChunk('', accumulatedText)
      }

      // PTY에서 실시간 파싱이 안 됐을 경우 전체 출력을 다시 파싱
      if (!accumulatedText && fullOutput) {
        const parsed = parseCodexJsonl(fullOutput)
        if (parsed) {
          resolve(parsed)
          return
        }
      }

      if (e.exitCode !== 0 && !accumulatedText) {
        reject(new Error(`Codex CLI exited with code ${e.exitCode}`))
        return
      }

      resolve({
        text: accumulatedText,
        sessionId,
      })
    })
  })
}

export class CodexRunner implements ClaudeRunner {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  async run(options: StreamingRunOptions): Promise<CliOutput | null> {
    return runCodexPty({
      message: options.message,
      model: options.model || this.config.codexModel || undefined,
      sessionId: options.sessionId,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd || this.config.projectPath,
      codexPath: this.config.codexPath,
      sandbox: this.config.codexSandbox,
      signal: options.signal,
      onChunk: options.onChunk,
      chunkInterval: options.chunkInterval,
    })
  }
}
