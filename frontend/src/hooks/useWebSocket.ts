import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Message,
  RpcRequest,
  RpcResponse,
  EventMessage,
  ChatDoneData,
  ChatErrorData,
  ConnectionStatus,
  Project,
  ChatSession,
  DbMessage,
} from '../types'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

// localStorage 키
const STORAGE_KEYS = {
  PROJECT_ID: 'claude-gateway-project-id',
  SESSION_ID: 'claude-gateway-session-id',
}

interface UseWebSocketReturn {
  messages: Message[]
  status: ConnectionStatus
  sessionId: string | null
  projectId: string | null
  projects: Project[]
  sessions: ChatSession[]
  sendMessage: (content: string) => void
  clearMessages: () => void
  setProjectId: (id: string | null) => void
  loadProjects: () => Promise<void>
  addProject: (name: string, path: string, createIfNotExists?: boolean) => Promise<Project>
  removeProject: (id: string) => Promise<boolean>
  loadSessions: () => Promise<void>
  loadHistory: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<boolean>
  sendRpc: <T>(method: string, params?: unknown) => Promise<T>
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef<Map<string, (response: RpcResponse) => void>>(new Map())
  const projectIdRef = useRef<string | null>(null)

  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.SESSION_ID)
  })
  const [projectId, setProjectIdState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.PROJECT_ID)
  })
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const initialLoadDone = useRef(false)
  const [sessionRefreshTrigger, setSessionRefreshTrigger] = useState(0)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      setStatus('connected')
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      setStatus('disconnected')
      // Auto reconnect after 3 seconds
      setTimeout(() => connect(), 3000)
    }

    ws.onerror = (error) => {
      console.error('[WS] Error:', error)
      setStatus('error')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RpcResponse | EventMessage

        // Handle RPC response
        if ('id' in data && data.id) {
          const pending = pendingRef.current.get(data.id)
          if (pending) {
            pending(data as RpcResponse)
            pendingRef.current.delete(data.id)
          }
          return
        }

        // Handle events
        if ('event' in data) {
          handleEvent(data as EventMessage)
        }
      } catch (err) {
        console.error('[WS] Parse error:', err)
      }
    }
  }, [url])

  const handleEvent = useCallback((event: EventMessage) => {
    switch (event.event) {
      case 'connected':
        console.log('[WS] Server acknowledged connection')
        break

      case 'chat.start':
        // Add placeholder for streaming response
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
          },
        ])
        break

      case 'chat.done': {
        const doneData = event.data as ChatDoneData
        setSessionId(doneData.sessionId)
        // sessionId를 localStorage에 저장
        if (doneData.sessionId) {
          localStorage.setItem(STORAGE_KEYS.SESSION_ID, doneData.sessionId)
        }
        setMessages((prev) => {
          const updated = [...prev]
          const lastIndex = updated.findLastIndex((m: Message) => m.role === 'assistant')
          if (lastIndex !== -1) {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: doneData.text,
              isStreaming: false,
            }
          }
          return updated
        })
        // 세션 목록 새로고침 트리거
        setSessionRefreshTrigger((prev) => prev + 1)
        break
      }

      case 'chat.error': {
        const errorData = event.data as ChatErrorData
        setMessages((prev) => {
          const updated = [...prev]
          const lastIndex = updated.findLastIndex((m: Message) => m.role === 'assistant')
          if (lastIndex !== -1) {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: `Error: ${errorData.error}`,
              isStreaming: false,
            }
          }
          return updated
        })
        break
      }

      default:
        console.log('[WS] Unknown event:', event.event)
    }
  }, [])

  const sendRpc = useCallback(
    <T>(method: string, params?: unknown): Promise<T> => {
      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket not connected'))
          return
        }

        const id = generateId()
        const request: RpcRequest = { id, method, params }

        pendingRef.current.set(id, (response) => {
          if (response.ok) {
            resolve(response.result as T)
          } else {
            reject(new Error(response.error?.message || 'Unknown error'))
          }
        })

        wsRef.current.send(JSON.stringify(request))

        // Timeout after 2 minutes
        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id)
            reject(new Error('Request timeout'))
          }
        }, 120000)
      })
    },
    []
  )

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return

      // Add user message immediately
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMessage])

      // Send to server
      sendRpc('chat.send', { message: content, sessionId, projectId }).catch((err) => {
        console.error('[WS] Send error:', err)
        // Add error message
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: `Error: ${err.message}`,
            timestamp: Date.now(),
          },
        ])
      })
    },
    [sendRpc, sessionId, projectId]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setSessionId(null)
    localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
  }, [])

  // projectId setter with localStorage
  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id)
    projectIdRef.current = id
    if (id) {
      localStorage.setItem(STORAGE_KEYS.PROJECT_ID, id)
    } else {
      localStorage.removeItem(STORAGE_KEYS.PROJECT_ID)
    }
  }, [])

  // 프로젝트 관련 함수들
  const loadProjects = useCallback(async () => {
    try {
      const list = await sendRpc<Project[]>('project.list')
      setProjects(list)
    } catch (err) {
      console.error('[WS] Failed to load projects:', err)
    }
  }, [sendRpc])

  const addProject = useCallback(
    async (name: string, path: string, createIfNotExists?: boolean): Promise<Project> => {
      const project = await sendRpc<Project>('project.add', { name, path, createIfNotExists })
      setProjects((prev) => [project, ...prev])
      return project
    },
    [sendRpc]
  )

  const removeProject = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await sendRpc<{ success: boolean }>('project.remove', { id })
      if (result.success) {
        setProjects((prev) => prev.filter((p) => p.id !== id))
        if (projectId === id) {
          setProjectId(null)
        }
      }
      return result.success
    },
    [sendRpc, projectId]
  )

  // 히스토리 관련 함수들
  const loadSessions = useCallback(async () => {
    try {
      const list = await sendRpc<ChatSession[]>('history.sessions', { projectId })
      setSessions(list)
    } catch (err) {
      console.error('[WS] Failed to load sessions:', err)
    }
  }, [sendRpc, projectId])

  const loadHistory = useCallback(
    async (targetSessionId: string) => {
      try {
        const dbMessages = await sendRpc<DbMessage[]>('history.messages', { sessionId: targetSessionId })
        const loadedMessages: Message[] = dbMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }))
        setMessages(loadedMessages)
        setSessionId(targetSessionId)
        localStorage.setItem(STORAGE_KEYS.SESSION_ID, targetSessionId)
      } catch (err) {
        console.error('[WS] Failed to load history:', err)
      }
    },
    [sendRpc]
  )

  const deleteSession = useCallback(
    async (targetSessionId: string): Promise<boolean> => {
      const result = await sendRpc<{ success: boolean }>('history.delete', { sessionId: targetSessionId })
      if (result.success) {
        setSessions((prev) => prev.filter((s) => s.id !== targetSessionId))
        if (sessionId === targetSessionId) {
          setMessages([])
          setSessionId(null)
        }
      }
      return result.success
    },
    [sendRpc, sessionId]
  )

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  // 연결 후 초기 데이터 로드 및 마지막 세션 복원
  useEffect(() => {
    if (status !== 'connected' || initialLoadDone.current) return

    const initializeData = async () => {
      initialLoadDone.current = true

      try {
        // 프로젝트 목록 로드
        const projectList = await sendRpc<Project[]>('project.list')
        setProjects(projectList)

        // 세션 목록 로드
        const sessionList = await sendRpc<ChatSession[]>('history.sessions', { projectId })
        setSessions(sessionList)

        // 저장된 sessionId가 있으면 히스토리 로드
        const savedSessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID)
        if (savedSessionId) {
          // 해당 세션이 실제로 존재하는지 확인
          const sessionExists = sessionList.some(s => s.id === savedSessionId)
          if (sessionExists) {
            const dbMessages = await sendRpc<DbMessage[]>('history.messages', { sessionId: savedSessionId })
            const loadedMessages: Message[] = dbMessages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            }))
            setMessages(loadedMessages)
            setSessionId(savedSessionId)
          } else {
            // 세션이 없으면 localStorage에서 제거
            localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
            setSessionId(null)
          }
        }
      } catch (err) {
        console.error('[WS] Failed to initialize:', err)
      }
    }

    initializeData()
  }, [status, sendRpc, projectId])

  // 세션 목록 새로고침 (채팅 완료 시)
  useEffect(() => {
    if (sessionRefreshTrigger === 0 || status !== 'connected') return

    const refreshSessions = async () => {
      try {
        const sessionList = await sendRpc<ChatSession[]>('history.sessions', { projectId: projectIdRef.current })
        setSessions(sessionList)
      } catch (err) {
        console.error('[WS] Failed to refresh sessions:', err)
      }
    }

    refreshSessions()
  }, [sessionRefreshTrigger, status, sendRpc])

  return {
    messages,
    status,
    sessionId,
    projectId,
    projects,
    sessions,
    sendMessage,
    clearMessages,
    setProjectId,
    loadProjects,
    addProject,
    removeProject,
    loadSessions,
    loadHistory,
    deleteSession,
    sendRpc,
  }
}
