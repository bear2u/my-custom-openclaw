import type { WebSocketClient } from './server.js'
import { runClaude } from '../claude/runner.js'
import { SessionManager } from '../session/manager.js'
import { chatDb } from '../db/database.js'
import {
  getClaudeMd,
  saveClaudeMd,
  getPlanMd,
  savePlanMd,
  getSkills,
  saveSkill,
  deleteSkill,
  getAgents,
  saveAgent,
  deleteAgent,
} from '../project/config.js'
import type { Config } from '../config.js'
import * as browser from '../browser/unified-browser.js'
import type { CronService } from '../cron/index.js'

export interface RpcRequest {
  id: string
  method: string
  params?: unknown
}

export interface RpcResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export interface EventMessage {
  event: string
  data: unknown
}

export interface HandlerContext {
  sendEvent: (event: string, data: unknown) => void
  broadcast: (event: string, data: unknown) => void
}

export type RpcHandler = (
  params: unknown,
  client: WebSocketClient,
  ctx: HandlerContext
) => Promise<unknown>

interface ChatSendParams {
  message: string
  sessionId?: string
}

interface HistoryLoadParams {
  sessionId: string
}

// 칸반 관련 키워드 감지
function isKanbanRelated(message: string): boolean {
  const kanbanKeywords = [
    '태스크', '할일', '할 일', '투두', 'todo', 'task',
    '버그', 'bug', '이슈', 'issue',
    '칸반', 'kanban', '보드', 'board',
    '목록', '리스트', 'list',
    '완료', '진행', '진행중', '진행 중', 'done', 'in progress', 'in_progress',
    '추가', '생성', '만들', 'create', 'add',
    '수정', '변경', 'update', 'change', 'modify',
    '삭제', 'delete', 'remove',
    '우선순위', 'priority', '높음', '중간', '낮음', 'high', 'medium', 'low',
  ]
  const lowerMessage = message.toLowerCase()
  return kanbanKeywords.some(keyword => lowerMessage.includes(keyword))
}

// 칸반 컨텍스트 생성
function buildKanbanContext(tasks: Array<{
  id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
}>): string {
  if (tasks.length === 0) {
    return '[칸반 보드] 현재 등록된 태스크가 없습니다.\n'
  }

  const statusLabels: Record<string, string> = {
    todo: '할일',
    in_progress: '진행중',
    done: '완료',
  }
  const priorityLabels: Record<string, string> = {
    low: '낮음',
    medium: '중간',
    high: '높음',
  }

  let context = '[칸반 보드 현황]\n'

  // 상태별로 그룹화
  const grouped: Record<string, typeof tasks> = {
    todo: [],
    in_progress: [],
    done: [],
  }

  for (const task of tasks) {
    grouped[task.status].push(task)
  }

  for (const status of ['todo', 'in_progress', 'done'] as const) {
    const statusTasks = grouped[status]
    if (statusTasks.length > 0) {
      context += `\n## ${statusLabels[status]} (${statusTasks.length}개)\n`
      statusTasks.forEach((task, idx) => {
        context += `${idx + 1}. [${task.id.slice(0, 6)}] ${task.title} (우선순위: ${priorityLabels[task.priority]})\n`
        if (task.description) {
          context += `   설명: ${task.description}\n`
        }
      })
    }
  }

  context += '\n---\n'
  context += '칸반 명령 형식 (응답에 포함하면 자동 실행됩니다):\n'
  context += '- 태스크 추가: [KANBAN_CREATE:제목:설명:상태:우선순위]\n'
  context += '- 태스크 수정: [KANBAN_UPDATE:태스크ID:필드=값,...]\n'
  context += '- 태스크 삭제: [KANBAN_DELETE:태스크ID]\n'
  context += '- 상태 변경: [KANBAN_STATUS:태스크ID:새상태]\n'
  context += '예시: [KANBAN_CREATE:로그인 버그 수정:사용자 로그인 시 오류 발생:todo:high]\n'
  context += '예시: [KANBAN_STATUS:abc123:done]\n'
  context += '---\n\n'

  return context
}

// Claude 응답에서 칸반 명령 파싱 및 실행
interface KanbanCommand {
  type: 'create' | 'update' | 'delete' | 'status'
  params: Record<string, string>
}

