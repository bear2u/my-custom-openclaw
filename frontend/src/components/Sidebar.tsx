import { useNavigate } from 'react-router-dom'
import type { Project, ChatSession } from '../types'
import './Sidebar.css'

interface SidebarProps {
  // 프로젝트 관련 (단일 프로젝트)
  project: Project | null
  // 세션 관련
  sessions: ChatSession[]
  currentSessionId: string | null
  onSessionSelect: (sessionId: string) => Promise<void>
  onSessionDelete: (sessionId: string) => Promise<boolean>
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

export function Sidebar({
  project,
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  onNewChat,
}: SidebarProps) {
  const navigate = useNavigate()

  const handleProjectSettings = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (project) {
      navigate(`/settings/${project.id}`)
    }
  }

  const handleProjectKanban = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (project) {
      navigate(`/kanban/${project.id}`)
    }
  }

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('이 대화를 삭제하시겠습니까?')) {
      await onSessionDelete(id)
    }
  }

  return (
    <div className="sidebar">
      {/* 프로젝트 섹션 (단일 프로젝트) */}
      <div className="sidebar-section">
        <div className="section-header">
          <h2>프로젝트</h2>
        </div>

        <div className="item-list project-list">
          {project ? (
            <div className="list-item selected" title={project.path}>
              <span className="item-icon">📁</span>
              <div className="item-info">
                <span className="item-name">{project.name}</span>
                <span className="item-sub">{project.path}</span>
              </div>
              <div className="item-actions">
                <button
                  className="kanban-btn"
                  onClick={handleProjectKanban}
                  title="칸반 보드"
                >
                  📋
                </button>
                <button
                  className="settings-btn"
                  onClick={handleProjectSettings}
                  title="설정"
                >
                  ⚙
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-message">프로젝트 로딩 중...</div>
          )}
        </div>
      </div>

      {/* 대화 기록 섹션 */}
      <div className="sidebar-section sessions-section">
        <div className="section-header">
          <h2>대화 기록</h2>
          <button className="section-btn" onClick={onNewChat} title="새 대화">
            +
          </button>
        </div>

        <div className="item-list session-list">
          {sessions.length === 0 ? (
            <div className="empty-message">대화 기록이 없습니다</div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`list-item session-item ${currentSessionId === session.id ? 'selected' : ''}`}
                onClick={() => onSessionSelect(session.id)}
              >
                <div className="item-info">
                  <span className="item-name session-id">{session.id.slice(0, 8)}...</span>
                  <span className="item-sub">{formatDate(session.updated_at)}</span>
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  title="삭제"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
