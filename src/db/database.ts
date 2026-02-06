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

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

  -- 칸반 태스크 테이블
  CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    position INTEGER NOT NULL DEFAULT 0,
    slack_message_ts TEXT,
    slack_channel_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project_id ON kanban_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);

  -- 크론 작업 테이블
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    job_number INTEGER UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    delete_after_run INTEGER NOT NULL DEFAULT 0,
    schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('at', 'every', 'cron')),
    schedule_at_ms INTEGER,
    schedule_every_ms INTEGER,
    schedule_cron_expr TEXT,
    schedule_tz TEXT,
    payload_kind TEXT NOT NULL DEFAULT 'notify' CHECK (payload_kind IN ('notify', 'agent')),
    payload_message TEXT NOT NULL,
    payload_model TEXT,
    slack_channel_id TEXT NOT NULL,
    next_run_at_ms INTEGER,
    last_run_at_ms INTEGER,
    last_status TEXT CHECK (last_status IN ('ok', 'error')),
    last_error TEXT,
    last_duration_ms INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at_ms);

  -- FTS5 전문 검색 테이블 (메시지 검색용)
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid'
  );
`)

// FTS5 트리거 생성 (마이그레이션)
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `)
} catch {
  // 이미 존재하면 무시
}

// 기존 메시지를 FTS5에 인덱싱 (최초 1회)
try {
  const ftsCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages_fts`).get() as { cnt: number }
  const msgCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages`).get() as { cnt: number }
  if (ftsCount.cnt === 0 && msgCount.cnt > 0) {
    db.exec(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages`)
    console.log(`[DB] Indexed ${msgCount.cnt} existing messages to FTS5`)
  }
} catch {
  // 무시
}

// 마이그레이션: payload_kind 컬럼 추가 (기존 DB 호환성)
try {
  db.exec(`ALTER TABLE cron_jobs ADD COLUMN payload_kind TEXT NOT NULL DEFAULT 'notify' CHECK (payload_kind IN ('notify', 'agent'))`)
} catch {
  // 이미 존재하면 무시
}

// 마이그레이션: job_number 컬럼 추가
try {
  db.exec(`ALTER TABLE cron_jobs ADD COLUMN job_number INTEGER UNIQUE`)
  // 기존 데이터에 번호 부여
  const existingJobs = db.prepare(`SELECT id FROM cron_jobs ORDER BY created_at`).all() as { id: string }[]
  existingJobs.forEach((job, idx) => {
    db.prepare(`UPDATE cron_jobs SET job_number = ? WHERE id = ?`).run(idx + 1, job.id)
  })
} catch {
  // 이미 존재하면 무시
}

// job_number 인덱스 (마이그레이션 이후 생성)
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cron_jobs_number ON cron_jobs(job_number)`)
} catch {
  // 무시
}

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

export interface DbKanbanTask {
  id: string
  project_id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  position: number
  slack_message_ts: string | null
  slack_channel_id: string | null
  created_at: number
  updated_at: number
}

export interface DbMessageSearchResult {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  rank: number
}

export interface DbCronJob {
  id: string
  job_number: number
  name: string
  enabled: number  // SQLite에서 boolean은 0/1
  delete_after_run: number
  schedule_kind: 'at' | 'every' | 'cron'
  schedule_at_ms: number | null
  schedule_every_ms: number | null
  schedule_cron_expr: string | null
  schedule_tz: string | null
  payload_kind: 'notify' | 'agent'
  payload_message: string
  payload_model: string | null
  slack_channel_id: string
  next_run_at_ms: number | null
  last_run_at_ms: number | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
  last_duration_ms: number | null
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

const getSetting = db.prepare(`
  SELECT value FROM settings WHERE key = ?
`)

const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)