function parseKanbanCommands(text: string): KanbanCommand[] {
  const commands: KanbanCommand[] = []

  // CREATE 명령: [KANBAN_CREATE:제목:설명:상태:우선순위]
  const createPattern = /\[KANBAN_CREATE:([^:]+):([^:]*):([^:]+):([^\]]+)\]/g
  let match
  while ((match = createPattern.exec(text)) !== null) {
    commands.push({
      type: 'create',
      params: {
        title: match[1].trim(),
        description: match[2].trim(),
        status: match[3].trim(),
        priority: match[4].trim(),
      }
    })
  }

  // STATUS 명령: [KANBAN_STATUS:태스크ID:새상태]
  const statusPattern = /\[KANBAN_STATUS:([^:]+):([^\]]+)\]/g
  while ((match = statusPattern.exec(text)) !== null) {
    commands.push({
      type: 'status',
      params: {
        id: match[1].trim(),
        status: match[2].trim(),
      }
    })
  }

  // UPDATE 명령: [KANBAN_UPDATE:태스크ID:필드=값,...]
  const updatePattern = /\[KANBAN_UPDATE:([^:]+):([^\]]+)\]/g
  while ((match = updatePattern.exec(text)) !== null) {
    const params: Record<string, string> = { id: match[1].trim() }
    const fields = match[2].split(',')
    for (const field of fields) {
      const [key, value] = field.split('=')
      if (key && value) {
        params[key.trim()] = value.trim()
      }
    }
    commands.push({ type: 'update', params })
  }

  // DELETE 명령: [KANBAN_DELETE:태스크ID]
  const deletePattern = /\[KANBAN_DELETE:([^\]]+)\]/g
  while ((match = deletePattern.exec(text)) !== null) {
    commands.push({
      type: 'delete',
      params: { id: match[1].trim() }
    })
  }

  return commands
}

