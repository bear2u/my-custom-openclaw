import type { App } from '@slack/bolt'
import type { WebClient } from '@slack/web-api'
import type { Config } from '../config.js'
import { runClaudeStreaming } from '../claude/runner.js'
import { existsSync, readFileSync, mkdirSync, createWriteStream, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Slack 파일 타입
interface SlackFile {
  id: string
  name?: string
  mimetype?: string
  filetype?: string
  url_private_download?: string
  url_private?: string
}

// Slack 메시지 이벤트 타입
interface SlackMessageEvent {
  type: string
  subtype?: string
  text?: string
  user?: string
  channel: string
  ts: string
  thread_ts?: string
  bot_id?: string
  files?: SlackFile[]
}

// 봇 멘션 확인
export function shouldProcessMessage(text: string, botUserId: string): boolean {
  if (!text) {
    return false
  }
  return text.includes(`<@${botUserId}>`)
}

// 봇 멘션 제거하여 순수 메시지 추출
export function extractUserMessage(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim()
}

// 긴 메시지 청킹 (Slack 메시지 제한: 약 40,000자)
const MAX_MESSAGE_LENGTH = 3900

export function chunkMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining)
      break
    }

    // 코드 블록 중간에서 자르지 않도록 적절한 위치 찾기
    let cutIndex = MAX_MESSAGE_LENGTH

    // 줄바꿈 위치에서 자르기 시도
    const lastNewline = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH)
    if (lastNewline > MAX_MESSAGE_LENGTH * 0.7) {
      cutIndex = lastNewline
    }

    chunks.push(remaining.slice(0, cutIndex))
    remaining = remaining.slice(cutIndex).trim()
  }

  return chunks
}

// 처리 중인 메시지 추적 (중복 방지)
const processingMessages = new Set<string>()

// 채널별 세션 ID 매핑 (채널 ID → Claude 세션 ID)
const channelSessions = new Map<string, string>()

// 새 세션 키워드
const NEW_SESSION_KEYWORDS = ['새 세션', '새세션', 'new session', '새로운 세션', '리셋', 'reset']

// 도움말 키워드
const HELP_KEYWORDS = ['도움말', '도움', 'help', '사용법', '명령어', 'commands']

// 환경설정 키워드
const CONFIG_KEYWORDS = ['환경설정', '설정', 'config', 'settings', '세팅']

// 재시작 키워드
const RESTART_KEYWORDS = ['재시작', 'restart', 'reboot', '리부트']

// 재시작 대기 상태 (채널 → 타임스탬프)
const restartPending = new Map<string, number>()

// 환경설정 대화 상태
interface ConfigConversation {
  step: 'menu' | 'view' | 'edit' | 'confirm'
  selectedItem?: string
  newValue?: string
  timestamp: number
}

// 채널별 환경설정 대화 상태
const configConversations = new Map<string, ConfigConversation>()

// 환경설정 항목 매핑
// editable: false인 항목은 CLI에서만 수정 가능 (보안상 이유)
const CONFIG_ITEMS: Record<string, { label: string; key: string; editable: boolean; masked?: boolean }> = {
  '1': { label: 'Claude CLI 경로', key: 'CLAUDE_PATH', editable: true },
  '2': { label: '프로젝트 경로', key: 'PROJECT_PATH', editable: true },
  '3': { label: 'Claude 모델', key: 'CLAUDE_MODEL', editable: true },
  '4': { label: 'Slack Bot Token', key: 'SLACK_BOT_TOKEN', editable: false, masked: true },
  '5': { label: 'Slack App Token', key: 'SLACK_APP_TOKEN', editable: false, masked: true },
  '6': { label: '브라우저 모드', key: 'BROWSER_MODE', editable: true },
  '7': { label: 'WebSocket 포트', key: 'WS_PORT', editable: true },
}

