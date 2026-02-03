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

// 스키마 초기화 (단순화: 프로젝트 관련 컬럼 제거)
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
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

  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
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
  created_at: number
  updated_at: number
}

// Prepared statements
const insertSession = db.prepare(`
  INSERT INTO sessions (id, created_at, updated_at)
  VALUES (?, ?, ?)
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

const getAllSessions = db.prepare(`
  SELECT * FROM sessions ORDER BY updated_at DESC
`)

const getMessagesBySession = db.prepare(`
  SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
`)

const deleteSession = db.prepare(`
  DELETE FROM sessions WHERE id = ?
`)

export const chatDb = {
  // 세션 생성
  createSession(id: string): DbSession {
    const now = Date.now()
    insertSession.run(id, now, now)
    return { id, created_at: now, updated_at: now }
  },

  // 세션 존재 확인 및 생성
  ensureSession(id: string): DbSession {
    const existing = getSessionById.get(id) as DbSession | undefined
    if (existing) {
      return existing
    }
    return this.createSession(id)
  },

  // 세션 조회
  getSession(id: string): DbSession | undefined {
    return getSessionById.get(id) as DbSession | undefined
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

export default chatDb
