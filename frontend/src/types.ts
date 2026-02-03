export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
}

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

export interface ChatSendResult {
  sessionId: string
  text: string
}

export interface ChatDeltaData {
  sessionId: string
  text: string
}

export interface ChatDoneData {
  sessionId: string
  text: string
}

export interface ChatErrorData {
  sessionId: string
  error: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface ChatSession {
  id: string
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface DbMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// 프로젝트 설정 관련 타입
export interface ClaudeMdInfo {
  exists: boolean
  content: string
  path: string
}

export interface PlanMdInfo {
  exists: boolean
  content: string
  path: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  content: string
}

export interface AgentInfo {
  name: string
  description: string
  path: string
  content: string
  model?: string
  tools?: string[]
}

// Kanban Board 타입
export interface KanbanTask {
  id: string
  project_id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  position: number
  created_at: number
  updated_at: number
}

// Slack 설정 타입
export interface SlackConfig {
  enabled: boolean
  botToken: string
  appToken: string
}

// Browser Relay 상태 타입
export interface BrowserTarget {
  sessionId: string
  targetId: string
  targetInfo: {
    targetId: string
    type?: string
    title?: string
    url?: string
    attached?: boolean
  }
}

export interface BrowserStatus {
  connected: boolean
  extensionConnected: boolean
  targets: BrowserTarget[]
  activeTargetId?: string
  relayRunning: boolean
}