// 도움말 메시지
const HELP_MESSAGE = `*Claude Bot 사용 가이드*

*기본 사용법*
• 봇을 멘션하고 질문하세요: \`@ClaudeBot 안녕하세요\`
• 같은 채널에서는 대화 맥락이 유지됩니다

*명령어*
• \`새 세션\` / \`reset\` - 새로운 대화 세션 시작
• \`환경설정\` / \`config\` - 게이트웨이 설정 확인 및 수정
• \`재시작\` / \`restart\` - 게이트웨이 재시작
• \`도움말\` / \`help\` - 이 도움말 표시

*리액션 의미*
• :eyes: - 메시지 처리 중
• :white_check_mark: - 응답 완료
• :sparkles: - 새 세션 시작됨
• :gear: - 환경설정 모드
• :arrows_counterclockwise: - 재시작 중
• :x: - 오류 발생
• :question: - 응답 생성 실패

*팁*
• 코드 작성, 질문 답변, 문서 작성 등 다양한 작업을 요청할 수 있습니다
• 이전 대화를 참조하여 "아까 그거 수정해줘" 같은 요청도 가능합니다
• 새로운 주제로 대화하려면 "새 세션"이라고 말하세요`

interface SlackMessageContext {
  channel: string
  threadTs: string
  messageTs: string
}

// 리액션 추가
async function addReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  emoji: string
): Promise<void> {
  try {
    await client.reactions.add({
      channel,
      timestamp,
      name: emoji,
    })
  } catch (error) {
    // 이미 추가된 리액션이면 무시
    const e = error as { data?: { error?: string } }
    if (e.data?.error !== 'already_reacted') {
      console.error(`[Slack] Failed to add reaction ${emoji}:`, error)
    }
  }
}

// 리액션 제거
async function removeReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  emoji: string
): Promise<void> {
  try {
    await client.reactions.remove({
      channel,
      timestamp,
      name: emoji,
    })
  } catch (error) {
    // 리액션이 없으면 무시
    const e = error as { data?: { error?: string } }
    if (e.data?.error !== 'no_reaction') {
      console.error(`[Slack] Failed to remove reaction ${emoji}:`, error)
    }
  }
}

// 메시지 전송 (일반 메시지)
async function sendMessage(
  client: WebClient,
  channel: string,
  text: string
): Promise<void> {
  const chunks = chunkMessage(text)

  for (const chunk of chunks) {
    await client.chat.postMessage({
      channel,
      text: chunk,
    })
  }
}

// 스트리밍 상태 관리
interface StreamingState {
  lastSentLength: number  // 마지막으로 전송한 텍스트 길이
  messageCount: number    // 전송한 메시지 수
}

// 스트리밍 청크 전송 (새 메시지로 추가)
async function sendStreamingChunk(
  client: WebClient,
  channel: string,
  text: string,
  state: StreamingState
): Promise<void> {
  // 새로 추가된 내용만 전송
  const newContent = text.slice(state.lastSentLength)
  if (newContent.length < 100) return  // 너무 짧으면 스킵

  // 청킹하여 전송
  const chunks = chunkMessage(newContent)
  for (const chunk of chunks) {
    await client.chat.postMessage({
      channel,
      text: chunk + '\n\n_..._',
    })
    state.messageCount++
  }
  state.lastSentLength = text.length
}

// 새 세션 요청인지 확인
function isNewSessionRequest(text: string): boolean {
  const lowerText = text.toLowerCase()
  return NEW_SESSION_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()))
}

// 환경설정 요청인지 확인
function isConfigRequest(text: string): boolean {
  const lowerText = text.toLowerCase().trim()
  return CONFIG_KEYWORDS.some(keyword => {
    const lowerKeyword = keyword.toLowerCase()
    return lowerText === lowerKeyword || lowerText.startsWith(lowerKeyword + ' ') || lowerText.endsWith(' ' + lowerKeyword)
  })
}

// 재시작 요청인지 확인
function isRestartRequest(text: string): boolean {
  const lowerText = text.toLowerCase().trim()
  return RESTART_KEYWORDS.some(keyword => {
    const lowerKeyword = keyword.toLowerCase()
    return lowerText === lowerKeyword || lowerText.startsWith(lowerKeyword + ' ') || lowerText.endsWith(' ' + lowerKeyword)
  })
}

// 재시작 확인 응답인지 확인
function isRestartConfirm(text: string): boolean {
  const lowerText = text.toLowerCase().trim()
  return lowerText === '확인' || lowerText === 'yes' || lowerText === 'y'
}

