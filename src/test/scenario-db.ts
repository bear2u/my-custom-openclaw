/**
 * 테스트 시나리오 DB
 *
 * Maestro 스타일 YAML 기반 테스트 시나리오 저장
 */

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync } from 'node:fs'
import type {
  TestScenario,
  TestRun,
  CommandResult,
  CreateScenarioRequest,
  UpdateScenarioRequest,
} from './types.js'

const DATA_DIR = join(homedir(), '.claude-gateway')
const DB_PATH = join(DATA_DIR, 'chat.db')

// 데이터 디렉토리 생성
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

// WAL 모드 활성화
db.pragma('journal_mode = WAL')

// 테스트 관련 스키마 초기화 (v2: yaml 기반)
db.exec(`
  -- 기존 테이블이 있으면 스키마 마이그레이션 필요
  -- 새로운 테이블 구조
  CREATE TABLE IF NOT EXISTS test_scenarios_v2 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    yaml TEXT NOT NULL,             -- YAML 형식 테스트 정의
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_runs_v2 (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error', 'stopped')),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    commands TEXT NOT NULL,         -- JSON array of CommandResult
    error TEXT,
    duration INTEGER,
    summary TEXT,                   -- JSON: { total, passed, failed, skipped, warned }
    FOREIGN KEY (scenario_id) REFERENCES test_scenarios_v2(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_test_scenarios_v2_project_id ON test_scenarios_v2(project_id);
  CREATE INDEX IF NOT EXISTS idx_test_runs_v2_scenario_id ON test_runs_v2(scenario_id);
  CREATE INDEX IF NOT EXISTS idx_test_runs_v2_started_at ON test_runs_v2(started_at DESC);
`)

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
}

// Prepared statements for scenarios
const insertScenario = db.prepare(`
  INSERT INTO test_scenarios_v2 (id, project_id, name, description, yaml, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const updateScenarioStmt = db.prepare(`
  UPDATE test_scenarios_v2
  SET name = ?, description = ?, yaml = ?, updated_at = ?
  WHERE id = ?
`)

const deleteScenarioStmt = db.prepare(`
  DELETE FROM test_scenarios_v2 WHERE id = ?
`)

const getScenarioById = db.prepare(`
  SELECT * FROM test_scenarios_v2 WHERE id = ?
`)

const getScenariosByProject = db.prepare(`
  SELECT * FROM test_scenarios_v2 WHERE project_id = ? ORDER BY updated_at DESC
`)

// Prepared statements for runs
const insertRun = db.prepare(`
  INSERT INTO test_runs_v2 (id, scenario_id, status, started_at, commands)
  VALUES (?, ?, ?, ?, ?)
`)

const updateRunStmt = db.prepare(`
  UPDATE test_runs_v2
  SET status = ?, finished_at = ?, commands = ?, error = ?, duration = ?, summary = ?
  WHERE id = ?
`)

const getRunById = db.prepare(`
  SELECT * FROM test_runs_v2 WHERE id = ?
`)

const getRunsByScenario = db.prepare(`
  SELECT * FROM test_runs_v2 WHERE scenario_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?
`)

interface DbScenario {
  id: string
  project_id: string
  name: string
  description: string
  yaml: string
  created_at: number
  updated_at: number
}

interface DbRun {
  id: string
  scenario_id: string
  status: string
  started_at: number
  finished_at: number | null
  commands: string        // JSON
  error: string | null
  duration: number | null
  summary: string | null  // JSON
}

function dbToScenario(row: DbScenario): TestScenario {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    yaml: row.yaml,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function dbToRun(row: DbRun): TestRun {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    status: row.status as TestRun['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    commands: JSON.parse(row.commands) as CommandResult[],
    error: row.error ?? undefined,
    duration: row.duration ?? undefined,
    summary: row.summary ? JSON.parse(row.summary) : undefined,
  }
}

export const scenarioDb = {
  // 시나리오 생성
  createScenario(req: CreateScenarioRequest): TestScenario {
    const id = generateId()
    const now = Date.now()
    insertScenario.run(
      id,
      req.projectId,
      req.name,
      req.description ?? '',
      req.yaml,
      now,
      now
    )
    return {
      id,
      projectId: req.projectId,
      name: req.name,
      description: req.description ?? '',
      yaml: req.yaml,
      createdAt: now,
      updatedAt: now,
    }
  },

  // 시나리오 조회
  getScenario(id: string): TestScenario | undefined {
    const row = getScenarioById.get(id) as DbScenario | undefined
    return row ? dbToScenario(row) : undefined
  },

  // 프로젝트별 시나리오 목록
  getScenariosByProject(projectId: string): TestScenario[] {
    const rows = getScenariosByProject.all(projectId) as DbScenario[]
    return rows.map(dbToScenario)
  },

  // 시나리오 업데이트
  updateScenario(id: string, updates: UpdateScenarioRequest): TestScenario | undefined {
    const existing = this.getScenario(id)
    if (!existing) return undefined

    const name = updates.name ?? existing.name
    const description = updates.description ?? existing.description
    const yaml = updates.yaml ?? existing.yaml
    const now = Date.now()

    updateScenarioStmt.run(
      name,
      description,
      yaml,
      now,
      id
    )

    return {
      ...existing,
      name,
      description,
      yaml,
      updatedAt: now,
    }
  },

  // 시나리오 삭제
  deleteScenario(id: string): boolean {
    const result = deleteScenarioStmt.run(id)
    return result.changes > 0
  },

  // 테스트 실행 생성
  createRun(scenarioId: string): TestRun {
    const id = generateId()
    const now = Date.now()
    insertRun.run(id, scenarioId, 'pending', now, '[]')
    return {
      id,
      scenarioId,
      status: 'pending',
      startedAt: now,
      commands: [],
    }
  },

  // 테스트 실행 조회
  getRun(id: string): TestRun | undefined {
    const row = getRunById.get(id) as DbRun | undefined
    return row ? dbToRun(row) : undefined
  },

  // 시나리오별 실행 이력
  getRunsByScenario(scenarioId: string, limit = 20, offset = 0): TestRun[] {
    const rows = getRunsByScenario.all(scenarioId, limit, offset) as DbRun[]
    return rows.map(dbToRun)
  },

  // 테스트 실행 업데이트
  updateRun(
    id: string,
    updates: {
      status?: TestRun['status']
      finishedAt?: number
      commands?: CommandResult[]
      error?: string
      duration?: number
      summary?: TestRun['summary']
    }
  ): TestRun | undefined {
    const existing = this.getRun(id)
    if (!existing) return undefined

    const status = updates.status ?? existing.status
    const finishedAt = updates.finishedAt ?? existing.finishedAt ?? null
    const commands = updates.commands ?? existing.commands
    const error = updates.error ?? existing.error ?? null
    const duration = updates.duration ?? existing.duration ?? null
    const summary = updates.summary ?? existing.summary ?? null

    updateRunStmt.run(
      status,
      finishedAt,
      JSON.stringify(commands),
      error,
      duration,
      summary ? JSON.stringify(summary) : null,
      id
    )

    return {
      ...existing,
      status,
      finishedAt: finishedAt ?? undefined,
      commands,
      error: error ?? undefined,
      duration: duration ?? undefined,
      summary: summary ?? undefined,
    }
  },
}

export default scenarioDb
