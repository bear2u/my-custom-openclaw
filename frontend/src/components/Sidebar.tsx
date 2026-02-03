import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project, ChatSession } from '../types'
import './Sidebar.css'

interface SidebarProps {
  // 프로젝트 관련
  projects: Project[]
  selectedProjectId: string | null
  onProjectSelect: (id: string | null) => void
  onProjectAdd: (name: string, path: string, createIfNotExists?: boolean) => Promise<Project>
  onProjectRemove: (id: string) => Promise<boolean>
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
  projects,
  selectedProjectId,
  onProjectSelect,
  onProjectAdd,
  onProjectRemove,
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  onNewChat,
}: SidebarProps) {
  const navigate = useNavigate()
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showCreateConfirm, setShowCreateConfirm] = useState(false)
  const [pendingPath, setPendingPath] = useState('')

  const handleAddProject = async (createIfNotExists = false) => {
    if (!newName.trim() || !newPath.trim()) {
      setError('이름과 경로를 모두 입력해주세요')
      return
    }

    try {
      setError(null)
      setShowCreateConfirm(false)
      await onProjectAdd(newName.trim(), newPath.trim(), createIfNotExists)
      setNewName('')
      setNewPath('')
      setPendingPath('')
      setIsAddingProject(false)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '프로젝트 추가 실패'
      // 디렉토리가 없는 경우 생성 여부 확인
      if (errorMsg.startsWith('DIRECTORY_NOT_EXISTS:')) {
        const path = errorMsg.replace('DIRECTORY_NOT_EXISTS:', '')
        setPendingPath(path)
        setShowCreateConfirm(true)
        setError(null)
      } else {
        setError(errorMsg)
      }
    }
  }

  const handleCreateAndAdd = async () => {
    await handleAddProject(true)
  }

  const handleCancelCreate = () => {
    setShowCreateConfirm(false)
    setPendingPath('')
  }

  const handleRemoveProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('이 프로젝트를 삭제하시겠습니까?')) {
      await onProjectRemove(id)
    }
  }

  const handleProjectSettings = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/settings/${id}`)
  }

  const handleProjectKanban = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/kanban/${id}`)
  }

  const handleProjectTest = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/test/${id}`)
  }

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('이 대화를 삭제하시겠습니까?')) {
      await onSessionDelete(id)
    }
  }

  return (
    <div className="sidebar">
      {/* 프로젝트 섹션 */}
      <div className="sidebar-section">
        <div className="section-header">
          <h2>프로젝트</h2>
          <button
            className="section-btn"
            onClick={() => setIsAddingProject(!isAddingProject)}
            title={isAddingProject ? '취소' : '프로젝트 추가'}
          >
            {isAddingProject ? '✕' : '+'}
          </button>
        </div>

        {isAddingProject && (
          <div className="add-form">
            <input
              type="text"
              placeholder="프로젝트 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              type="text"
              placeholder="디렉토리 경로"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
            />
            {error && <div className="error-message">{error}</div>}
            {showCreateConfirm && (
              <div className="create-confirm">
                <p className="confirm-message">
                  폴더가 존재하지 않습니다:<br />
                  <code>{pendingPath}</code>
                </p>
                <p className="confirm-question">새로 만드시겠습니까?</p>
                <div className="confirm-buttons">
                  <button className="confirm-yes" onClick={handleCreateAndAdd}>
                    만들기
                  </button>
                  <button className="confirm-no" onClick={handleCancelCreate}>
                    취소
                  </button>
                </div>
              </div>
            )}
            {!showCreateConfirm && (
              <button className="confirm-btn" onClick={() => handleAddProject()}>
                추가
              </button>
            )}
          </div>
        )}

        <div className="item-list project-list">
          <div
            className={`list-item ${selectedProjectId === null ? 'selected' : ''}`}
            onClick={() => onProjectSelect(null)}
          >
            <span className="item-icon">🏠</span>
            <span className="item-name">기본</span>
          </div>

          {projects.map((project) => (
            <div
              key={project.id}
              className={`list-item ${selectedProjectId === project.id ? 'selected' : ''}`}
              onClick={() => onProjectSelect(project.id)}
              title={project.path}
            >
              <span className="item-icon">📁</span>
              <div className="item-info">
                <span className="item-name">{project.name}</span>
                <span className="item-sub">{project.path}</span>
              </div>
              <div className="item-actions">
                <button
                  className="test-btn"
                  onClick={(e) => handleProjectTest(project.id, e)}
                  title="E2E 테스트"
                >
                  🧪
                </button>
                <button
                  className="kanban-btn"
                  onClick={(e) => handleProjectKanban(project.id, e)}
                  title="칸반 보드"
                >
                  📋
                </button>
                <button
                  className="settings-btn"
                  onClick={(e) => handleProjectSettings(project.id, e)}
                  title="설정"
                >
                  ⚙
                </button>
                <button
                  className="delete-btn"
                  onClick={(e) => handleRemoveProject(project.id, e)}
                  title="삭제"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
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
