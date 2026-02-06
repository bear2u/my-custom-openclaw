# SQLite FTS5 전문 검색 가이드

SQLite에 내장된 FTS5(Full-Text Search 5)를 사용하여 대화 내용을 빠르게 검색하는 방법을 설명합니다.

---

## FTS5란?

FTS5는 SQLite에 내장된 **전문 검색 엔진**입니다. 일반적인 `LIKE '%키워드%'` 검색보다 훨씬 빠르고 강력한 텍스트 검색을 제공합니다.

### 일반 검색 vs FTS5

| 비교 항목 | LIKE 검색 | FTS5 검색 |
|----------|-----------|-----------|
| **속도** | O(n) - 전체 스캔 | O(log n) - 인덱스 사용 |
| **검색 방식** | 단순 패턴 매칭 | 토큰화된 인덱스 |
| **랭킹** | 없음 | BM25 알고리즘 |
| **고급 기능** | 없음 | AND/OR/NOT, 근접 검색, 구문 검색 |
| **한글 지원** | 부분 문자열 매칭 | 공백 기준 토큰 매칭 |

---

## 동작 원리

### 1. 토큰화 (Tokenization)

FTS5는 텍스트를 **토큰(단어)** 단위로 분리하여 인덱싱합니다.

```
원본: "API 인증은 JWT로 하자"
토큰: ["API", "인증은", "JWT로", "하자"]
```

### 2. 역인덱스 (Inverted Index)

각 토큰이 어떤 문서(행)에 있는지 역으로 매핑합니다.

```
"API"   → [문서1, 문서5, 문서12]
"JWT"   → [문서1, 문서3]
"인증"  → [문서1, 문서7, 문서9]
```

### 3. BM25 랭킹

검색 결과를 **관련도 순**으로 정렬합니다. BM25는 TF-IDF의 개선된 버전으로:
- **TF (Term Frequency)**: 해당 문서에서 검색어가 얼마나 자주 나오는가
- **IDF (Inverse Document Frequency)**: 전체 문서에서 얼마나 희귀한 단어인가

```sql
-- BM25 점수로 정렬 (낮을수록 관련도 높음)
SELECT *, bm25(messages_fts) as rank
FROM messages_fts
WHERE messages_fts MATCH 'API'
ORDER BY rank;
```

---

## 구현 방법

### 1. FTS5 가상 테이블 생성

```sql
-- Content 테이블 연동 방식 (권장)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,                    -- 검색할 컬럼
  content='messages',         -- 원본 테이블
  content_rowid='rowid'       -- 원본 테이블의 rowid
);
```

**content= 옵션**: 원본 테이블과 연동하여 데이터 중복을 방지합니다.

### 2. 동기화 트리거

원본 테이블이 변경될 때 FTS 인덱스를 자동으로 업데이트합니다.

```sql
-- INSERT 트리거
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

-- DELETE 트리거
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES('delete', old.rowid, old.content);
END;

-- UPDATE 트리거
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;
```

### 3. 기존 데이터 인덱싱

이미 존재하는 데이터를 FTS 테이블에 추가합니다.

```sql
INSERT INTO messages_fts(rowid, content)
SELECT rowid, content FROM messages;
```

---

## 검색 문법

### 기본 검색

```sql
-- 단일 키워드
SELECT * FROM messages_fts WHERE messages_fts MATCH 'API';

-- 여러 키워드 (AND)
SELECT * FROM messages_fts WHERE messages_fts MATCH 'API JWT';

-- OR 검색
SELECT * FROM messages_fts WHERE messages_fts MATCH 'API OR OAuth';

-- NOT 검색
SELECT * FROM messages_fts WHERE messages_fts MATCH 'API NOT OAuth';
```

### 구문 검색 (Phrase Search)

정확한 구문을 검색합니다.

```sql
-- "API 인증" 구문 검색
SELECT * FROM messages_fts WHERE messages_fts MATCH '"API 인증"';
```

### 접두사 검색 (Prefix Search)

```sql
-- "API"로 시작하는 단어
SELECT * FROM messages_fts WHERE messages_fts MATCH 'API*';
```

### 근접 검색 (NEAR)

두 단어가 가까이 있는 문서를 찾습니다.

```sql
-- API와 JWT가 10단어 이내에 있는 문서
SELECT * FROM messages_fts WHERE messages_fts MATCH 'NEAR(API JWT, 10)';
```

---

## 실제 구현 코드

### TypeScript (better-sqlite3)

```typescript
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
`);