// 칸반 태스크 prepared statements
const insertTask = db.prepare(`
  INSERT INTO kanban_tasks (id, project_id, title, description, status, priority, position, slack_message_ts, slack_channel_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const getTasksByProject = db.prepare(`
  SELECT * FROM kanban_tasks WHERE project_id = ? ORDER BY status, position, created_at
`)

const getTaskById = db.prepare(`
  SELECT * FROM kanban_tasks WHERE id = ?
`)

const getTasksByStatus = db.prepare(`
  SELECT * FROM kanban_tasks WHERE project_id = ? AND status = ? ORDER BY position, created_at
`)

const updateTaskStmt = db.prepare(`
  UPDATE kanban_tasks SET title = ?, description = ?, status = ?, priority = ?, position = ?, updated_at = ? WHERE id = ?
`)

const deleteTaskStmt = db.prepare(`
  DELETE FROM kanban_tasks WHERE id = ?
`)

const getMaxPosition = db.prepare(`
  SELECT MAX(position) as max_pos FROM kanban_tasks WHERE project_id = ? AND status = ?
`)

// 크론 작업 prepared statements
const insertCronJob = db.prepare(`
  INSERT INTO cron_jobs (
    id, job_number, name, enabled, delete_after_run,
    schedule_kind, schedule_at_ms, schedule_every_ms, schedule_cron_expr, schedule_tz,
    payload_kind, payload_message, payload_model, slack_channel_id,
    next_run_at_ms, last_run_at_ms, last_status, last_error, last_duration_ms,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const getNextJobNumber = db.prepare(`
  SELECT COALESCE(MAX(job_number), 0) + 1 as next_number FROM cron_jobs
`)

const getAllCronJobs = db.prepare(`
  SELECT * FROM cron_jobs ORDER BY job_number ASC
`)

const getEnabledCronJobs = db.prepare(`
  SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY job_number ASC
`)

const getCronJobById = db.prepare(`
  SELECT * FROM cron_jobs WHERE id = ?
`)

const getCronJobByNumber = db.prepare(`
  SELECT * FROM cron_jobs WHERE job_number = ?
`)

const updateCronJobStmt = db.prepare(`
  UPDATE cron_jobs SET
    name = ?, enabled = ?, delete_after_run = ?,
    schedule_kind = ?, schedule_at_ms = ?, schedule_every_ms = ?, schedule_cron_expr = ?, schedule_tz = ?,
    payload_kind = ?, payload_message = ?, payload_model = ?, slack_channel_id = ?,
    next_run_at_ms = ?, last_run_at_ms = ?, last_status = ?, last_error = ?, last_duration_ms = ?,
    updated_at = ?
  WHERE id = ?
`)

const deleteCronJobStmt = db.prepare(`
  DELETE FROM cron_jobs WHERE id = ?
`)

// FTS5 검색 prepared statement
const searchMessagesFts = db.prepare(`
  SELECT
    m.id,
    m.session_id,
    m.role,
    m.content,
    m.timestamp,
    bm25(messages_fts) as rank
  FROM messages_fts
  JOIN messages m ON messages_fts.rowid = m.rowid
  WHERE messages_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`)

const searchMessagesFtsWithSession = db.prepare(`
  SELECT
    m.id,
    m.session_id,
    m.role,
    m.content,
    m.timestamp,
    bm25(messages_fts) as rank
  FROM messages_fts
  JOIN messages m ON messages_fts.rowid = m.rowid
  WHERE messages_fts MATCH ?
    AND m.session_id LIKE ?
  ORDER BY rank
  LIMIT ?
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

  // 설정 저장
  setSetting(key: string, value: string): void {
    upsertSetting.run(key, value, Date.now())
  },

  // 설정 조회
  getSetting(key: string): string | undefined {
    const row = getSetting.get(key) as { value: string } | undefined
    return row?.value
  },

  // === 칸반 태스크 ===

  // 태스크 생성
  createTask(task: {
    id: string
    projectId: string
    title: string
    description?: string
    status?: 'todo' | 'in_progress' | 'done'
    priority?: 'low' | 'medium' | 'high'
    slackMessageTs?: string
    slackChannelId?: string
  }): DbKanbanTask {
    const now = Date.now()
    const status = task.status || 'todo'
    const priority = task.priority || 'medium'

    // 해당 상태에서 최대 position 조회
    const maxPosRow = getMaxPosition.get(task.projectId, status) as { max_pos: number | null }
    const position = (maxPosRow?.max_pos ?? -1) + 1

    insertTask.run(
      task.id,
      task.projectId,
      task.title,
      task.description || '',
      status,
      priority,
      position,
      task.slackMessageTs || null,
      task.slackChannelId || null,
      now,
      now
    )

    return {
      id: task.id,
      project_id: task.projectId,
      title: task.title,
      description: task.description || '',
      status,
      priority,
      position,
      slack_message_ts: task.slackMessageTs || null,
      slack_channel_id: task.slackChannelId || null,
      created_at: now,
      updated_at: now,
    }
  },

  // 프로젝트별 태스크 목록 조회
  getTasks(projectId: string): DbKanbanTask[] {
    return getTasksByProject.all(projectId) as DbKanbanTask[]
  },

  // 단일 태스크 조회
  getTask(id: string): DbKanbanTask | undefined {
    return getTaskById.get(id) as DbKanbanTask | undefined
  },

  // 상태별 태스크 조회
  getTasksByStatus(projectId: string, status: 'todo' | 'in_progress' | 'done'): DbKanbanTask[] {
    return getTasksByStatus.all(projectId, status) as DbKanbanTask[]
  },

  // 태스크 수정
  updateTask(
    id: string,
    updates: Partial<{
      title: string
      description: string
      status: 'todo' | 'in_progress' | 'done'
      priority: 'low' | 'medium' | 'high'
      position: number
    }>
  ): DbKanbanTask | undefined {
    const existing = this.getTask(id)
    if (!existing) return undefined

    const now = Date.now()
    const newTitle = updates.title ?? existing.title
    const newDescription = updates.description ?? existing.description
    const newStatus = updates.status ?? existing.status
    const newPriority = updates.priority ?? existing.priority
    const newPosition = updates.position ?? existing.position

    updateTaskStmt.run(newTitle, newDescription, newStatus, newPriority, newPosition, now, id)

    return {
      ...existing,
      title: newTitle,
      description: newDescription,
      status: newStatus,
      priority: newPriority,
      position: newPosition,
      updated_at: now,
    }
  },

  // 태스크 삭제
  deleteTask(id: string): boolean {
    const result = deleteTaskStmt.run(id)
    return result.changes > 0
  },

  // === 크론 작업 ===

  // 크론 작업 생성
  createCronJob(job: {
    id: string
    name: string
    enabled?: boolean
    deleteAfterRun?: boolean
    scheduleKind: 'at' | 'every' | 'cron'
    scheduleAtMs?: number
    scheduleEveryMs?: number
    scheduleCronExpr?: string
    scheduleTz?: string
    payloadKind: 'notify' | 'agent'
    payloadMessage: string
    payloadModel?: string
    slackChannelId: string
    nextRunAtMs?: number
  }): DbCronJob {
    const now = Date.now()
    // 다음 job_number 가져오기
    const { next_number: jobNumber } = getNextJobNumber.get() as { next_number: number }

    insertCronJob.run(
      job.id,
      jobNumber,
      job.name,
      job.enabled !== false ? 1 : 0,
      job.deleteAfterRun ? 1 : 0,
      job.scheduleKind,
      job.scheduleAtMs ?? null,
      job.scheduleEveryMs ?? null,
      job.scheduleCronExpr ?? null,
      job.scheduleTz ?? null,
      job.payloadKind,
      job.payloadMessage,
      job.payloadModel ?? null,
      job.slackChannelId,
      job.nextRunAtMs ?? null,
      null, // last_run_at_ms
      null, // last_status
      null, // last_error
      null, // last_duration_ms
      now,
      now
    )

    return {
      id: job.id,
      job_number: jobNumber,
      name: job.name,
      enabled: job.enabled !== false ? 1 : 0,
      delete_after_run: job.deleteAfterRun ? 1 : 0,
      schedule_kind: job.scheduleKind,
      schedule_at_ms: job.scheduleAtMs ?? null,
      schedule_every_ms: job.scheduleEveryMs ?? null,
      schedule_cron_expr: job.scheduleCronExpr ?? null,
      schedule_tz: job.scheduleTz ?? null,
      payload_kind: job.payloadKind,
      payload_message: job.payloadMessage,
      payload_model: job.payloadModel ?? null,
      slack_channel_id: job.slackChannelId,
      next_run_at_ms: job.nextRunAtMs ?? null,
      last_run_at_ms: null,
      last_status: null,
      last_error: null,
      last_duration_ms: null,
      created_at: now,
      updated_at: now,
    }
  },

  // 크론 작업 목록 조회
  getCronJobs(includeDisabled = false): DbCronJob[] {
    if (includeDisabled) {
      return getAllCronJobs.all() as DbCronJob[]
    }
    return getEnabledCronJobs.all() as DbCronJob[]
  },

  // 단일 크론 작업 조회 (ID)
  getCronJob(id: string): DbCronJob | undefined {
    return getCronJobById.get(id) as DbCronJob | undefined
  },

  // 단일 크론 작업 조회 (번호)
  getCronJobByNumber(jobNumber: number): DbCronJob | undefined {
    return getCronJobByNumber.get(jobNumber) as DbCronJob | undefined
  },

  // 크론 작업 수정
  updateCronJob(
    id: string,
    updates: Partial<{
      name: string
      enabled: boolean
      deleteAfterRun: boolean
      scheduleKind: 'at' | 'every' | 'cron'
      scheduleAtMs: number | null
      scheduleEveryMs: number | null
      scheduleCronExpr: string | null
      scheduleTz: string | null
      payloadKind: 'notify' | 'agent'
      payloadMessage: string
      payloadModel: string | null
      slackChannelId: string
      nextRunAtMs: number | null
      lastRunAtMs: number | null
      lastStatus: 'ok' | 'error' | null
      lastError: string | null
      lastDurationMs: number | null
    }>
  ): DbCronJob | undefined {
    const existing = this.getCronJob(id)
    if (!existing) return undefined

    const now = Date.now()
    updateCronJobStmt.run(
      updates.name ?? existing.name,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled,
      updates.deleteAfterRun !== undefined ? (updates.deleteAfterRun ? 1 : 0) : existing.delete_after_run,
      updates.scheduleKind ?? existing.schedule_kind,
      updates.scheduleAtMs !== undefined ? updates.scheduleAtMs : existing.schedule_at_ms,
      updates.scheduleEveryMs !== undefined ? updates.scheduleEveryMs : existing.schedule_every_ms,
      updates.scheduleCronExpr !== undefined ? updates.scheduleCronExpr : existing.schedule_cron_expr,
      updates.scheduleTz !== undefined ? updates.scheduleTz : existing.schedule_tz,
      updates.payloadKind ?? existing.payload_kind,
      updates.payloadMessage ?? existing.payload_message,
      updates.payloadModel !== undefined ? updates.payloadModel : existing.payload_model,
      updates.slackChannelId ?? existing.slack_channel_id,
      updates.nextRunAtMs !== undefined ? updates.nextRunAtMs : existing.next_run_at_ms,
      updates.lastRunAtMs !== undefined ? updates.lastRunAtMs : existing.last_run_at_ms,
      updates.lastStatus !== undefined ? updates.lastStatus : existing.last_status,
      updates.lastError !== undefined ? updates.lastError : existing.last_error,
      updates.lastDurationMs !== undefined ? updates.lastDurationMs : existing.last_duration_ms,
      now,
      id
    )

    return this.getCronJob(id)
  },

  // 크론 작업 삭제
  deleteCronJob(id: string): boolean {
    const result = deleteCronJobStmt.run(id)
    return result.changes > 0
  },

  // === 메시지 검색 (FTS5) ===

  // 메시지 전문 검색
  searchMessages(params: {
    query: string
    sessionId?: string
    limit?: number
  }): DbMessageSearchResult[] {
    const { query, sessionId, limit = 10 } = params

    // FTS5 쿼리 이스케이프 (특수문자 처리)
    const escapedQuery = query.replace(/"/g, '""')
    const ftsQuery = `"${escapedQuery}"`

    try {
      if (sessionId) {
        return searchMessagesFtsWithSession.all(ftsQuery, `%${sessionId}%`, limit) as DbMessageSearchResult[]
      }
      return searchMessagesFts.all(ftsQuery, limit) as DbMessageSearchResult[]
    } catch {
      // FTS5 검색 실패 시 빈 배열 반환
      return []
    }
  },
}

export default chatDb
