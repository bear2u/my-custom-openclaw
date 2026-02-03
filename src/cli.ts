#!/usr/bin/env node
import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import prompts from 'prompts'

interface EnvConfig {
  ENABLE_SLACK: string
  SLACK_BOT_TOKEN: string
  SLACK_APP_TOKEN: string
  PROJECT_PATH: string
  CLAUDE_PATH: string
  CLAUDE_MODEL: string
  CLAUDE_TIMEOUT_MS: string
  WS_PORT: string
  BROWSER_MODE: string
  BROWSER_RELAY_PORT: string
}

function parseEnvFile(envPath: string): EnvConfig {
  const content = readFileSync(envPath, 'utf-8')
  const config: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      if (key) {
        config[key.trim()] = valueParts.join('=').trim()
      }
    }
  }

  return {
    ENABLE_SLACK: config.ENABLE_SLACK || 'false',
    SLACK_BOT_TOKEN: config.SLACK_BOT_TOKEN || '',
    SLACK_APP_TOKEN: config.SLACK_APP_TOKEN || '',
    PROJECT_PATH: config.PROJECT_PATH || '',
    CLAUDE_PATH: config.CLAUDE_PATH || 'claude',
    CLAUDE_MODEL: config.CLAUDE_MODEL || 'sonnet',
    CLAUDE_TIMEOUT_MS: config.CLAUDE_TIMEOUT_MS || '120000',
    WS_PORT: config.WS_PORT || '4900',
    BROWSER_MODE: config.BROWSER_MODE || 'off',
    BROWSER_RELAY_PORT: config.BROWSER_RELAY_PORT || '18792',
  }
}

function maskToken(token: string): string {
  if (!token || token.length < 10) return token ? '****' : '(미설정)'
  return token.substring(0, 8) + '...' + token.substring(token.length - 4)
}

function generateEnvContent(config: EnvConfig): string {
  return `# Slack Integration
ENABLE_SLACK=${config.ENABLE_SLACK}
SLACK_BOT_TOKEN=${config.SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${config.SLACK_APP_TOKEN}

# Project Settings (single project mode)
PROJECT_PATH=${config.PROJECT_PATH}
CLAUDE_PATH=${config.CLAUDE_PATH}

# Claude Settings
CLAUDE_MODEL=${config.CLAUDE_MODEL}
CLAUDE_TIMEOUT_MS=${config.CLAUDE_TIMEOUT_MS}

# WebSocket Gateway Port
WS_PORT=${config.WS_PORT}

# Browser Mode (off | puppeteer | relay)
BROWSER_MODE=${config.BROWSER_MODE}
BROWSER_RELAY_PORT=${config.BROWSER_RELAY_PORT}
`
}

const args = process.argv.slice(2)
const command = args[0]

