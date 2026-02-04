import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { KanbanTask, Project } from '../types'
import './KanbanPage.css'

interface KanbanPageProps {
  project: Project | null
  sendRpc: <T>(method: string, params?: unknown) => Promise<T>
  onAttachTask: (task: KanbanTask) => void
}

type ColumnType = 'todo' | 'in_progress' | 'done'

const COLUMN_TITLES: Record<ColumnType, string> = {
  todo: '할 일',
  in_progress: '진행 중',
  done: '완료',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4ade80',
  medium: '#fbbf24',
  high: '#f87171',
}

export function KanbanPage({ project, sendRpc, onAttachTask }: KanbanPageProps) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 새 태스크 생성 상태
  const [isCreating, setIsCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium')

  // 편집 상태
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null)

  // 태스크 로드
  const loadTasks = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const list = await sendRpc<KanbanTask[]>('kanban.tasks.list', { projectId })
      setTasks(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [projectId, sendRpc])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // 태스크 생성
  const createTask = async () => {
    if (!projectId || !newTitle.trim()) return
    setLoading(true)
    try {
      await sendRpc('kanban.tasks.create', {
        projectId,
        title: newTitle.trim(),
        description: newDescription.trim(),
        priority: newPriority,
        status: 'todo',
      })
      setNewTitle('')
      setNewDescription('')
      setNewPriority('medium')
      setIsCreating(false)
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setLoading(false)
    }
  }

  // 태스크 상태 변경
  const updateTaskStatus = async (taskId: string, status: ColumnType) => {
    try {
      await sendRpc('kanban.tasks.update', { id: taskId, status })
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task')
    }
  }

  // 태스크 업데이트
  const updateTask = async () => {
    if (!editingTask) return
    setLoading(true)
    try {
      await sendRpc('kanban.tasks.update', {
        id: editingTask.id,
        title: editingTask.title,
        description: editingTask.description,
        priority: editingTask.priority,
      })
      setEditingTask(null)
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task')
    } finally {
      setLoading(false)
    }
  }

  // 태스크 삭제
  const deleteTask = async (taskId: string) => {
    if (!confirm('이 태스크를 삭제하시겠습니까?')) return
    try {
      await sendRpc('kanban.tasks.delete', { id: taskId })
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task')
    }
  }

  // 채팅에 첨부
  const attachToChat = (task: KanbanTask) => {
    onAttachTask(task)
    navigate('/')
  }

  // 컬럼별 태스크 필터
  const getTasksByColumn = (status: ColumnType) => {
    return tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position)
  }

  if (!project) {
    return (
      <div className="kanban-page">
        <div className="kanban-header">
          <button className="back-btn" onClick={() => navigate('/')}>
            ← 돌아가기
          </button>
          <h1>프로젝트를 찾을 수 없습니다</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← 돌아가기
        </button>
        <div className="header-info">
          <h1>{project.name} - 칸반 보드</h1>
          <span className="project-path">{project.path}</span>
        </div>
        <button className="create-btn" onClick={() => setIsCreating(true)}>
          + 새 태스크
        </button>
      </div>

      {error && <div className="kanban-error">{error}</div>}

      {/* 새 태스크 생성 모달 */}
      {isCreating && (
        <div className="modal-overlay" onClick={() => setIsCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>새 태스크</h2>
            <input
              type="text"
              placeholder="제목"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder="설명 (선택)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
            </select>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setIsCreating(false)}>
                취소
              </button>
              <button className="save-btn" onClick={createTask} disabled={loading || !newTitle.trim()}>
                {loading ? '생성 중...' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 태스크 편집 모달 */}
      {editingTask && (
        <div className="modal-overlay" onClick={() => setEditingTask(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>태스크 편집</h2>
            <input
              type="text"
              placeholder="제목"
              value={editingTask.title}
              onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
            />
            <textarea
              placeholder="설명"
              value={editingTask.description}
              onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
            />
            <select
              value={editingTask.priority}
              onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as 'low' | 'medium' | 'high' })}
            >
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
            </select>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setEditingTask(null)}>
                취소
              </button>
              <button className="save-btn" onClick={updateTask} disabled={loading}>
                {loading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 칸반 보드 */}
      <div className="kanban-board">
        {(['todo', 'in_progress', 'done'] as ColumnType[]).map((status) => (
          <div key={status} className="kanban-column">
            <div className="column-header">
              <h3>{COLUMN_TITLES[status]}</h3>
              <span className="task-count">{getTasksByColumn(status).length}</span>
            </div>
            <div
              className="column-content"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const taskId = e.dataTransfer.getData('taskId')
                if (taskId) updateTaskStatus(taskId, status)
              }}
            >
              {getTasksByColumn(status).map((task) => (
                <div
                  key={task.id}
                  className="kanban-card"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
                >
                  <div className="card-header">
                    <span
                      className="priority-badge"
                      style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
                    >
                      {task.priority === 'low' ? '낮음' : task.priority === 'medium' ? '보통' : '높음'}
                    </span>
                    <div className="card-actions">
                      <button
                        className="attach-btn"
                        onClick={() => attachToChat(task)}
                        title="채팅에 첨부"
                      >
                        📎
                      </button>
                      <button
                        className="edit-btn"
                        onClick={() => setEditingTask(task)}
                        title="편집"
                      >
                        ✏️
                      </button>
                      <button
                        className="delete-btn"
                        onClick={() => deleteTask(task.id)}
                        title="삭제"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <h4 className="card-title">{task.title}</h4>
                  {task.description && (
                    <p className="card-description">{task.description}</p>
                  )}
                  <div className="card-footer">
                    <span className="task-id">#{task.id.slice(0, 6)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