function executeKanbanCommands(commands: KanbanCommand[]): string[] {
  const results: string[] = []

  for (const cmd of commands) {
    try {
      switch (cmd.type) {
        case 'create': {
          const id = generateId()
          const status = (['todo', 'in_progress', 'done'].includes(cmd.params.status)
            ? cmd.params.status
            : 'todo') as 'todo' | 'in_progress' | 'done'
          const priority = (['low', 'medium', 'high'].includes(cmd.params.priority)
            ? cmd.params.priority
            : 'medium') as 'low' | 'medium' | 'high'

          chatDb.createTask({
            id,
            projectId: 'default',
            title: cmd.params.title,
            description: cmd.params.description || '',
            status,
            priority,
          })
          results.push(`✅ 태스크 생성됨: "${cmd.params.title}" (ID: ${id.slice(0, 6)})`)
          break
        }
        case 'status': {
          // ID로 태스크 찾기 (부분 ID 지원)
          const tasks = chatDb.getTasks('default')
          const task = tasks.find(t => t.id.startsWith(cmd.params.id) || t.id === cmd.params.id)
          if (task) {
            const newStatus = cmd.params.status as 'todo' | 'in_progress' | 'done'
            if (['todo', 'in_progress', 'done'].includes(newStatus)) {
              chatDb.updateTask(task.id, { status: newStatus })
              results.push(`✅ 태스크 상태 변경됨: "${task.title}" → ${newStatus}`)
            }
          } else {
            results.push(`❌ 태스크를 찾을 수 없음: ${cmd.params.id}`)
          }
          break
        }
        case 'update': {
          const tasks = chatDb.getTasks('default')
          const task = tasks.find(t => t.id.startsWith(cmd.params.id) || t.id === cmd.params.id)
          if (task) {
            const updates: Record<string, string> = {}
            if (cmd.params.title) updates.title = cmd.params.title
            if (cmd.params.description) updates.description = cmd.params.description
            if (cmd.params.priority) updates.priority = cmd.params.priority
            if (cmd.params.status) updates.status = cmd.params.status
            chatDb.updateTask(task.id, updates)
            results.push(`✅ 태스크 수정됨: "${task.title}"`)
          } else {
            results.push(`❌ 태스크를 찾을 수 없음: ${cmd.params.id}`)
          }
          break
        }
        case 'delete': {
          const tasks = chatDb.getTasks('default')
          const task = tasks.find(t => t.id.startsWith(cmd.params.id) || t.id === cmd.params.id)
          if (task) {
            chatDb.deleteTask(task.id)
            results.push(`✅ 태스크 삭제됨: "${task.title}"`)
          } else {
            results.push(`❌ 태스크를 찾을 수 없음: ${cmd.params.id}`)
          }
          break
        }
      }
    } catch (err) {
      results.push(`❌ 명령 실행 오류: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return results
}

// 칸반 명령을 응답에서 제거 (사용자에게 보여줄 때 깔끔하게)
function removeKanbanCommands(text: string): string {
  return text
    .replace(/\[KANBAN_CREATE:[^\]]+\]/g, '')
    .replace(/\[KANBAN_STATUS:[^\]]+\]/g, '')
    .replace(/\[KANBAN_UPDATE:[^\]]+\]/g, '')
    .replace(/\[KANBAN_DELETE:[^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n') // 연속 빈 줄 정리
    .trim()
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function createHandlers(
  config: Config,
  sessions: SessionManager,
  cronService?: CronService
): Record<string, RpcHandler> {
  // 단일 프로젝트 경로 (config에서 가져옴)
  const projectPath = config.projectPath

  return {
    'chat.send': async (params, client, ctx) => {
      const { message, sessionId } = params as ChatSendParams
      console.log('[Handler] chat.send called with:', { message, sessionId })

      if (!message || typeof message !== 'string') {
        throw new Error('message is required')
      }

      const currentSessionId = sessionId || client.sessionId
      console.log('[Handler] Using sessionId:', currentSessionId)

      ctx.sendEvent('chat.start', { sessionId: currentSessionId })

      // 사용자 메시지 저장
      const userMsgId = generateId()
      const userTimestamp = Date.now()

      try {
        // 브라우저 명령어 패턴 감지 (URL 열기, 스크린샷 등)
        const browserConnected = browser.isConnected()
        const browserMode = browser.getCurrentMode()
        console.log('[Handler] Browser status:', {
          mode: browserMode,
          connected: browserConnected
        })
        const lowerMessage = message.toLowerCase()

        // URL 열기 명령 감지
        const openPatterns = [
          /(?:열어|open|go to|navigate|이동)\s*(?:줘|해줘|해)?\s*$/i,
          /^(?:열어|open|go to)\s+/i,
        ]

        const urlMap: Record<string, string> = {
          '구글': 'https://www.google.com',
          'google': 'https://www.google.com',
          '레딧': 'https://www.reddit.com',
          'reddit': 'https://www.reddit.com',
          '네이버': 'https://www.naver.com',
          'naver': 'https://www.naver.com',
          '유튜브': 'https://www.youtube.com',
          'youtube': 'https://www.youtube.com',
        }

        // URL이나 사이트명이 포함되어 있고, 열기 명령이 있는지 확인
        const hasOpenCommand = openPatterns.some(p => p.test(lowerMessage)) ||
          lowerMessage.includes('열어') || lowerMessage.includes('open')
        const hasScreenshotCommand = lowerMessage.includes('스크린샷') ||
          lowerMessage.includes('스샷') || lowerMessage.includes('screenshot') ||
          lowerMessage.includes('찍어') || lowerMessage.includes('캡처')

        let browserContext = ''
        let pageContent = ''

        console.log('[Handler] Command detection:', { hasOpenCommand, hasScreenshotCommand })

        // 브라우저가 활성화되어 있고 (puppeteer 모드이거나 relay 모드에서 연결된 경우)
        const browserReady = browserMode === 'puppeteer' || (browserMode === 'relay' && browserConnected)

        if (browserReady && (hasOpenCommand || hasScreenshotCommand)) {
          // URL 추출
          let targetUrl = ''
          const urlMatch = message.match(/https?:\/\/[^\s]+/i)
          if (urlMatch) {
            targetUrl = urlMatch[0]
          } else {
            for (const [key, url] of Object.entries(urlMap)) {
              if (lowerMessage.includes(key.toLowerCase())) {
                targetUrl = url
                break
              }
            }
          }

          if (targetUrl && hasOpenCommand) {
            try {
              console.log('[Handler] Opening URL via browser automation:', targetUrl)
              const openResult = await browser.openUrl(targetUrl, true)
              browserContext += `[브라우저] ${targetUrl}을 열었습니다.\n`
              console.log('[Handler] URL opened:', openResult)

              // 페이지 로드 대기
              await new Promise(r => setTimeout(r, 3000))

              // 페이지 텍스트 내용 가져오기 (새로 연 탭의 sessionId 사용)
              try {
                const html = await browser.getHtml(openResult.sessionId)
                // HTML에서 텍스트 추출 (간단한 방법)
                const textContent = html
                  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 10000) // 최대 10000자로 제한

                if (textContent) {
                  pageContent = textContent
                  browserContext += `[페이지 내용]\n${pageContent}\n\n`
                  console.log('[Handler] Page content extracted, length:', pageContent.length)
                }
              } catch (err) {
                console.error('[Handler] Failed to get page content:', err)
              }

              // 스크린샷도 요청했으면 촬영
              if (hasScreenshotCommand) {
                const screenshot = await browser.screenshot({
                  format: 'png',
                  sessionId: openResult.sessionId
                })
                const timestamp = Date.now()
                const filename = `screenshot-${timestamp}.png`
                const filePath = `${process.cwd()}/screenshots/${filename}`

                // 스크린샷 저장
                const { writeFileSync, mkdirSync, existsSync } = await import('node:fs')
                const screenshotsDir = `${process.cwd()}/screenshots`
                if (!existsSync(screenshotsDir)) {
                  mkdirSync(screenshotsDir, { recursive: true })
                }
                writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'))

                browserContext += `[스크린샷] http://127.0.0.1:${config.browserRelayPort}/screenshots/${filename}\n`
                console.log('[Handler] Screenshot saved:', filePath)
              }
            } catch (err) {
              console.error('[Handler] Browser automation error:', err)
              browserContext += `[브라우저 오류] ${err instanceof Error ? err.message : String(err)}\n`
            }
          } else if (hasScreenshotCommand && !targetUrl) {
            // URL 없이 스크린샷만 요청
            try {
              const screenshot = await browser.screenshot({ format: 'png' })
              const timestamp = Date.now()
              const filename = `screenshot-${timestamp}.png`
              const filePath = `${process.cwd()}/screenshots/${filename}`

              const { writeFileSync, mkdirSync, existsSync } = await import('node:fs')
              const screenshotsDir = `${process.cwd()}/screenshots`
              if (!existsSync(screenshotsDir)) {
                mkdirSync(screenshotsDir, { recursive: true })
              }
              writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'))

              browserContext += `[스크린샷] http://127.0.0.1:${config.browserRelayPort}/screenshots/${filename}\n`
              console.log('[Handler] Screenshot saved:', filePath)
            } catch (err) {
              console.error('[Handler] Screenshot error:', err)
              browserContext += `[스크린샷 오류] ${err instanceof Error ? err.message : String(err)}\n`
            }
          }
        }

        // 브라우저 컨텍스트가 있으면 메시지에 추가
        let finalMessage = message
        if (browserContext) {
          finalMessage = `${browserContext}\n---\n사용자 요청: ${message}`
          console.log('[Handler] Enhanced message with browser context')
        }

        // 칸반 관련 요청이면 컨텍스트 추가
        let kanbanContext = ''
        if (isKanbanRelated(message)) {
          console.log('[Handler] Kanban-related request detected')
          const tasks = chatDb.getTasks('default')
          kanbanContext = buildKanbanContext(tasks)
          finalMessage = `${kanbanContext}\n사용자 요청: ${finalMessage}`
          console.log('[Handler] Added kanban context, tasks count:', tasks.length)
        }

        console.log('[Handler] Calling runClaude...')

        const result = await runClaude({
          message: finalMessage,
          model: config.claudeModel,
          sessionId: currentSessionId,
          cwd: projectPath,
          claudePath: config.claudePath,
        })
        console.log('[Handler] runClaude result:', result)

        if (result) {
          const finalSessionId = result.sessionId || currentSessionId

          if (result.sessionId) {
            client.sessionId = result.sessionId
            sessions.set(client.id, result.sessionId)
          }

          // Claude 응답에서 칸반 명령 파싱 및 실행
          let responseText = result.text
          const kanbanCommands = parseKanbanCommands(responseText)
          if (kanbanCommands.length > 0) {
            console.log('[Handler] Found kanban commands:', kanbanCommands.length)
            const commandResults = executeKanbanCommands(kanbanCommands)
            // 명령 태그 제거하고 실행 결과 추가
            responseText = removeKanbanCommands(responseText)
            if (commandResults.length > 0) {
              responseText += '\n\n---\n**칸반 작업 결과:**\n' + commandResults.join('\n')
            }
            console.log('[Handler] Kanban commands executed:', commandResults)
          }

          // DB에 세션 확인/생성 및 메시지 저장
          if (finalSessionId) {
            chatDb.ensureSession(finalSessionId)
            chatDb.saveMessage(userMsgId, finalSessionId, 'user', message, userTimestamp)
            chatDb.saveMessage(generateId(), finalSessionId, 'assistant', responseText, Date.now())
          }

          console.log('[Handler] Sending chat.done event')
          ctx.sendEvent('chat.done', {
            sessionId: finalSessionId,
            text: responseText,
          })

          return {
            sessionId: finalSessionId,
            text: responseText,
          }
        }

        throw new Error('No response from Claude')
      } catch (err) {
        console.error('[Handler] Error:', err)
        const error = err instanceof Error ? err : new Error(String(err))
        ctx.sendEvent('chat.error', {
          sessionId: currentSessionId,
          error: error.message,
        })
        throw error
      }
    },

    'session.list': async () => {
      return sessions.list()
    },

    'session.get': async (params) => {
      const { sessionId } = params as { sessionId: string }
      return sessions.get(sessionId)
    },

    // 프로젝트 정보 (단일 프로젝트)
    'project.info': async () => {
      return {
        path: projectPath,
        name: projectPath.split('/').pop() || 'project',
      }
    },

    'ping': async () => {
      return { pong: Date.now() }
    },

    // 히스토리 관련 핸들러
    'history.sessions': async () => {
      return chatDb.getAllSessions()
    },

    'history.messages': async (params) => {
      const { sessionId } = params as HistoryLoadParams
      if (!sessionId) {
        throw new Error('sessionId is required')
      }
      return chatDb.getMessages(sessionId)
    },

    'history.delete': async (params) => {
      const { sessionId } = params as { sessionId: string }
      if (!sessionId) {
        throw new Error('sessionId is required')
      }
      const deleted = chatDb.deleteSession(sessionId)
      return { success: deleted }
    },

    // 프로젝트 설정 관련 핸들러 (CLAUDE.md, Skills, Agents)
    'config.claudeMd.get': async () => {
      return getClaudeMd(projectPath)
    },

    'config.claudeMd.save': async (params) => {
      const { content } = params as { content: string }
      const savedPath = await saveClaudeMd(projectPath, content)
      return { success: true, path: savedPath }
    },

    'config.planMd.get': async () => {
      return getPlanMd(projectPath)
    },

    'config.planMd.save': async (params) => {
      const { content } = params as { content: string }
      const savedPath = await savePlanMd(projectPath, content)
      return { success: true, path: savedPath }
    },

    'config.skills.list': async () => {
      return getSkills(projectPath)
    },

    'config.skills.save': async (params) => {
      const { name, content } = params as { name: string; content: string }
      if (!name) {
        throw new Error('name is required')
      }
      const savedPath = await saveSkill(projectPath, name, content)
      return { success: true, path: savedPath }
    },

    'config.skills.delete': async (params) => {
      const { name } = params as { name: string }
      if (!name) {
        throw new Error('name is required')
      }
      const deleted = await deleteSkill(projectPath, name)
      return { success: deleted }
    },

    'config.agents.list': async () => {
      return getAgents(projectPath)
    },

    'config.agents.save': async (params) => {
      const { name, content } = params as { name: string; content: string }
      if (!name) {
        throw new Error('name is required')
      }
      const savedPath = await saveAgent(projectPath, name, content)
      return { success: true, path: savedPath }
    },

    'config.agents.delete': async (params) => {
      const { name } = params as { name: string }
      if (!name) {
        throw new Error('name is required')
      }
      const deleted = await deleteAgent(projectPath, name)
      return { success: deleted }
    },

    // Browser Automation API
    'browser.status': async () => {
      return browser.getStatus()
    },

    'browser.screenshot': async (params) => {
      const { format, quality, fullPage } = (params || {}) as {
        format?: 'png' | 'jpeg'
        quality?: number
        fullPage?: boolean
      }
      return browser.screenshot({ format, quality, fullPage })
    },

    'browser.click': async (params) => {
      const { selector, x, y } = params as {
        selector?: string
        x?: number
        y?: number
      }
      await browser.click({ selector, x, y })
      return { success: true }
    },

    'browser.type': async (params) => {
      const { text, delay } = params as { text: string; delay?: number }
      if (!text) {
        throw new Error('text is required')
      }
      await browser.type({ text, delay })
      return { success: true }
    },

    'browser.navigate': async (params) => {
      const { url, waitUntil } = params as {
        url: string
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
      }
      if (!url) {
        throw new Error('url is required')
      }
      await browser.navigate({ url, waitUntil })
      return { success: true }
    },

    'browser.evaluate': async (params) => {
      const { script, returnByValue } = params as {
        script: string
        returnByValue?: boolean
      }
      if (!script) {
        throw new Error('script is required')
      }
      const result = await browser.evaluate({ script, returnByValue })
      return { result }
    },

    'browser.getTitle': async () => {
      const title = await browser.getTitle()
      return { title }
    },

    'browser.getUrl': async () => {
      const url = await browser.getUrl()
      return { url }
    },

    'browser.getHtml': async () => {
      const html = await browser.getHtml()
      return { html }
    },

    'browser.getText': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      const text = await browser.getText(selector)
      return { text }
    },

    'browser.exists': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      const exists = await browser.exists(selector)
      return { exists }
    },

    'browser.waitForSelector': async (params) => {
      const { selector, timeout } = params as { selector: string; timeout?: number }
      if (!selector) {
        throw new Error('selector is required')
      }
      const found = await browser.waitForSelector(selector, timeout)
      return { found }
    },

    'browser.scroll': async (params) => {
      const { x, y, selector } = params as { x?: number; y?: number; selector?: string }
      await browser.scroll({ x, y, selector })
      return { success: true }
    },

    'browser.clear': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      await browser.clear(selector)
      return { success: true }
    },

    'browser.focus': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      await browser.focus(selector)
      return { success: true }
    },

    'browser.openUrl': async (params) => {
      const { url, activate } = params as { url: string; activate?: boolean }
      if (!url) {
        throw new Error('url is required')
      }
      const result = await browser.openUrl(url, activate ?? true)
      return result
    },

    // 브라우저 시작/중지
    'browser.start': async (params) => {
      const { mode, save } = (params || {}) as { mode?: 'puppeteer' | 'relay'; save?: boolean }
      const targetMode = mode || config.browserMode
      if (targetMode === 'off') {
        throw new Error('Browser mode is set to off in config')
      }
      if (browser.isInitialized()) {
        throw new Error('Browser is already running')
      }
      await browser.initBrowser(targetMode, { port: config.browserRelayPort })

      // 설정 저장 (save가 true이거나 기본값)
      if (save !== false) {
        chatDb.setSetting('browser_mode', targetMode)
      }

      return { success: true, mode: targetMode }
    },

    'browser.stop': async (params) => {
      const { save } = (params || {}) as { save?: boolean }
      if (!browser.isInitialized()) {
        throw new Error('Browser is not running')
      }
      await browser.closeBrowser()

      // 설정 저장 (save가 true이거나 기본값)
      if (save !== false) {
        chatDb.setSetting('browser_mode', 'off')
      }

      return { success: true }
    },

    // 브라우저 설정 조회
    'browser.config.get': async () => {
      const savedMode = chatDb.getSetting('browser_mode') as 'off' | 'puppeteer' | 'relay' | undefined
      return {
        savedMode: savedMode || 'off',
        envMode: config.browserMode,
      }
    },

    // 브라우저 설정 저장
    'browser.config.save': async (params) => {
      const { mode } = params as { mode: 'off' | 'puppeteer' | 'relay' }
      if (!mode || !['off', 'puppeteer', 'relay'].includes(mode)) {
        throw new Error('Invalid mode')
      }
      chatDb.setSetting('browser_mode', mode)
      return { success: true, mode }
    },

    // === 칸반 태스크 API ===

    // 태스크 목록 조회
    'kanban.tasks.list': async (params) => {
      const { projectId } = (params || {}) as { projectId?: string }
      // 단일 프로젝트 모드이므로 projectId가 없으면 'default' 사용
      const pid = projectId || 'default'
      return chatDb.getTasks(pid)
    },

    // 태스크 생성
    'kanban.tasks.create': async (params) => {
      const { projectId, title, description, status, priority, slackMessageTs, slackChannelId } = params as {
        projectId?: string
        title: string
        description?: string
        status?: 'todo' | 'in_progress' | 'done'
        priority?: 'low' | 'medium' | 'high'
        slackMessageTs?: string
        slackChannelId?: string
      }

      if (!title) {
        throw new Error('title is required')
      }

      const id = generateId()
      const task = chatDb.createTask({
        id,
        projectId: projectId || 'default',
        title,
        description,
        status,
        priority,
        slackMessageTs,
        slackChannelId,
      })

      return task
    },

    // 태스크 수정
    'kanban.tasks.update': async (params) => {
      const { id, title, description, status, priority, position } = params as {
        id: string
        title?: string
        description?: string
        status?: 'todo' | 'in_progress' | 'done'
        priority?: 'low' | 'medium' | 'high'
        position?: number
      }

      if (!id) {
        throw new Error('id is required')
      }

      const updated = chatDb.updateTask(id, { title, description, status, priority, position })
      if (!updated) {
        throw new Error('Task not found')
      }

      return updated
    },

    // 태스크 삭제
    'kanban.tasks.delete': async (params) => {
      const { id } = params as { id: string }

      if (!id) {
        throw new Error('id is required')
      }

      const deleted = chatDb.deleteTask(id)
      return { success: deleted }
    },

    // 단일 태스크 조회
    'kanban.tasks.get': async (params) => {
      const { id } = params as { id: string }

      if (!id) {
        throw new Error('id is required')
      }

      const task = chatDb.getTask(id)
      if (!task) {
        throw new Error('Task not found')
      }

      return task
    },

    // === 크론 작업 API ===

    // 크론 작업 목록 조회
    'cron.list': async (params) => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      const { includeDisabled } = (params || {}) as { includeDisabled?: boolean }
      return cronService.list({ includeDisabled })
    },

    // 크론 작업 추가
    'cron.add': async (params) => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      const { name, schedule, payload, slackChannelId, enabled, deleteAfterRun } = params as {
        name: string
        schedule: { kind: 'at'; atMs: number } | { kind: 'every'; everyMs: number } | { kind: 'cron'; expr: string; tz?: string }
        payload: { kind: 'notify' | 'agent'; message: string; model?: string }
        slackChannelId: string
        enabled?: boolean
        deleteAfterRun?: boolean
      }

      if (!name) throw new Error('name is required')
      if (!schedule) throw new Error('schedule is required')
      if (!payload) throw new Error('payload is required')
      if (!slackChannelId) throw new Error('slackChannelId is required')

      return cronService.add({
        name,
        schedule,
        payload,
        slackChannelId,
        enabled: enabled !== false,
        deleteAfterRun: deleteAfterRun || false,
      })
    },

    // 크론 작업 수정
    'cron.update': async (params) => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      const { id, ...patch } = params as {
        id: string
        name?: string
        schedule?: { kind: 'at'; atMs: number } | { kind: 'every'; everyMs: number } | { kind: 'cron'; expr: string; tz?: string }
        payload?: { kind: 'notify' | 'agent'; message: string; model?: string }
        slackChannelId?: string
        enabled?: boolean
        deleteAfterRun?: boolean
      }

      if (!id) throw new Error('id is required')

      const updated = await cronService.update(id, patch)
      if (!updated) {
        throw new Error('Cron job not found')
      }
      return updated
    },

    // 크론 작업 삭제
    'cron.remove': async (params) => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      const { id } = params as { id: string }
      if (!id) throw new Error('id is required')

      return cronService.remove(id)
    },

    // 크론 작업 즉시 실행
    'cron.run': async (params) => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      const { id } = params as { id: string }
      if (!id) throw new Error('id is required')

      return cronService.run(id)
    },

    // 크론 상태 조회
    'cron.status': async () => {
      if (!cronService) {
        throw new Error('Cron service not initialized')
      }
      return cronService.status()
    },
  }
}