// 검색 함수
function searchMessages(query: string, limit: number = 10) {
  // 특수문자 이스케이프
  const escapedQuery = query.replace(/"/g, '""');
  const ftsQuery = `"${escapedQuery}"`;

  return searchMessagesFts.all(ftsQuery, limit);
}

// 사용 예시
const results = searchMessages('API 설계', 5);
```

### 세션 필터링 추가

```typescript
const searchWithSession = db.prepare(`
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
`);

// 특정 채널에서만 검색
const results = searchWithSession.all(
  '"API 설계"',
  '%slack:C123456%',
  10
);
```

---

## 성능 비교

### 테스트 환경
- 메시지 100,000개
- 평균 메시지 길이: 200자

### 결과

| 검색 방식 | 검색 시간 | 비고 |
|----------|----------|------|
| `LIKE '%API%'` | ~500ms | 전체 테이블 스캔 |
| `FTS5 MATCH` | ~5ms | 인덱스 사용 |

**100배 빠른 검색 속도**를 얻을 수 있습니다.

---

## 한글 검색 주의사항

### 기본 토크나이저의 한계

FTS5의 기본 토크나이저(unicode61)는 **공백 기준**으로 토큰을 분리합니다.

```
"API 인증은 JWT로 하자"
→ ["API", "인증은", "JWT로", "하자"]
```

따라서:
- `"인증"` 검색 → ❌ 매칭 안됨 ("인증은"만 있음)
- `"인증은"` 검색 → ✅ 매칭됨

### 해결 방법

#### 1. 구문 검색 사용 (권장)

```sql
-- 부분 문자열도 검색 가능
SELECT * FROM messages_fts WHERE messages_fts MATCH '"인증"';
```

#### 2. trigram 토크나이저 사용

```sql
-- 3글자씩 분리하여 인덱싱
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  tokenize='trigram'
);
```

단점: 인덱스 크기가 커지고 검색 정확도가 떨어질 수 있음

#### 3. 형태소 분석기 연동

한글 전용 토크나이저를 커스텀으로 만들 수 있지만, SQLite 확장 개발이 필요합니다.

---

## 우리 시스템에서의 활용

### 아키텍처

```
[Slack 사용자]
    │
    ▼ "지난번에 API 얘기한 거 뭐였지?"
[Claude]
    │
    ▼ conversation_search 도구 호출
[MCP Server]
    │
    ▼ REST API 호출
[Gateway Server]
    │
    ▼ chatDb.searchMessages()
[SQLite FTS5]
    │
    ▼ 검색 결과 반환
[Claude]
    │
    ▼ 컨텍스트로 활용하여 답변
[Slack 사용자]
```

### MCP 도구

```typescript
// conversation_search 도구
server.tool(
  'conversation_search',
  '과거 대화 내용을 검색합니다.',
  {
    query: z.string().describe('검색할 키워드'),
    session_id: z.string().optional(),
    limit: z.number().default(5),
  },
  async ({ query, session_id, limit }) => {
    const results = await apiCall('GET',
      `/api/messages/search?q=${query}&limit=${limit}`
    );
    return formatResults(results);
  }
);
```

### REST API

```
GET /api/messages/search?q=API&session_id=slack:C123&limit=10
```

---

## 장단점 정리

### 장점

1. **빠른 검색 속도**: 대량의 데이터에서도 밀리초 단위 검색
2. **랭킹 지원**: BM25로 관련도 순 정렬
3. **추가 비용 없음**: SQLite 내장 기능
4. **간단한 구현**: 별도 서버 불필요
5. **트랜잭션 지원**: 원본 테이블과 동기화

### 단점

1. **한글 토큰화 한계**: 공백 기준 분리
2. **의미론적 검색 불가**: 동의어, 유사어 검색 어려움
3. **실시간 업데이트 오버헤드**: 트리거로 인한 쓰기 성능 저하

### 대안과 비교

| 기능 | FTS5 | Elasticsearch | 벡터 검색 |
|------|------|---------------|----------|
| 설치 | 내장 | 별도 서버 | 임베딩 API 필요 |
| 비용 | 무료 | 서버 비용 | API 비용 |
| 한글 | 제한적 | 형태소 분석 | 의미 기반 |
| 의미 검색 | ❌ | ❌ | ✅ |
| 복잡도 | 낮음 | 높음 | 중간 |

---

## 결론

FTS5는 **간단하면서도 효과적인 전문 검색** 솔루션입니다.

- 별도 인프라 없이 SQLite만으로 빠른 검색 구현
- 대화 기록, 문서, 로그 등 텍스트 검색에 적합
- 한글 검색은 구문 검색(`"키워드"`)으로 보완 가능

더 고급 검색(동의어, 의미 기반)이 필요하면 벡터 검색(임베딩)을 추가로 고려할 수 있습니다.

---

**관련 문서**:
- [OpenClaw 메모리 시스템 분석](./openclaw-growth-system-analysis.md)
- [SQLite FTS5 공식 문서](https://www.sqlite.org/fts5.html)

**참고 소스 파일**:
- [src/db/database.ts](../src/db/database.ts) - FTS5 스키마 및 검색 구현
- [src/mcp/server.ts](../src/mcp/server.ts) - conversation_search MCP 도구
- [src/websocket/server.ts](../src/websocket/server.ts) - REST API 엔드포인트
