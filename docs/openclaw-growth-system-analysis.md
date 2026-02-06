# OpenClaw의 메모리 관리 시스템 분석

OpenClaw는 AI 에이전트의 메모리를 관리하는 시스템을 제공합니다. 이 글에서는 OpenClaw의 메모리 시스템을 소스 코드 기반으로 분석하고, Claude Code 기본 기능과의 차이를 명확히 구분합니다.

---

## Claude Code 기본 기능 vs OpenClaw 추가 기능

먼저 혼동하기 쉬운 부분을 정리합니다:

| 기능 | Claude Code 기본 | OpenClaw 추가 |
|------|-----------------|---------------|
| 컨텍스트 압축 (Compaction) | O | - |
| MEMORY.md 읽기 | O | - |
| **메모리 자동 저장 (플러시)** | X | **O** |
| **벡터 검색 (memory_search)** | X | **O** |
| **SOUL Evil (성격 전환)** | X | **O** |

**핵심**: OpenClaw의 고유 기능은 "메모리 자동 저장"과 "벡터 검색"입니다.

---

## 1. 메모리 플러시 시스템

OpenClaw의 핵심 기능은 **자동 메모리 플러시(Auto Memory Flush)** 입니다.

### 1.1 Claude Code와의 차이

```
Claude Code:  사용자가 수동으로 MEMORY.md 편집
OpenClaw:     에이전트가 자동으로 memory/YYYY-MM-DD.md에 저장
```

### 1.2 트리거 조건

**파일**: `/openclaw/src/auto-reply/reply/memory-flush.ts`

```typescript
// 계산식
THRESHOLD = MAX(0, CONTEXT_WINDOW - RESERVE_TOKENS - SOFT_THRESHOLD)

// 예시:
// Context Window: 200,000 토큰
// Reserve Floor: 20,000 토큰
// Soft Threshold: 4,000 토큰
// THRESHOLD = 200,000 - 20,000 - 4,000 = 176,000 토큰
```

**조건 2가지**:
1. `totalTokens >= THRESHOLD` (토큰 임계값 도달)
2. `memoryFlushCompactionCount != compactionCount` (새 압축 발생 후)

### 1.3 플러시 프롬프트

```typescript
DEFAULT_MEMORY_FLUSH_PROMPT =
  "Pre-compaction memory flush. " +
  "Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed). " +
  "If nothing to store, reply with NO_REPLY."
```

### 1.4 실행 흐름

```
┌──────────────────────────────────────────┐
│ 1. 토큰 임계값 체크                       │
│    totalTokens >= 176,000?               │
└──────────────────────────────────────────┘
              ↓ (Yes)
┌──────────────────────────────────────────┐
│ 2. Silent Turn 실행                      │
│    에이전트에게 플러시 프롬프트 전달      │
└──────────────────────────────────────────┘
              ↓
┌──────────────────────────────────────────┐
│ 3. 에이전트가 Write 도구로 저장          │
│    write("memory/2025-02-06.md", "...")  │
└──────────────────────────────────────────┘
              ↓
┌──────────────────────────────────────────┐
│ 4. 세션 메타데이터 업데이트              │
│    memoryFlushCompactionCount++          │
└──────────────────────────────────────────┘
```

---

## 2. 메모리 파일 구조

### 2.1 파일 레이아웃

```
workspace/
├── MEMORY.md                    # 장기 메모리 (사용자 편집)
└── memory/
    ├── 2025-02-06.md           # 에이전트가 자동 저장
    ├── 2025-02-05.md
    └── ...
```

### 2.2 경로 인식

```typescript
function isMemoryPath(relPath: string): boolean {
  return normalized === "MEMORY.md" || normalized.startsWith("memory/");
}
```

---

## 3. 벡터 검색 시스템

### 3.1 memory_search 도구

**파일**: `/openclaw/src/agents/tools/memory-tool.ts`

```typescript
// 입력
{ query: "테스트 방법", maxResults: 6, minScore: 0.35 }

// 출력
{
  results: [{
    snippet: "Jest보다 Vitest 선호",
    score: 0.87,
    path: "memory/2025-02-06.md",
    startLine: 10,
    endLine: 15
  }]
}
```

