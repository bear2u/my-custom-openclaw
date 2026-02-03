import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseCliOutput, type CliOutput } from './parser.js'

export interface RunOptions {
  message: string
  model: string
  sessionId?: string
  timeoutMs?: number
  cwd?: string  // 프로젝트 작업 디렉토리
  claudePath?: string  // Claude CLI 경로 (직접 지정)
  mcpServers?: Record<string, McpServerConfig>  // MCP 서버 설정
  systemPrompt?: string  // 추가 시스템 프롬프트
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

// Claude CLI 경로 해석
function resolveClaudePath(): string {
  // 1. 환경변수에서 직접 지정된 경로
  if (process.env.CLAUDE_CLI_PATH) {
    return process.env.CLAUDE_CLI_PATH
  }

  // 2. 일반적인 설치 경로들
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
      // 경로가 존재하지 않거나 실행 불가
    }
  }

  // 3. which 명령으로 찾기 (alias 제외)
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

  // 4. 기본값 (PATH에서 찾기 시도)
  return `${process.env.HOME}/.claude/local/claude`
}

// 캐시된 경로
let cachedClaudePath: string | null = null

function getClaudePath(): string {
  if (!cachedClaudePath) {
    cachedClaudePath = resolveClaudePath()
    console.log(`[Claude] Using CLI path: ${cachedClaudePath}`)
  }
  return cachedClaudePath
}

// MCP 설정 파일 생성
function createMcpConfigFile(cwd: string, mcpServers?: Record<string, McpServerConfig>): string | null {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return null
  }

  const configDir = join(cwd, '.claude')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  const configPath = join(configDir, 'mcp-servers.json')
  const config = { mcpServers }
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  return configPath
}

export function buildCliArgs(options: RunOptions): string[] {
  const args = [
    '-p',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ]

  // MCP 설정 파일 추가
  if (options.cwd && options.mcpServers) {
    const mcpConfigPath = createMcpConfigFile(options.cwd, options.mcpServers)
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath)
    }
  }

  // 시스템 프롬프트 추가
  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt)
  }

  // 모델은 resume 모드가 아닐 때만 지정
  if (!options.sessionId && options.model) {
    args.push('--model', options.model)
  }

  if (options.sessionId) {
    args.push('--resume', options.sessionId)
  }

  // 메시지는 마지막 인자로 추가 (spawn은 각 인자를 개별 전달하므로 따옴표 불필요)
  args.push(options.message)
  return args
}

export function runClaude(options: RunOptions): Promise<CliOutput | null> {
  return new Promise((resolve, reject) => {
    const claudePath = options.claudePath || getClaudePath()
    const args = buildCliArgs(options)
    const timeoutMs = options.timeoutMs ?? 120000

    const cwd = options.cwd || process.cwd()
    console.log(`[Claude] Running: ${claudePath} ${args.join(' ')}`)
    console.log(`[Claude] Working directory: ${cwd}`)

    // stdin: 'inherit' - Claude CLI가 TTY 감지를 위해 필요
    // stdout/stderr: 'pipe' - 출력 캡처
    const proc = spawn(claudePath, args, {
      cwd,
      env: {
        ...process.env,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    // 타임아웃 설정
    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}. Path: ${claudePath}`))
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (killed) return

      if (code !== 0) {
        const errMsg = stderr || stdout || 'Unknown error'
        reject(new Error(`Claude CLI exited with code ${code}: ${errMsg}`))
        return
      }

      try {
        const result = parseCliOutput(stdout)
        resolve(result)
      } catch (err) {
        reject(new Error(`Failed to parse Claude output: ${err}`))
      }
    })
  })
}

// 스트리밍 옵션
export interface StreamingRunOptions extends RunOptions {
  onChunk?: (chunk: string, accumulated: string) => void  // 청크 콜백
  chunkInterval?: number  // 청크 콜백 최소 간격 (ms, 기본값: 1000)
}

// 스트리밍 CLI 인자 빌드 (--output-format stream-json 사용)
export function buildStreamingCliArgs(options: StreamingRunOptions): string[] {
  const args = [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
  ]

  // MCP 설정 파일 추가
  if (options.cwd && options.mcpServers) {
    const mcpConfigPath = createMcpConfigFile(options.cwd, options.mcpServers)
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath)
    }
  }

  // 시스템 프롬프트 추가
  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt)
  }

  // 모델은 resume 모드가 아닐 때만 지정
  if (!options.sessionId && options.model) {
    args.push('--model', options.model)
  }

  if (options.sessionId) {
    args.push('--resume', options.sessionId)
  }

  // 메시지는 마지막 인자로 추가
  args.push(options.message)
  return args
}

// 스트리밍 JSON 이벤트 타입
interface StreamEvent {
  type: string
  subtype?: string
  session_id?: string
  // assistant 이벤트
  message?: {
    content?: Array<{ type: string; text?: string }>
  }
  // result 이벤트
  result?: string
}

// 스트리밍 모드로 Claude 실행
export function runClaudeStreaming(options: StreamingRunOptions): Promise<CliOutput | null> {
  return new Promise((resolve, reject) => {
    const claudePath = options.claudePath || getClaudePath()
    const args = buildStreamingCliArgs(options)
    const timeoutMs = options.timeoutMs ?? 120000
    const chunkInterval = options.chunkInterval ?? 1000

    const cwd = options.cwd || process.cwd()
    console.log(`[Claude] Running (streaming): ${claudePath} ${args.join(' ')}`)
    console.log(`[Claude] Working directory: ${cwd}`)

    const proc = spawn(claudePath, args, {
      cwd,
      env: {
        ...process.env,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    let stderr = ''
    let killed = false
    let accumulatedText = ''
    let sessionId: string | undefined
    let lastChunkTime = 0

    // 타임아웃 설정
    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n')

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event: StreamEvent = JSON.parse(line)

          // 세션 ID 저장 (system init 또는 다른 이벤트에서)
          if (event.session_id) {
            sessionId = event.session_id
          }

          // assistant 이벤트에서 텍스트 추출
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                accumulatedText = block.text  // 전체 텍스트로 교체 (스트리밍이 아닌 전체 응답)

                // 콜백 호출 (간격 제한)
                const now = Date.now()
                if (options.onChunk && now - lastChunkTime >= chunkInterval) {
                  lastChunkTime = now
                  options.onChunk(block.text, accumulatedText)
                }
              }
            }
          }

          // result 이벤트에서 최종 텍스트 추출
          if (event.type === 'result' && event.result) {
            accumulatedText = event.result
          }
        } catch {
          // JSON 파싱 실패 - 무시
        }
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}. Path: ${claudePath}`))
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (killed) return

      // 마지막 청크 콜백 호출
      if (options.onChunk && accumulatedText) {
        options.onChunk('', accumulatedText)
      }

      if (code !== 0) {
        const errMsg = stderr || accumulatedText || 'Unknown error'
        reject(new Error(`Claude CLI exited with code ${code}: ${errMsg}`))
        return
      }

      // 결과 반환
      resolve({
        text: accumulatedText,
        sessionId,
      })
    })
  })
}
