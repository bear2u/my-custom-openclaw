import Database from 'better-sqlite3'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync } from 'node:fs'

const DATA_DIR = join(homedir(), '.claude-gateway')
const DB_PATH = join(DATA_DIR, 'chat.db')

// 데이터 디렉토리 생성
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

// WAL 모드 활성화 (성능 향상)
db.pragma('journal_mode = WAL')

// 스키마 초기화
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project_id ON kanban_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);
`)

export interface DbMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface DbSession {
  id: string
  project_id: string | null
  created_at: number
  updated_at: number
}

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

// Prepared statements
const insertSession = db.prepare(`
  INSERT INTO sessions (id, project_id, created_at, updated_at)
  VALUES (?, ?, ?, ?)
`)

const updateSessionTimestamp = db.prepare(`
  UPDATE sessions SET updated_at = ? WHERE id = ?
`)

const insertMessage = db.prepare(`
  INSERT INTO messages (id, session_id, role, content, timestamp)
  VALUES (?, ?, ?, ?, ?)
`)

const getSessionById = db.prepare(`
  SELECT * FROM sessions WHERE id = ?
`)

const getSessionsByProject = db.prepare(`
  SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC
`)

const getAllSessions = db.prepare(`
  SELECT * FROM sessions ORDER BY updated_at DESC
`)

const getMessagesBySession = db.prepare(`
  SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
`)

const deleteSession = db.prepare(`
  DELETE FROM sessions WHERE id = ?
`)

// Kanban task statements
const insertKanbanTask = db.prepare(`
  INSERT INTO kanban_tasks (id, project_id, title, description, status, priority, position, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateKanbanTask = db.prepare(`
  UPDATE kanban_tasks
  SET title = ?, description = ?, status = ?, priority = ?, position = ?, updated_at = ?
  WHERE id = ?
`)

const deleteKanbanTask = db.prepare(`
  DELETE FROM kanban_tasks WHERE id = ?
`)

const getKanbanTasksByProject = db.prepare(`
  SELECT * FROM kanban_tasks WHERE project_id = ? ORDER BY status, position ASC
`)

const getKanbanTaskById = db.prepare(`
  SELECT * FROM kanban_tasks WHERE id = ?
`)

const getMaxPosition = db.prepare(`
  SELECT MAX(position) as max_pos FROM kanban_tasks WHERE project_id = ? AND status = ?
`)

export const chatDb = {
  // 세션 생성
  createSession(id: string, projectId: string | null = null): DbSession {
    const now = Date.now()
    insertSession.run(id, projectId, now, now)
    return { id, project_id: projectId, created_at: now, updated_at: now }
  },

  // 세션 존재 확인 및 생성
  ensureSession(id: string, projectId: string | null = null): DbSession {
    const existing = getSessionById.get(id) as DbSession | undefined
    if (existing) {
      return existing
    }
    return this.createSession(id, projectId)
  },

  // 세션 조회
  getSession(id: string): DbSession | undefined {
    return getSessionById.get(id) as DbSession | undefined
  },

  // 프로젝트별 세션 목록
  getSessionsByProject(projectId: string | null): DbSession[] {
    if (projectId === null) {
      // 프로젝트 없는 세션들 + 전체
      return getAllSessions.all() as DbSession[]
    }
    return getSessionsByProject.all(projectId) as DbSession[]
  },

  // 전체 세션 목록
  getAllSessions(): DbSession[] {
    return getAllSessions.all() as DbSession[]
  },

  // 메시지 저장
  saveMessage(
    id: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    timestamp: number
  ): DbMessage {
    insertMessage.run(id, sessionId, role, content, timestamp)
    updateSessionTimestamp.run(timestamp, sessionId)
    return { id, session_id: sessionId, role, content, timestamp }
  },

  // 세션의 메시지 조회
  getMessages(sessionId: string): DbMessage[] {
    return getMessagesBySession.all(sessionId) as DbMessage[]
  },

  // 세션 삭제 (메시지도 함께 삭제됨 - CASCADE)
  deleteSession(id: string): boolean {
    const result = deleteSession.run(id)
    return result.changes > 0
  },

  // DB 종료
  close() {
    db.close()
  },
}

// Kanban Board Database
export const kanbanDb = {
  // 태스크 생성
  createTask(
    projectId: string,
    title: string,
    description: string = '',
    status: 'todo' | 'in_progress' | 'done' = 'todo',
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): KanbanTask {
    const id = Math.random().toString(36).substring(2, 15)
    const now = Date.now()
    const maxPosResult = getMaxPosition.get(projectId, status) as { max_pos: number | null }
    const position = (maxPosResult?.max_pos ?? -1) + 1
    insertKanbanTask.run(id, projectId, title, description, status, priority, position, now, now)
    return { id, project_id: projectId, title, description, status, priority, position, created_at: now, updated_at: now }
  },

  // 태스크 조회
  getTask(id: string): KanbanTask | undefined {
    return getKanbanTaskById.get(id) as KanbanTask | undefined
  },

  // 프로젝트별 태스크 목록
  getTasksByProject(projectId: string): KanbanTask[] {
    return getKanbanTasksByProject.all(projectId) as KanbanTask[]
  },

  // 태스크 업데이트
  updateTask(
    id: string,
    updates: Partial<Pick<KanbanTask, 'title' | 'description' | 'status' | 'priority' | 'position'>>
  ): KanbanTask | undefined {
    const existing = this.getTask(id)
    if (!existing) return undefined

    const title = updates.title ?? existing.title
    const description = updates.description ?? existing.description
    const status = updates.status ?? existing.status
    const priority = updates.priority ?? existing.priority
    const position = updates.position ?? existing.position
    const now = Date.now()

    updateKanbanTask.run(title, description, status, priority, position, now, id)
    return { ...existing, title, description, status, priority, position, updated_at: now }
  },

  // 태스크 삭제
  deleteTask(id: string): boolean {
    const result = deleteKanbanTask.run(id)
    return result.changes > 0
  },
}

export default chatDb
