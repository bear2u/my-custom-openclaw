import type { App } from '@slack/bolt'
import type { WebClient } from '@slack/web-api'
import type { Config } from '../config.js'
import { runClaude } from '../claude/runner.js'

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

// 도움말 메시지
const HELP_MESSAGE = `*Claude Bot 사용 가이드*

*기본 사용법*
• 봇을 멘션하고 질문하세요: \`@ClaudeBot 안녕하세요\`
• 같은 채널에서는 대화 맥락이 유지됩니다

*명령어*
• \`새 세션\` / \`reset\` - 새로운 대화 세션 시작
• \`도움말\` / \`help\` - 이 도움말 표시

*리액션 의미*
• :eyes: - 메시지 처리 중
• :white_check_mark: - 응답 완료
• :sparkles: - 새 세션 시작됨
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

// 새 세션 요청인지 확인
function isNewSessionRequest(text: string): boolean {
  const lowerText = text.toLowerCase()
  return NEW_SESSION_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()))
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

      // 채널의 기존 세션 ID 가져오기
      const existingSessionId = channelSessions.get(ctx.channel)

      // Claude CLI 실행
      const result = await runClaude({
        message: userMessage,
        model: config.claudeModel,
        timeoutMs: config.claudeTimeout,
        sessionId: existingSessionId,
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

        // 일반 메시지로 응답
        await sendMessage(client, ctx.channel, result.text)

        console.log(`[Slack] Response sent (${result.text.length} chars)`)
      } else {
        // 결과 없음
        await addReaction(client, ctx.channel, ctx.messageTs, 'question')
        await sendMessage(
          client,
          ctx.channel,
          '응답을 생성하지 못했습니다. 다시 시도해주세요.'
        )
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

      // 채널의 기존 세션 ID 가져오기
      const existingSessionId = channelSessions.get(ctx.channel)

      const result = await runClaude({
        message: userMessage,
        model: config.claudeModel,
        timeoutMs: config.claudeTimeout,
        sessionId: existingSessionId,
      })

      await removeReaction(client, ctx.channel, ctx.messageTs, 'eyes')

      if (result && result.text) {
        // 세션 ID 저장
        if (result.sessionId) {
          channelSessions.set(ctx.channel, result.sessionId)
          console.log(`[Slack] Session for channel ${ctx.channel}: ${result.sessionId}`)
        }

        await addReaction(client, ctx.channel, ctx.messageTs, 'white_check_mark')
        await sendMessage(client, ctx.channel, result.text)
      } else {
        await addReaction(client, ctx.channel, ctx.messageTs, 'question')
        await sendMessage(
          client,
          ctx.channel,
          '응답을 생성하지 못했습니다.'
        )
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
