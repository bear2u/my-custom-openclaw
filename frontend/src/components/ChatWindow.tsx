import type { Message, ConnectionStatus, Project, KanbanTask, BrowserStatus } from '../types'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import './ChatWindow.css'

export interface ChatWindowProps {
  messages: Message[]
  status: ConnectionStatus
  sessionId: string | null
  project: Project | null
  browserStatus?: BrowserStatus | null
  onSend: (content: string) => void
  onClear: () => void
  attachedTask?: KanbanTask | null
  onClearAttachedTask?: () => void
}

export function ChatWindow({
  messages,
  status,
  sessionId,
  project,
  browserStatus,
  onSend,
  onClear,
  attachedTask,
  onClearAttachedTask,
}: ChatWindowProps) {
  const isConnected = status === 'connected'
  const isLoading = messages.some((m) => m.isStreaming)

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="header-left">
          <h1>Claude Gateway</h1>
          <span className={`status-badge ${status}`}>
            {status === 'connected' && '● 연결됨'}
            {status === 'connecting' && '○ 연결 중...'}
            {status === 'disconnected' && '○ 연결 끊김'}
            {status === 'error' && '✕ 오류'}
          </span>
          {browserStatus && browserStatus.mode !== 'off' && (
            <span className={`browser-badge ${browserStatus.mode}`}>
              🌐 {browserStatus.mode === 'puppeteer' ? 'Puppeteer' : 'Relay'}
              {browserStatus.mode === 'relay' && (
                browserStatus.extensionConnected ? ' ●' : ' ○'
              )}
            </span>
          )}
        </div>
        <div className="header-right">
          {project && (
            <span className="project-badge" title={project.path}>
              📁 {project.name}
            </span>
          )}
          {sessionId && (
            <span className="session-info" title={sessionId}>
              세션: {sessionId.slice(0, 8)}...
            </span>
          )}
          <button className="clear-button" onClick={onClear}>
            새 대화
          </button>
        </div>
      </div>

      <MessageList messages={messages} />

      {/* 첨부된 태스크 표시 */}
      {attachedTask && (
        <div className="attached-task">
          <div className="attached-task-content">
            <span className="attached-label">📋 첨부된 이슈:</span>
            <span className="attached-title">{attachedTask.title}</span>
            <span className="attached-id">#{attachedTask.id.slice(0, 6)}</span>
          </div>
          <button className="attached-remove" onClick={onClearAttachedTask}>
            ×
          </button>
        </div>
      )}

      <MessageInput
        onSend={(content) => {
          if (attachedTask) {
            const taskInfo = `[이슈 #${attachedTask.id.slice(0, 6)}] ${attachedTask.title}\n${attachedTask.description ? `설명: ${attachedTask.description}\n` : ''}상태: ${attachedTask.status === 'todo' ? '할 일' : attachedTask.status === 'in_progress' ? '진행 중' : '완료'}\n우선순위: ${attachedTask.priority === 'low' ? '낮음' : attachedTask.priority === 'medium' ? '보통' : '높음'}\n\n${content}`
            onSend(taskInfo)
            onClearAttachedTask?.()
          } else {
            onSend(content)
          }
        }}
        disabled={!isConnected || isLoading}
      />
    </div>
  )
}
