import { useEffect } from 'react'
import type { ChatSession } from '../types'
import './SessionList.css'

interface SessionListProps {
  sessions: ChatSession[]
  currentSessionId: string | null
  onLoad: () => Promise<void>
  onSelect: (sessionId: string) => Promise<void>
  onDelete: (sessionId: string) => Promise<boolean>
  onNewChat: () => void
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return '어제'
  } else if (diffDays < 7) {
    return `${diffDays}일 전`
  } else {
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }
}

export function SessionList({
  sessions,
  currentSessionId,
  onLoad,
  onSelect,
  onDelete,
  onNewChat,
}: SessionListProps) {
  useEffect(() => {
    onLoad()
  }, [onLoad])

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('이 대화를 삭제하시겠습니까?')) {
      await onDelete(id)
    }
  }

  return (
    <div className="session-list">
      <div className="session-header">
        <h3>대화 기록</h3>
        <button className="new-chat-btn" onClick={onNewChat} title="새 대화">
          +
        </button>
      </div>

      <div className="session-items">
        {sessions.length === 0 ? (
          <div className="empty-sessions">
            대화 기록이 없습니다.
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
              onClick={() => onSelect(session.id)}
            >
              <div className="session-info">
                <span className="session-id" title={session.id}>
                  {session.id.slice(0, 8)}...
                </span>
                <span className="session-date">
                  {formatDate(session.updated_at)}
                </span>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => handleDelete(session.id, e)}
                title="삭제"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