// 재시작 취소 응답인지 확인
function isRestartCancel(text: string): boolean {
  const lowerText = text.toLowerCase().trim()
  return lowerText === '취소' || lowerText === 'no' || lowerText === 'n'
}

// .env 파일 파싱
function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {}
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
  return config
}

// .env 파일 저장
async function saveEnvFile(envPath: string, config: Record<string, string>): Promise<void> {
  const content = `# Slack Integration
ENABLE_SLACK=${config.ENABLE_SLACK || 'false'}
SLACK_BOT_TOKEN=${config.SLACK_BOT_TOKEN || ''}
SLACK_APP_TOKEN=${config.SLACK_APP_TOKEN || ''}

# Project Settings (single project mode)
PROJECT_PATH=${config.PROJECT_PATH || ''}
CLAUDE_PATH=${config.CLAUDE_PATH || 'claude'}

# Claude Settings
CLAUDE_MODEL=${config.CLAUDE_MODEL || 'sonnet'}
CLAUDE_TIMEOUT_MS=${config.CLAUDE_TIMEOUT_MS || '120000'}

# WebSocket Gateway Port
WS_PORT=${config.WS_PORT || '4900'}

# Browser Mode (off | puppeteer | relay)
BROWSER_MODE=${config.BROWSER_MODE || 'off'}
BROWSER_RELAY_PORT=${config.BROWSER_RELAY_PORT || '18792'}
`
  await writeFile(envPath, content)
}

// 지원하는 이미지 파일 타입
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