### 3.2 하이브리드 검색

```
BM25 (키워드): 30%  +  벡터 (의미론적): 70%
```

### 3.3 청킹 설정

```typescript
chunking: {
  tokens: 400,     // 청크 크기
  overlap: 80      // 중복
}
```

---

## 4. SOUL 시스템 (성격 전환)

**주의**: 이것은 "성장"이 아니라 **조건부 전환**입니다.

### 4.1 SOUL Evil Hook

**파일**: `/openclaw/src/hooks/soul-evil.ts`

```typescript
type SoulEvilConfig = {
  file?: string;        // SOUL_EVIL.md
  chance?: number;      // 0.1 = 10% 확률
  purge?: {
    at?: string;        // "21:00"
    duration?: string;  // "15m"
  };
};
```

### 4.2 동작 방식

```
매일 21:00 ~ 21:15 동안:
  SOUL.md → SOUL_EVIL.md로 교체

또는

10% 확률로:
  SOUL.md → SOUL_EVIL.md로 교체
```

### 4.3 하지 않는 것

- 대화를 통한 성격 진화
- 피드백 기반 행동 변화
- 자동 선호도/습관 학습
- 시간에 따른 성격 특성 변화

---

## 5. SQLite 스키마

```sql
-- 파일 메타데이터
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL
);

-- 청크 (텍스트 + 임베딩)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL
);

-- FTS (Full-Text Search)
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, id UNINDEXED);

-- 임베딩 캐시
CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,
  embedding TEXT NOT NULL
);
```

---

## 6. 세션 메타데이터

```typescript
type SessionEntry = {
  sessionId: string;
  totalTokens?: number;
  compactionCount?: number;
  memoryFlushAt?: number;
  memoryFlushCompactionCount?: number;
};
```

```json
{
  "slack:user123": {
    "sessionId": "uuid-1234",
    "totalTokens": 50000,
    "compactionCount": 2,
    "memoryFlushAt": 1707225600000,
    "memoryFlushCompactionCount": 2
  }
}
```

---

## 7. 임베딩 프로바이더

```
provider: "auto" 선택 순서:
1. 로컬 모델 파일 → local (node-llama-cpp)
2. OpenAI API 키 → openai (text-embedding-3-small)
3. Gemini API 키 → gemini
4. 없으면 → 에러
```

---

## 8. 핵심 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `softThresholdTokens` | 4,000 | 플러시 버퍼 |
| `reserveTokensFloor` | 20,000 | 압축 예약 |
| `chunking.tokens` | 400 | 청크 크기 |
| `vectorWeight` | 0.7 | 벡터 검색 가중치 |
| `textWeight` | 0.3 | BM25 가중치 |

---

## 결론

### OpenClaw가 제공하는 것

1. **메모리 자동 저장** - 압축 직전에 에이전트가 `memory/YYYY-MM-DD.md`에 저장
2. **벡터 검색** - BM25 + 임베딩으로 관련 메모리 검색
3. **SOUL 전환** - 시간/확률 기반 성격 파일 교체

### OpenClaw가 제공하지 않는 것

- AI 에이전트의 "성장" 또는 "진화"
- 피드백 기반 학습
- 성격 특성의 자동 변화
- 행동 패턴의 점진적 개선

**요약**: OpenClaw는 "성장 시스템"이라기보다 **"메모리 관리 시스템"**입니다. 에이전트가 정보를 자동으로 저장하고 검색할 수 있게 해주지만, 저장된 정보를 바탕으로 스스로 "성장"하지는 않습니다.

---

**관련 문서**:
- [OpenClaw Claude Runner 분석](./openclaw-claude-runner-analysis.md)
- [OpenClaw Soul 시스템 분석](./openclaw-soul-system-analysis.md)
- [OpenClaw Cron 시스템](./openclaw-cron-system.md)

**참고 소스 파일**:
- `/openclaw/src/auto-reply/reply/memory-flush.ts`
- `/openclaw/src/memory/hybrid.ts`
- `/openclaw/src/hooks/soul-evil.ts`
- `/openclaw/src/agents/tools/memory-tool.ts`
