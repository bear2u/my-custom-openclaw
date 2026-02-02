import { useState, useEffect } from 'react'
import type { Project } from '../types'
import './ProjectPanel.css'

interface ProjectPanelProps {
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (name: string, path: string) => Promise<Project>
  onRemove: (id: string) => Promise<boolean>
  onLoad: () => Promise<void>
}

export function ProjectPanel({
  projects,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onLoad,
}: ProjectPanelProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onLoad()
  }, [onLoad])

  const handleAdd = async () => {
    if (!newName.trim() || !newPath.trim()) {
      setError('이름과 경로를 모두 입력해주세요')
      return
    }

    try {
      setError(null)
      await onAdd(newName.trim(), newPath.trim())
      setNewName('')
      setNewPath('')
      setIsAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로젝트 추가 실패')
    }
  }

  const handleRemove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('이 프로젝트를 삭제하시겠습니까?')) {
      await onRemove(id)
    }
  }

  return (
    <div className="project-panel">
      <div className="panel-header">
        <h2>프로젝트</h2>
        <button
          className="add-button"
          onClick={() => setIsAdding(!isAdding)}
          title={isAdding ? '취소' : '프로젝트 추가'}
        >
          {isAdding ? '✕' : '+'}
        </button>
      </div>

      {isAdding && (
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
          <button className="confirm-button" onClick={handleAdd}>
            추가
          </button>
        </div>
      )}

      <div className="project-list">
        <div
          className={`project-item ${selectedId === null ? 'selected' : ''}`}
          onClick={() => onSelect(null)}
        >
          <span className="project-icon">🏠</span>
          <span className="project-name">기본 (현재 디렉토리)</span>
        </div>

        {projects.map((project) => (
          <div
            key={project.id}
            className={`project-item ${selectedId === project.id ? 'selected' : ''}`}
            onClick={() => onSelect(project.id)}
            title={project.path}
          >
            <span className="project-icon">📁</span>
            <div className="project-info">
              <span className="project-name">{project.name}</span>
              <span className="project-path">{project.path}</span>
            </div>
            <button
              className="remove-button"
              onClick={(e) => handleRemove(project.id, e)}
              title="삭제"
            >
              🗑
            </button>
          </div>
        ))}

        {projects.length === 0 && !isAdding && (
          <div className="empty-message">
            프로젝트가 없습니다.
            <br />+ 버튼을 눌러 추가하세요.
          </div>
        )}
      </div>
    </div>
  )
}
