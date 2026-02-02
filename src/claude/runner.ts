import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { parseCliOutput, type CliOutput } from './parser.js'

export interface RunOptions {
  message: string
  model: string
  sessionId?: string
  timeoutMs?: number
  cwd?: string  // 프로젝트 작업 디렉토리
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

export function buildCliArgs(options: RunOptions): string[] {
  const args = [
    '-p',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ]

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
    const claudePath = getClaudePath()
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