// Claude CLI 경로 찾기
function findClaudePath(): string | null {
  // 일반적인 설치 경로들
  const commonPaths = [
    `${process.env.HOME}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]

  for (const p of commonPaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // which 명령으로 찾기
  try {
    const result = execSync('which claude 2>/dev/null', {
      encoding: 'utf-8',
      shell: '/bin/bash',
    }).trim()

    // alias인 경우 실제 경로 추출
    if (result.includes('aliased to')) {
      const match = result.match(/aliased to (.+)/)
      if (match) return match[1]
    }

    if (result && existsSync(result)) {
      return result
    }
  } catch {
    // which 실패
  }

  return null
}

async function init() {
  const cwd = process.cwd()
  const envPath = join(cwd, '.env')

  console.log('')
  console.log('🚀 Slack-Claude Gateway 설정을 시작합니다.')
  console.log('')

  // 기존 .env 파일 확인
  if (existsSync(envPath)) {
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: '.env 파일이 이미 존재합니다. 덮어쓰시겠습니까?',
      initial: false,
    })

    if (!overwrite) {
      console.log('설정이 취소되었습니다.')
      return
    }
  }

  // Claude CLI 경로 찾기
  console.log('Claude CLI 경로를 찾는 중...')
  let claudePath = findClaudePath()

  if (claudePath) {
    console.log(`✓ Claude CLI 발견: ${claudePath}`)
  } else {
    const { manualPath } = await prompts({
      type: 'text',
      name: 'manualPath',
      message: 'Claude CLI를 찾을 수 없습니다. 경로를 직접 입력하세요:',
      validate: (value) => existsSync(value) ? true : '파일이 존재하지 않습니다.',
    })
    claudePath = manualPath
  }

  if (!claudePath) {
    console.log('Claude CLI 경로가 필요합니다. 설정이 취소되었습니다.')
    return
  }

  // 프로젝트 경로
  const { projectPath } = await prompts({
    type: 'text',
    name: 'projectPath',
    message: '작업할 프로젝트 경로를 입력하세요:',
    initial: cwd,
    validate: (value) => existsSync(value) ? true : '디렉토리가 존재하지 않습니다.',
  })

  if (!projectPath) {
    console.log('설정이 취소되었습니다.')
    return
  }

  // Slack 설정
  console.log('')
  console.log('Slack 연동을 설정합니다.')
  console.log('(Slack App 설정: https://api.slack.com/apps)')
  console.log('')

  const { enableSlack } = await prompts({
    type: 'confirm',
    name: 'enableSlack',
    message: 'Slack 연동을 활성화하시겠습니까?',
    initial: true,
  })

  let slackBotToken = ''
  let slackAppToken = ''

  if (enableSlack) {
    const slackTokens = await prompts([
      {
        type: 'password',
        name: 'botToken',
        message: 'Slack Bot Token (xoxb-...)을 입력하세요:',
        validate: (value) => value.startsWith('xoxb-') ? true : 'xoxb-로 시작해야 합니다.',
      },
      {
        type: 'password',
        name: 'appToken',
        message: 'Slack App Token (xapp-...)을 입력하세요:',
        validate: (value) => value.startsWith('xapp-') ? true : 'xapp-로 시작해야 합니다.',
      },
    ])

    slackBotToken = slackTokens.botToken || ''
    slackAppToken = slackTokens.appToken || ''

    if (!slackBotToken || !slackAppToken) {
      console.log('Slack 토큰이 입력되지 않아 Slack 연동이 비활성화됩니다.')
    }
  }

  // .env 파일 생성
  const envContent = `# Slack Integration
ENABLE_SLACK=${enableSlack && slackBotToken && slackAppToken ? 'true' : 'false'}
SLACK_BOT_TOKEN=${slackBotToken}
SLACK_APP_TOKEN=${slackAppToken}

# Project Settings (single project mode)
PROJECT_PATH=${projectPath}
CLAUDE_PATH=${claudePath}

# Claude Settings
CLAUDE_MODEL=sonnet
CLAUDE_TIMEOUT_MS=120000

# WebSocket Gateway Port
WS_PORT=4900

# Browser Mode (off | puppeteer | relay)
BROWSER_MODE=off
BROWSER_RELAY_PORT=18792
`

  await writeFile(envPath, envContent)

  console.log('')
  console.log('✓ 설정이 완료되었습니다!')
  console.log('')
  console.log('설정 내용:')
  console.log(`  - Claude CLI: ${claudePath}`)
  console.log(`  - 프로젝트 경로: ${projectPath}`)
  console.log(`  - Slack 연동: ${enableSlack && slackBotToken ? '활성화' : '비활성화'}`)
  console.log('')

  // 바로 시작할지 물어보기
  const { startNow } = await prompts({
    type: 'confirm',
    name: 'startNow',
    message: '지금 게이트웨이를 시작하시겠습니까?',
    initial: true,
  })

  if (startNow) {
    console.log('')
    console.log('게이트웨이를 시작합니다...')
    console.log('')
    await start()
  } else {
    console.log('')
    console.log('나중에 시작하려면:')
    console.log('  npx slack-claude-gateway start')
    console.log('')
  }
}

async function start() {
  // .env 파일 확인
  const cwd = process.cwd()
  const envPath = join(cwd, '.env')

  if (!existsSync(envPath)) {
    console.log('.env 파일이 없습니다. 먼저 설정을 진행합니다.')
    console.log('')
    await init()
    return
  }

  // 동적으로 메인 모듈 import
  await import('./index.js')
}

async function showConfig() {
  const cwd = process.cwd()
  const envPath = join(cwd, '.env')

  if (!existsSync(envPath)) {
    console.log('.env 파일이 없습니다.')
    console.log('먼저 `npx slack-claude-gateway init`을 실행하세요.')
    return
  }

  const config = parseEnvFile(envPath)

  console.log('')
  console.log('📋 현재 설정')
  console.log('─'.repeat(50))
  console.log(`  Claude CLI 경로:    ${config.CLAUDE_PATH}`)
  console.log(`  프로젝트 경로:      ${config.PROJECT_PATH}`)
  console.log(`  Claude 모델:        ${config.CLAUDE_MODEL}`)
  console.log('─'.repeat(50))
  console.log(`  Slack 연동:         ${config.ENABLE_SLACK === 'true' ? '활성화' : '비활성화'}`)
  console.log(`  Bot Token:          ${maskToken(config.SLACK_BOT_TOKEN)}`)
  console.log(`  App Token:          ${maskToken(config.SLACK_APP_TOKEN)}`)
  console.log('─'.repeat(50))
  console.log(`  WebSocket 포트:     ${config.WS_PORT}`)
  console.log(`  브라우저 모드:      ${config.BROWSER_MODE}`)
  console.log('')

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: '무엇을 하시겠습니까?',
    choices: [
      { title: '종료', value: 'exit' },
      { title: 'Claude CLI 경로 변경', value: 'claude_path' },
      { title: '프로젝트 경로 변경', value: 'project_path' },
      { title: 'Slack Bot Token 변경', value: 'bot_token' },
      { title: 'Slack App Token 변경', value: 'app_token' },
      { title: '브라우저 모드 변경', value: 'browser_mode' },
    ],
  })

  if (!action || action === 'exit') {
    return
  }

  let updated = false

  switch (action) {
    case 'claude_path': {
      const { newPath } = await prompts({
        type: 'text',
        name: 'newPath',
        message: '새 Claude CLI 경로:',
        initial: config.CLAUDE_PATH,
        validate: (v) => existsSync(v) ? true : '파일이 존재하지 않습니다.',
      })
      if (newPath) {
        config.CLAUDE_PATH = newPath
        updated = true
      }
      break
    }
    case 'project_path': {
      const { newPath } = await prompts({
        type: 'text',
        name: 'newPath',
        message: '새 프로젝트 경로:',
        initial: config.PROJECT_PATH,
        validate: (v) => existsSync(v) ? true : '디렉토리가 존재하지 않습니다.',
      })
      if (newPath) {
        config.PROJECT_PATH = newPath
        updated = true
      }
      break
    }
    case 'bot_token': {
      const { newToken } = await prompts({
        type: 'password',
        name: 'newToken',
        message: '새 Slack Bot Token (xoxb-...):',
        validate: (v) => v.startsWith('xoxb-') ? true : 'xoxb-로 시작해야 합니다.',
      })
      if (newToken) {
        config.SLACK_BOT_TOKEN = newToken
        config.ENABLE_SLACK = config.SLACK_APP_TOKEN ? 'true' : 'false'
        updated = true
      }
      break
    }
    case 'app_token': {
      const { newToken } = await prompts({
        type: 'password',
        name: 'newToken',
        message: '새 Slack App Token (xapp-...):',
        validate: (v) => v.startsWith('xapp-') ? true : 'xapp-로 시작해야 합니다.',
      })
      if (newToken) {
        config.SLACK_APP_TOKEN = newToken
        config.ENABLE_SLACK = config.SLACK_BOT_TOKEN ? 'true' : 'false'
        updated = true
      }
      break
    }
    case 'browser_mode': {
      const { newMode } = await prompts({
        type: 'select',
        name: 'newMode',
        message: '브라우저 모드 선택:',
        choices: [
          { title: 'off - 비활성화', value: 'off' },
          { title: 'puppeteer - 헤드리스 Chrome (서버용)', value: 'puppeteer' },
          { title: 'relay - Chrome 확장 프로그램', value: 'relay' },
        ],
        initial: config.BROWSER_MODE === 'puppeteer' ? 1 : config.BROWSER_MODE === 'relay' ? 2 : 0,
      })
      if (newMode) {
        config.BROWSER_MODE = newMode
        updated = true
      }
      break
    }
  }

  if (updated) {
    await writeFile(envPath, generateEnvContent(config))
    console.log('')
    console.log('✓ 설정이 저장되었습니다.')
    console.log('')

    // 다시 설정 화면 표시
    await showConfig()
  }
}

function showHelp() {
  console.log(`
slack-claude-gateway - Slack과 Claude Code를 연결하는 게이트웨이

사용법:
  npx slack-claude-gateway <command>

명령어:
  init     설정 마법사 실행 (Claude 경로 자동 감지, Slack 토큰 입력)
  start    게이트웨이 서버 시작 (.env 없으면 init 자동 실행)
  config   현재 설정 확인 및 수정
  help     도움말 표시

예시:
  npx slack-claude-gateway init    # 처음 설정
  npx slack-claude-gateway start   # 서버 시작
  npx slack-claude-gateway config  # 설정 확인/수정
  npx slack-claude-gateway         # start와 동일

환경변수 (.env 파일):
  PROJECT_PATH      작업할 프로젝트 경로 (필수)
  CLAUDE_PATH       Claude CLI 경로 (자동 감지)
  SLACK_BOT_TOKEN   Slack Bot 토큰 (xoxb-...)
  SLACK_APP_TOKEN   Slack App 토큰 (xapp-...)
  WS_PORT           WebSocket 포트 (기본값: 4900)
  BROWSER_MODE      브라우저 모드 (off/puppeteer/relay)
`)
}

async function main() {
  switch (command) {
    case 'init':
      await init()
      break
    case 'start':
    case undefined:
      await start()
      break
    case 'config':
      await showConfig()
      break
    case 'help':
    case '--help':
    case '-h':
      showHelp()
      break
    default:
      console.error(`알 수 없는 명령어: ${command}`)
      showHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
