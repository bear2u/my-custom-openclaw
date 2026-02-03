import type { WebSocketClient } from './server.js'
import { runClaude } from '../claude/runner.js'
import { SessionManager } from '../session/manager.js'
import { ProjectManager } from '../project/manager.js'
import { chatDb, kanbanDb } from '../db/database.js'
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
  getSlackConfig,
  saveSlackConfig,
  type SlackConfig,
} from '../project/config.js'
import type { Config } from '../config.js'
import { browserTool, getRelayServer } from '../browser/index.js'

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
  projectId?: string  // 프로젝트 ID 추가
}

interface ProjectAddParams {
  name: string
  path: string
}

interface ProjectRemoveParams {
  id: string
}

interface HistoryLoadParams {
  sessionId: string
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function createHandlers(
  config: Config,
  sessions: SessionManager,
  projects: ProjectManager
): Record<string, RpcHandler> {
  return {
    'chat.send': async (params, client, ctx) => {
      const { message, sessionId, projectId } = params as ChatSendParams
      console.log('[Handler] chat.send called with:', { message, sessionId, projectId })

      if (!message || typeof message !== 'string') {
        throw new Error('message is required')
      }

      // 프로젝트 경로 가져오기
      let cwd: string | undefined
      if (projectId) {
        const project = await projects.get(projectId)
        if (project) {
          cwd = project.path
          console.log('[Handler] Using project path:', cwd)
        }
      }

      const currentSessionId = sessionId || client.sessionId
      console.log('[Handler] Using sessionId:', currentSessionId)

      ctx.sendEvent('chat.start', { sessionId: currentSessionId })

      // 사용자 메시지 저장
      const userMsgId = generateId()
      const userTimestamp = Date.now()

      try {
        // 브라우저 명령어 패턴 감지 (URL 열기, 스크린샷 등)
        const relay = getRelayServer()
        const extensionConnected = relay?.extensionConnected() ?? false
        console.log('[Handler] Browser relay status:', {
          relayExists: !!relay,
          extensionConnected
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

        let browserResult = ''

        console.log('[Handler] Command detection:', { hasOpenCommand, hasScreenshotCommand, targetUrl: '' })

        if (relay && extensionConnected && (hasOpenCommand || hasScreenshotCommand)) {
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
              const openResult = await browserTool.openUrl(targetUrl, true)
              browserResult += `브라우저에서 ${targetUrl}을 열었습니다. (Tab ID: ${openResult.tabId})\n`
              console.log('[Handler] URL opened:', openResult)

              // 스크린샷도 요청했으면 촬영
              if (hasScreenshotCommand) {
                await new Promise(r => setTimeout(r, 2000)) // 페이지 로드 대기
                // 방금 열린 탭의 sessionId로 스크린샷
                const screenshot = await browserTool.screenshot({
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

                browserResult += `\n스크린샷을 촬영했습니다:\n![Screenshot](http://127.0.0.1:18792/screenshots/${filename})\n`
                console.log('[Handler] Screenshot saved:', filePath)
              }
            } catch (err) {
              console.error('[Handler] Browser automation error:', err)
              browserResult += `브라우저 자동화 오류: ${err instanceof Error ? err.message : String(err)}\n`
            }
          } else if (hasScreenshotCommand && !targetUrl) {
            // URL 없이 스크린샷만 요청
            try {
              const screenshot = await browserTool.screenshot({ format: 'png' })
              const timestamp = Date.now()
              const filename = `screenshot-${timestamp}.png`
              const filePath = `${process.cwd()}/screenshots/${filename}`

              const { writeFileSync, mkdirSync, existsSync } = await import('node:fs')
              const screenshotsDir = `${process.cwd()}/screenshots`
              if (!existsSync(screenshotsDir)) {
                mkdirSync(screenshotsDir, { recursive: true })
              }
              writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'))

              browserResult += `스크린샷을 촬영했습니다:\n![Screenshot](http://127.0.0.1:18792/screenshots/${filename})\n`
              console.log('[Handler] Screenshot saved:', filePath)
            } catch (err) {
              console.error('[Handler] Screenshot error:', err)
              browserResult += `스크린샷 오류: ${err instanceof Error ? err.message : String(err)}\n`
            }
          }
        }

        console.log('[Handler] Calling runClaude...')

        // MCP 서버는 사용하지 않음 (Claude CLI 호환성 문제)
        const mcpServers = undefined

        // 브라우저 자동화 결과가 있으면 바로 응답 (Claude 호출 안함)
        if (browserResult) {
          // 세션 ID가 없으면 새로 생성
          const finalSessionId = currentSessionId || generateId()

          // DB에 세션 확인/생성 및 메시지 저장
          chatDb.ensureSession(finalSessionId, projectId || null)
          chatDb.saveMessage(userMsgId, finalSessionId, 'user', message, userTimestamp)
          chatDb.saveMessage(generateId(), finalSessionId, 'assistant', browserResult, Date.now())

          console.log('[Handler] Sending browser result directly')
          ctx.sendEvent('chat.done', {
            sessionId: finalSessionId,
            text: browserResult,
          })

          return {
            sessionId: finalSessionId,
            text: browserResult,
          }
        }

        const result = await runClaude({
          message,
          model: config.claudeModel,
          sessionId: currentSessionId,
          cwd,
          mcpServers,
        })
        console.log('[Handler] runClaude result:', result)

        if (result) {
          const finalSessionId = result.sessionId || currentSessionId

          if (result.sessionId) {
            client.sessionId = result.sessionId
            sessions.set(client.id, result.sessionId)
          }

          // DB에 세션 확인/생성 및 메시지 저장
          if (finalSessionId) {
            chatDb.ensureSession(finalSessionId, projectId || null)
            chatDb.saveMessage(userMsgId, finalSessionId, 'user', message, userTimestamp)
            chatDb.saveMessage(generateId(), finalSessionId, 'assistant', result.text, Date.now())
          }

          console.log('[Handler] Sending chat.done event')
          ctx.sendEvent('chat.done', {
            sessionId: finalSessionId,
            text: result.text,
          })

          return {
            sessionId: finalSessionId,
            text: result.text,
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

    // 프로젝트 관련 핸들러
    'project.list': async () => {
      return projects.list()
    },

    'project.add': async (params) => {
      const { name, path, createIfNotExists } = params as ProjectAddParams & { createIfNotExists?: boolean }
      if (!name || !path) {
        throw new Error('name and path are required')
      }
      return projects.add(name, path, createIfNotExists)
    },

    'project.remove': async (params) => {
      const { id } = params as ProjectRemoveParams
      if (!id) {
        throw new Error('id is required')
      }
      const deleted = await projects.remove(id)
      return { success: deleted }
    },

    'project.get': async (params) => {
      const { id } = params as { id: string }
      return projects.get(id)
    },

    'ping': async () => {
      return { pong: Date.now() }
    },

    // 히스토리 관련 핸들러
    'history.sessions': async (params) => {
      const { projectId } = (params || {}) as { projectId?: string }
      return chatDb.getSessionsByProject(projectId || null)
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
    'config.claudeMd.get': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      return getClaudeMd(project.path)
    },

    'config.claudeMd.save': async (params) => {
      const { projectId, content } = params as { projectId: string; content: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const savedPath = await saveClaudeMd(project.path, content)
      return { success: true, path: savedPath }
    },

    'config.planMd.get': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      return getPlanMd(project.path)
    },

    'config.planMd.save': async (params) => {
      const { projectId, content } = params as { projectId: string; content: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const savedPath = await savePlanMd(project.path, content)
      return { success: true, path: savedPath }
    },

    'config.skills.list': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      return getSkills(project.path)
    },

    'config.skills.save': async (params) => {
      const { projectId, name, content } = params as { projectId: string; name: string; content: string }
      if (!projectId || !name) {
        throw new Error('projectId and name are required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const savedPath = await saveSkill(project.path, name, content)
      return { success: true, path: savedPath }
    },

    'config.skills.delete': async (params) => {
      const { projectId, name } = params as { projectId: string; name: string }
      if (!projectId || !name) {
        throw new Error('projectId and name are required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const deleted = await deleteSkill(project.path, name)
      return { success: deleted }
    },

    'config.agents.list': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      return getAgents(project.path)
    },

    'config.agents.save': async (params) => {
      const { projectId, name, content } = params as { projectId: string; name: string; content: string }
      if (!projectId || !name) {
        throw new Error('projectId and name are required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const savedPath = await saveAgent(project.path, name, content)
      return { success: true, path: savedPath }
    },

    'config.agents.delete': async (params) => {
      const { projectId, name } = params as { projectId: string; name: string }
      if (!projectId || !name) {
        throw new Error('projectId and name are required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const deleted = await deleteAgent(project.path, name)
      return { success: deleted }
    },

    // Kanban Board API
    'kanban.tasks.list': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      return kanbanDb.getTasksByProject(projectId)
    },

    'kanban.tasks.create': async (params) => {
      const { projectId, title, description, status, priority } = params as {
        projectId: string
        title: string
        description?: string
        status?: 'todo' | 'in_progress' | 'done'
        priority?: 'low' | 'medium' | 'high'
      }
      if (!projectId || !title) {
        throw new Error('projectId and title are required')
      }
      return kanbanDb.createTask(projectId, title, description, status, priority)
    },

    'kanban.tasks.update': async (params) => {
      const { id, ...updates } = params as {
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
      const task = kanbanDb.updateTask(id, updates)
      if (!task) {
        throw new Error('Task not found')
      }
      return task
    },

    'kanban.tasks.delete': async (params) => {
      const { id } = params as { id: string }
      if (!id) {
        throw new Error('id is required')
      }
      const deleted = kanbanDb.deleteTask(id)
      return { success: deleted }
    },

    'kanban.tasks.get': async (params) => {
      const { id } = params as { id: string }
      if (!id) {
        throw new Error('id is required')
      }
      const task = kanbanDb.getTask(id)
      if (!task) {
        throw new Error('Task not found')
      }
      return task
    },

    // Slack 설정 API
    'config.slack.get': async (params) => {
      const { projectId } = params as { projectId: string }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      return getSlackConfig(project.path)
    },

    'config.slack.save': async (params) => {
      const { projectId, config: slackConfig } = params as { projectId: string; config: SlackConfig }
      if (!projectId) {
        throw new Error('projectId is required')
      }
      const project = await projects.get(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      await saveSlackConfig(project.path, slackConfig)
      return { success: true }
    },

    // Browser Automation API
    'browser.status': async () => {
      const relay = getRelayServer()
      if (!relay) {
        return {
          connected: false,
          extensionConnected: false,
          targets: [],
          activeTargetId: undefined,
          relayRunning: false,
        }
      }
      return {
        ...relay.getStatus(),
        relayRunning: true,
      }
    },

    'browser.screenshot': async (params) => {
      const { format, quality, fullPage } = (params || {}) as {
        format?: 'png' | 'jpeg'
        quality?: number
        fullPage?: boolean
      }
      return browserTool.screenshot({ format, quality, fullPage })
    },

    'browser.click': async (params) => {
      const { selector, x, y } = params as {
        selector?: string
        x?: number
        y?: number
      }
      await browserTool.click({ selector, x, y })
      return { success: true }
    },

    'browser.type': async (params) => {
      const { text, delay } = params as { text: string; delay?: number }
      if (!text) {
        throw new Error('text is required')
      }
      await browserTool.type({ text, delay })
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
      await browserTool.navigate({ url, waitUntil })
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
      const result = await browserTool.evaluate({ script, returnByValue })
      return { result }
    },

    'browser.getTitle': async () => {
      const title = await browserTool.getTitle()
      return { title }
    },

    'browser.getUrl': async () => {
      const url = await browserTool.getUrl()
      return { url }
    },

    'browser.getHtml': async () => {
      const html = await browserTool.getHtml()
      return { html }
    },

    'browser.getText': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      const text = await browserTool.getText(selector)
      return { text }
    },

    'browser.exists': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      const exists = await browserTool.exists(selector)
      return { exists }
    },

    'browser.waitForSelector': async (params) => {
      const { selector, timeout } = params as { selector: string; timeout?: number }
      if (!selector) {
        throw new Error('selector is required')
      }
      const found = await browserTool.waitForSelector(selector, timeout)
      return { found }
    },

    'browser.scroll': async (params) => {
      const { x, y, selector } = params as { x?: number; y?: number; selector?: string }
      await browserTool.scroll({ x, y, selector })
      return { success: true }
    },

    'browser.clear': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      await browserTool.clear(selector)
      return { success: true }
    },

    'browser.focus': async (params) => {
      const { selector } = params as { selector: string }
      if (!selector) {
        throw new Error('selector is required')
      }
      await browserTool.focus(selector)
      return { success: true }
    },

    'browser.openUrl': async (params) => {
      const { url, activate } = params as { url: string; activate?: boolean }
      if (!url) {
        throw new Error('url is required')
      }
      const result = await browserTool.openUrl(url, activate ?? true)
      return result
    },
  }
}