// 이미지 파일 저장 디렉토리 (프로젝트 내)
function getImageDir(projectPath: string): string {
  const dir = join(projectPath, '.slack-images')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

// Slack 파일 다운로드
async function downloadSlackFile(
  file: SlackFile,
  botToken: string,
  projectPath: string
): Promise<string | null> {
  const downloadUrl = file.url_private_download || file.url_private
  if (!downloadUrl) {
    console.error(`[Slack] No download URL for file: ${file.id}`)
    return null
  }

  // 이미지 파일인지 확인
  if (!file.mimetype || !SUPPORTED_IMAGE_TYPES.includes(file.mimetype)) {
    console.log(`[Slack] Unsupported file type: ${file.mimetype}`)
    return null
  }

  const imageDir = getImageDir(projectPath)
  const ext = file.name?.split('.').pop() || 'jpg'
  const filePath = join(imageDir, `${file.id}.${ext}`)

  try {
    // Slack API로 파일 다운로드 (Authorization 헤더 필요)
    const response = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${botToken}`,
      },
    })

    if (!response.ok) {
      console.error(`[Slack] Failed to download file: ${response.status} ${response.statusText}`)
      return null
    }

    // 파일로 저장
    const buffer = Buffer.from(await response.arrayBuffer())
    const writeStream = createWriteStream(filePath)
    await new Promise<void>((resolve, reject) => {
      writeStream.write(buffer, (err) => {
        if (err) reject(err)
        writeStream.end(resolve)
      })
    })

    console.log(`[Slack] Downloaded file: ${filePath} (${buffer.length} bytes)`)
    return filePath
  } catch (error) {
    console.error(`[Slack] Error downloading file:`, error)
    return null
  }
}

// 다운로드된 임시 파일 정리
function cleanupTempFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        console.log(`[Slack] Cleaned up temp file: ${filePath}`)
      }
    } catch (error) {
      console.error(`[Slack] Failed to cleanup temp file: ${filePath}`, error)
    }
  }
}

// 토큰 마스킹
function maskToken(token: string): string {
  if (!token || token.length < 10) return token ? '****' : '(미설정)'
  return token.substring(0, 8) + '...' + token.substring(token.length - 4)
}

// 환경설정 메뉴 메시지
function getConfigMenuMessage(envConfig: Record<string, string>): string {
  return `*⚙️ 환경설정*

현재 설정값을 확인하거나 수정할 수 있습니다.

*번호를 입력하세요:*
\`1\` - Claude CLI 경로: \`${envConfig.CLAUDE_PATH || '(미설정)'}\`
\`2\` - 프로젝트 경로: \`${envConfig.PROJECT_PATH || '(미설정)'}\`
\`3\` - Claude 모델: \`${envConfig.CLAUDE_MODEL || 'sonnet'}\`
\`4\` - Slack Bot Token: \`${maskToken(envConfig.SLACK_BOT_TOKEN || '')}\` 🔒
\`5\` - Slack App Token: \`${maskToken(envConfig.SLACK_APP_TOKEN || '')}\` 🔒
\`6\` - 브라우저 모드: \`${envConfig.BROWSER_MODE || 'off'}\`
\`7\` - WebSocket 포트: \`${envConfig.WS_PORT || '4900'}\`

🔒 = 보안 항목 (CLI에서만 수정 가능)
\`취소\` 또는 \`exit\`를 입력하면 설정을 종료합니다.`
}

// 환경설정 대화 처리
async function handleConfigConversation(
  _client: WebClient,
  channel: string,
  userMessage: string,
  envPath: string
): Promise<{ handled: boolean; message?: string }> {
  const conversation = configConversations.get(channel)
  const lowerMessage = userMessage.toLowerCase().trim()

  // 취소 명령
  if (lowerMessage === '취소' || lowerMessage === 'exit' || lowerMessage === '종료') {
    configConversations.delete(channel)
    return { handled: true, message: '환경설정을 종료합니다.' }
  }

  const envConfig = parseEnvFile(envPath)

  // 대화가 없거나 시간 초과 (5분)
  if (!conversation || Date.now() - conversation.timestamp > 5 * 60 * 1000) {
    // 환경설정 요청인지 확인
    if (isConfigRequest(userMessage)) {
      configConversations.set(channel, { step: 'menu', timestamp: Date.now() })
      return { handled: true, message: getConfigMenuMessage(envConfig) }
    }
    return { handled: false }
  }

  // 메뉴 선택 단계
  if (conversation.step === 'menu') {
    const item = CONFIG_ITEMS[lowerMessage]
    if (item) {
      const currentValue = item.masked
        ? maskToken(envConfig[item.key] || '')
        : (envConfig[item.key] || '(미설정)')

      configConversations.set(channel, {
        step: 'view',
        selectedItem: lowerMessage,
        timestamp: Date.now(),
      })

      return {
        handled: true,
        message: `*${item.label}*\n현재 값: \`${currentValue}\`\n\n수정하려면 \`수정\`을, 돌아가려면 \`메뉴\`를 입력하세요.`,
      }
    }

    // 1-7이 아닌 다른 입력이면 환경설정 종료하고 해당 요청 처리
    configConversations.delete(channel)
    return { handled: false }
  }

  // 상세 보기 단계
  if (conversation.step === 'view') {
    if (lowerMessage === '메뉴' || lowerMessage === 'menu') {
      configConversations.set(channel, { step: 'menu', timestamp: Date.now() })
      return { handled: true, message: getConfigMenuMessage(envConfig) }
    }

    if (lowerMessage === '수정' || lowerMessage === 'edit') {
      const item = CONFIG_ITEMS[conversation.selectedItem!]

      // 수정 불가능한 항목 (보안상 이유)
      if (!item.editable) {
        return {
          handled: true,
          message: `⚠️ *${item.label}*은(는) 보안상 이유로 Slack에서 수정할 수 없습니다.\nCLI에서 수정하세요: \`npx slack-claude-gateway config\`\n\n\`메뉴\`를 입력하면 돌아갑니다.`,
        }
      }

      configConversations.set(channel, {
        step: 'edit',
        selectedItem: conversation.selectedItem,
        timestamp: Date.now(),
      })

      let hint = ''
      if (item.key === 'BROWSER_MODE') {
        hint = '\n(가능한 값: `off`, `puppeteer`, `relay`)'
      } else if (item.key === 'CLAUDE_MODEL') {
        hint = '\n(가능한 값: `sonnet`, `opus`, `haiku`)'
      }

      return {
        handled: true,
        message: `*${item.label}* 수정${hint}\n\n새 값을 입력하세요:`,
      }
    }

    // 메뉴/수정이 아닌 다른 입력이면 환경설정 종료하고 해당 요청 처리
    configConversations.delete(channel)
    return { handled: false }
  }

  // 수정 단계
  if (conversation.step === 'edit') {
    const item = CONFIG_ITEMS[conversation.selectedItem!]
    const newValue = userMessage.trim()

    // 값 유효성 검사
    if (item.key === 'BROWSER_MODE' && !['off', 'puppeteer', 'relay'].includes(newValue.toLowerCase())) {
      return {
        handled: true,
        message: '브라우저 모드는 `off`, `puppeteer`, `relay` 중 하나여야 합니다.\n새 값을 입력하세요:',
      }
    }

    if (item.key === 'SLACK_BOT_TOKEN' && !newValue.startsWith('xoxb-')) {
      return {
        handled: true,
        message: 'Bot Token은 `xoxb-`로 시작해야 합니다.\n새 값을 입력하세요:',
      }
    }

    if (item.key === 'SLACK_APP_TOKEN' && !newValue.startsWith('xapp-')) {
      return {
        handled: true,
        message: 'App Token은 `xapp-`로 시작해야 합니다.\n새 값을 입력하세요:',
      }
    }

    configConversations.set(channel, {
      step: 'confirm',
      selectedItem: conversation.selectedItem,
      newValue: newValue,
      timestamp: Date.now(),
    })

    const displayValue = item.masked ? maskToken(newValue) : newValue
    return {
      handled: true,
      message: `*${item.label}*을(를) \`${displayValue}\`(으)로 변경하시겠습니까?\n\n\`확인\` 또는 \`취소\`를 입력하세요.`,
    }
  }

  // 확인 단계
  if (conversation.step === 'confirm') {
    if (lowerMessage === '확인' || lowerMessage === 'yes' || lowerMessage === 'y') {
      const item = CONFIG_ITEMS[conversation.selectedItem!]
      envConfig[item.key] = conversation.newValue!

      // ENABLE_SLACK 자동 업데이트
      if (item.key === 'SLACK_BOT_TOKEN' || item.key === 'SLACK_APP_TOKEN') {
        envConfig.ENABLE_SLACK = (envConfig.SLACK_BOT_TOKEN && envConfig.SLACK_APP_TOKEN) ? 'true' : 'false'
      }

      try {
        await saveEnvFile(envPath, envConfig)
        configConversations.set(channel, { step: 'menu', timestamp: Date.now() })

        return {
          handled: true,
          message: `✅ *${item.label}*이(가) 업데이트되었습니다.\n\n⚠️ 변경사항을 적용하려면 게이트웨이를 재시작하세요.\n\n` + getConfigMenuMessage(envConfig),
        }
      } catch (err) {
        configConversations.delete(channel)
        return {
          handled: true,
          message: `❌ 설정 저장 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    if (lowerMessage === '취소' || lowerMessage === 'no' || lowerMessage === 'n') {
      configConversations.set(channel, { step: 'menu', timestamp: Date.now() })
      return { handled: true, message: '변경이 취소되었습니다.\n\n' + getConfigMenuMessage(envConfig) }
    }

    return {
      handled: true,
      message: '`확인` 또는 `취소`를 입력해주세요.',
    }
  }

  return { handled: false }
}

// 도움말 요청인지 확인
function isHelpRequest(text: string): boolean {
  const lowerText = text.toLowerCase().trim()
  // 정확히 도움말 키워드만 있거나, 키워드로 시작하는 경우
  return HELP_KEYWORDS.some(keyword => {
    const lowerKeyword = keyword.toLowerCase()
    return lowerText === lowerKeyword || lowerText.startsWith(lowerKeyword + ' ') || lowerText.endsWith(' ' + lowerKeyword)
  })
}

// Slack 이벤트 핸들러 설정
export function setupSlackHandlers(app: App, config: Config): void {
  let botUserId: string | null = null
  const envPath = join(process.cwd(), '.env')

  // 봇 ID 가져오기
  app.event('app_home_opened', async ({ client }) => {
    if (!botUserId) {
      const auth = await client.auth.test()
      botUserId = auth.user_id as string
      console.log(`[Slack] Bot user ID: ${botUserId}`)
    }
  })

  // 메시지 이벤트 핸들러
  app.message(async ({ message, client }) => {
    // 타입 가드
    const msg = message as SlackMessageEvent

    // 봇 메시지 무시
    if (msg.subtype === 'bot_message' || msg.bot_id) {
      return
    }

    // 봇 ID 아직 없으면 가져오기
    if (!botUserId) {
      const auth = await client.auth.test()
      botUserId = auth.user_id as string
      console.log(`[Slack] Bot user ID: ${botUserId}`)
    }

    const text = msg.text || ''

    // 봇 멘션 확인
    if (!shouldProcessMessage(text, botUserId)) {
      return
    }

    // 메시지 컨텍스트
    const ctx: SlackMessageContext = {
      channel: msg.channel,
      threadTs: msg.thread_ts || msg.ts,
      messageTs: msg.ts,
    }

    // 중복 처리 방지
    const messageKey = `${ctx.channel}-${ctx.messageTs}`
    if (processingMessages.has(messageKey)) {
      console.log(`[Slack] Duplicate message ignored: ${messageKey}`)
      return
    }
    processingMessages.add(messageKey)

    // 다운로드된 임시 파일 경로 (finally에서 정리)
    let downloadedFiles: string[] = []

    try {
      // 처리 중 리액션 추가
      await addReaction(client, ctx.channel, ctx.messageTs, 'eyes')

      // 사용자 메시지 추출
      const userMessage = extractUserMessage(text, botUserId)
      console.log(`[Slack] Processing message from ${msg.user}: ${userMessage.slice(0, 100)}...`)

      // 도움말 요청 확인
      if (isHelpRequest(userMessage)) {
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'bulb')
        await sendMessage(client, ctx.channel, HELP_MESSAGE)
        processingMessages.delete(messageKey)
        return
      }

      // 새 세션 요청 확인
      if (isNewSessionRequest(userMessage)) {
        channelSessions.delete(ctx.channel)
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'sparkles')
        await sendMessage(client, ctx.channel, '새로운 세션을 시작합니다.')
        processingMessages.delete(messageKey)
        return
      }

      // 재시작 요청 처리
      const pendingRestart = restartPending.get(ctx.channel)
      if (pendingRestart && Date.now() - pendingRestart < 60000) {
        // 확인 대기 중
        if (isRestartConfirm(userMessage)) {
          restartPending.delete(ctx.channel)
          await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
          await addReaction(client, ctx.channel, ctx.messageTs, 'arrows_counterclockwise')
          await sendMessage(client, ctx.channel, '🔄 게이트웨이를 재시작합니다...')
          processingMessages.delete(messageKey)

          // 잠시 후 재시작 (메시지 전송 완료를 위해)
          setTimeout(() => {
            console.log('[Slack] Restarting gateway...')
            process.exit(0) // PM2나 systemd가 자동으로 재시작
          }, 1000)
          return
        } else if (isRestartCancel(userMessage)) {
          restartPending.delete(ctx.channel)
          await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
          await sendMessage(client, ctx.channel, '재시작이 취소되었습니다.')
          processingMessages.delete(messageKey)
          return
        }
      }

      if (isRestartRequest(userMessage)) {
        restartPending.set(ctx.channel, Date.now())
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'warning')
        await sendMessage(client, ctx.channel, '⚠️ *게이트웨이를 재시작하시겠습니까?*\n\n모든 활성 연결이 끊어지고 설정이 다시 로드됩니다.\n\n`확인` 또는 `취소`를 입력하세요. (1분 내)')
        processingMessages.delete(messageKey)
        return
      }

      // 환경설정 대화 처리
      const configResult = await handleConfigConversation(client, ctx.channel, userMessage, envPath)
      if (configResult.handled) {
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'gear')
        if (configResult.message) {
          await sendMessage(client, ctx.channel, configResult.message)
        }
        processingMessages.delete(messageKey)
        return
      }

      // 채널의 기존 세션 ID 가져오기
      const existingSessionId = channelSessions.get(ctx.channel)

      // 첨부 파일 다운로드 (이미지만) - 프로젝트 폴더에 저장
      downloadedFiles = []
      if (msg.files && msg.files.length > 0 && config.slackBotToken) {
        console.log(`[Slack] Message has ${msg.files.length} file(s) attached`)
        for (const file of msg.files) {
          const filePath = await downloadSlackFile(file, config.slackBotToken, config.projectPath)
          if (filePath) {
            downloadedFiles.push(filePath)
          }
        }
        if (downloadedFiles.length > 0) {
          console.log(`[Slack] Downloaded ${downloadedFiles.length} image file(s)`)
        }
      }

      // 이미지가 있으면 메시지에 경로 추가
      let finalMessage = userMessage
      if (downloadedFiles.length > 0) {
        const imageList = downloadedFiles.map(f => f).join('\n- ')
        finalMessage = `${userMessage}\n\n[첨부된 이미지 파일 - Read 도구로 확인해주세요]\n- ${imageList}`
      }

      // 스트리밍 상태 관리
      const streamingState: StreamingState = { lastSentLength: 0, messageCount: 0 }

      // Claude CLI 실행 (스트리밍 모드) - 타임아웃 10분
      const result = await runClaudeStreaming({
        message: finalMessage,
        model: config.claudeModel,
        timeoutMs: 600000,  // 10분 타임아웃
        sessionId: existingSessionId,
        cwd: config.projectPath,
        chunkInterval: 5000,  // 5초마다 청크 전송
        onChunk: async (_chunk, accumulated) => {
          // 새 메시지로 청크 추가
          try {
            await sendStreamingChunk(client, ctx.channel, accumulated, streamingState)
          } catch (err) {
            console.error('[Slack] Failed to send streaming chunk:', err)
          }
        },
      })

      // 처리 중 리액션 제거
      await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')

      if (result && result.text) {
        // 세션 ID 저장 (새 세션이 생성된 경우)
        if (result.sessionId) {
          channelSessions.set(ctx.channel, result.sessionId)
          console.log(`[Slack] Session for channel ${ctx.channel}: ${result.sessionId}`)
        }

        // 완료 리액션 추가
        await addReaction(client, ctx.channel, ctx.messageTs, 'white_check_mark')

        // 마지막으로 전송되지 않은 내용 전송
        const remainingContent = result.text.slice(streamingState.lastSentLength)
        if (remainingContent.length > 0) {
          await sendMessage(client, ctx.channel, remainingContent)
        }

        console.log(`[Slack] Response sent (${result.text.length} chars, ${streamingState.messageCount + 1} messages)`)
      } else {
        // 결과 없음
        await sendMessage(client, ctx.channel, '응답을 생성하지 못했습니다. 다시 시도해주세요.')
        await addReaction(client, ctx.channel, ctx.messageTs, 'question')
      }
    } catch (error) {
      console.error('[Slack] Error processing message:', error)

      // 에러 리액션
      await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
      await addReaction(client, ctx.channel, ctx.messageTs, 'x')

      // 에러 메시지 전송
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await sendMessage(
        client,
        ctx.channel,
        `오류가 발생했습니다: ${errorMessage}`
      )
    } finally {
      // 처리 완료
      processingMessages.delete(messageKey)

      // 임시 파일 정리
      if (downloadedFiles.length > 0) {
        cleanupTempFiles(downloadedFiles)
      }
    }
  })

  // 앱 멘션 이벤트 (DM이 아닌 채널에서의 멘션)
  app.event('app_mention', async ({ event, client }) => {
    // 봇 ID 없으면 가져오기
    if (!botUserId) {
      const auth = await client.auth.test()
      botUserId = auth.user_id as string
    }

    const ctx: SlackMessageContext = {
      channel: event.channel,
      threadTs: event.thread_ts || event.ts,
      messageTs: event.ts,
    }

    // 중복 처리 방지
    const messageKey = `${ctx.channel}-${ctx.messageTs}`
    if (processingMessages.has(messageKey)) {
      return
    }
    processingMessages.add(messageKey)

    try {
      await addReaction(client, ctx.channel, ctx.messageTs, 'eyes')

      const userMessage = extractUserMessage(event.text || '', botUserId)
      console.log(`[Slack] App mention from ${event.user}: ${userMessage.slice(0, 100)}...`)

      // 도움말 요청 확인
      if (isHelpRequest(userMessage)) {
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'bulb')
        await sendMessage(client, ctx.channel, HELP_MESSAGE)
        processingMessages.delete(messageKey)
        return
      }

      // 새 세션 요청 확인
      if (isNewSessionRequest(userMessage)) {
        channelSessions.delete(ctx.channel)
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'sparkles')
        await sendMessage(client, ctx.channel, '새로운 세션을 시작합니다.')
        processingMessages.delete(messageKey)
        return
      }

      // 재시작 요청 처리
      const pendingRestart = restartPending.get(ctx.channel)
      if (pendingRestart && Date.now() - pendingRestart < 60000) {
        // 확인 대기 중
        if (isRestartConfirm(userMessage)) {
          restartPending.delete(ctx.channel)
          await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
          await addReaction(client, ctx.channel, ctx.messageTs, 'arrows_counterclockwise')
          await sendMessage(client, ctx.channel, '🔄 게이트웨이를 재시작합니다...')
          processingMessages.delete(messageKey)

          // 잠시 후 재시작 (메시지 전송 완료를 위해)
          setTimeout(() => {
            console.log('[Slack] Restarting gateway...')
            process.exit(0)
          }, 1000)
          return
        } else if (isRestartCancel(userMessage)) {
          restartPending.delete(ctx.channel)
          await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
          await sendMessage(client, ctx.channel, '재시작이 취소되었습니다.')
          processingMessages.delete(messageKey)
          return
        }
      }

      if (isRestartRequest(userMessage)) {
        restartPending.set(ctx.channel, Date.now())
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'warning')
        await sendMessage(client, ctx.channel, '⚠️ *게이트웨이를 재시작하시겠습니까?*\n\n모든 활성 연결이 끊어지고 설정이 다시 로드됩니다.\n\n`확인` 또는 `취소`를 입력하세요. (1분 내)')
        processingMessages.delete(messageKey)
        return
      }

      // 환경설정 대화 처리
      const configResult = await handleConfigConversation(client, ctx.channel, userMessage, envPath)
      if (configResult.handled) {
        await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
        await addReaction(client, ctx.channel, ctx.messageTs, 'gear')
        if (configResult.message) {
          await sendMessage(client, ctx.channel, configResult.message)
        }
        processingMessages.delete(messageKey)
        return
      }

      // 채널의 기존 세션 ID 가져오기
      const existingSessionId = channelSessions.get(ctx.channel)

      // 스트리밍 상태 관리
      const streamingState: StreamingState = { lastSentLength: 0, messageCount: 0 }

      const result = await runClaudeStreaming({
        message: userMessage,
        model: config.claudeModel,
        timeoutMs: 600000,  // 10분 타임아웃
        sessionId: existingSessionId,
        cwd: config.projectPath,
        chunkInterval: 5000,
        onChunk: async (_chunk, accumulated) => {
          try {
            await sendStreamingChunk(client, ctx.channel, accumulated, streamingState)
          } catch (err) {
            console.error('[Slack] Failed to send streaming chunk:', err)
          }
        },
      })

      await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')

      if (result && result.text) {
        // 세션 ID 저장
        if (result.sessionId) {
          channelSessions.set(ctx.channel, result.sessionId)
          console.log(`[Slack] Session for channel ${ctx.channel}: ${result.sessionId}`)
        }

        await addReaction(client, ctx.channel, ctx.messageTs, 'white_check_mark')

        // 마지막으로 전송되지 않은 내용 전송
        const remainingContent = result.text.slice(streamingState.lastSentLength)
        if (remainingContent.length > 0) {
          await sendMessage(client, ctx.channel, remainingContent)
        }

        console.log(`[Slack] Response sent (${result.text.length} chars, ${streamingState.messageCount + 1} messages)`)
      } else {
        await sendMessage(client, ctx.channel, '응답을 생성하지 못했습니다.')
        await addReaction(client, ctx.channel, ctx.messageTs, 'question')
      }
    } catch (error) {
      console.error('[Slack] Error in app_mention:', error)
      await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')
      await addReaction(client, ctx.channel, ctx.messageTs, 'x')

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await sendMessage(client, ctx.channel, `오류: ${errorMessage}`)
    } finally {
      processingMessages.delete(messageKey)
    }
  })
}
