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
        console.log('[Handler] Calling runClaude...')
        const result = await runClaude({
          message,
          model: config.claudeModel,
          sessionId: currentSessionId,
          cwd,
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
      const { name, path } = params as ProjectAddParams
      if (!name || !path) {
        throw new Error('name and path are required')
      }
      return projects.add(name, path)
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
  }
}
