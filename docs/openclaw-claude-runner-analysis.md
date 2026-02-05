# OpenClaw Claude Runner 아키텍처 분석

> OpenClaw가 Claude Code CLI를 어떻게 실행하고 관리하는지에 대한 기술 문서

## 개요

OpenClaw는 로컬에 설치된 Claude Code CLI를 **PTY(Pseudo Terminal)**를 통해 제어합니다. 이 방식은 단순한 `spawn()` 호출보다 더 정교한 터미널 제어와 실시간 스트리밍을 가능하게 합니다.

---

## 1. 핵심 아키텍처

### 1.1 전체 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  클라이언트 (Slack, Discord, Telegram, Web UI 등)           │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────────────────────────────┐                    │
│  │     Gateway WebSocket Server        │ ← 포트 18789       │
│  │     (src/gateway/server.ts)         │                    │
│  └─────────────────────────────────────┘                    │
│       │                                                      │
│       │ chat.send 요청                                       │
│       ▼                                                      │
│  ┌─────────────────────────────────────┐                    │
│  │     Agent Runner                    │                    │
│  │     (pi-embedded-runner)            │                    │
│  └─────────────────────────────────────┘                    │
│       │                                                      │
│       │ PTY spawn                                            │
│       ▼                                                      │
│  ┌─────────────────────────────────────┐                    │
│  │     node-pty (터미널 에뮬레이션)    │                    │
│  │     @lydell/node-pty               │                    │
│  └─────────────────────────────────────┘                    │
│       │                                                      │
│       │ 프로세스 실행                                        │
│       ▼                                                      │
│  ┌─────────────────────────────────────┐                    │
│  │     Claude Code CLI                 │                    │
│  │     (~/.claude/local/claude)        │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 왜 PTY를 사용하는가?

| 방식 | spawn() | PTY (node-pty) |
|------|---------|----------------|
| 터미널 에뮬레이션 | X | O |
| 인터랙티브 입력 | 제한적 | 완전 지원 |
| 실시간 스트리밍 | 버퍼링됨 | 즉시 |
| 세션 유지 | 어려움 | 자연스러움 |
| 취소/중단 | SIGKILL | 우아한 종료 |
| 컬러/ANSI 지원 | X | O |

---

## 2. PTY 기반 실행 코드

### 2.1 PTY 타입 정의

**파일**: `openclaw/src/agents/bash-tools.exec.ts`

```typescript
// PTY 종료 이벤트
type PtyExitEvent = { exitCode: number; signal?: number }

// PTY 리스너 타입
type PtyListener<T> = (event: T) => void

// PTY 핸들 인터페이스
type PtyHandle = {
  pid: number                                    // 프로세스 ID
  write: (data: string | Buffer) => void         // 입력 전송
  onData: (listener: PtyListener<string>) => void  // 출력 수신
  onExit: (listener: PtyListener<PtyExitEvent>) => void  // 종료 이벤트
}

// PTY spawn 함수 타입
type PtySpawn = (
  file: string,           // 실행 파일 (claude)
  args: string[] | string, // 인자
  options: {
    name?: string         // 터미널 타입 (xterm-256color)
    cols?: number         // 컬럼 수
    rows?: number         // 행 수
    cwd?: string          // 작업 디렉토리
    env?: Record<string, string>  // 환경 변수
  },
) => PtyHandle
```

### 2.2 PTY 실행 예시

```typescript
import pty from '@lydell/node-pty'

// PTY로 Claude CLI 실행
const ptyProcess = pty.spawn(claudePath, args, {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: workspaceDir,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
  },
})

// 출력 수신
ptyProcess.onData((data: string) => {
  // 실시간으로 출력 데이터 수신
  // JSON 라인 파싱 또는 텍스트 처리
  console.log('Output:', data)
})

// 종료 이벤트
ptyProcess.onExit(({ exitCode, signal }) => {
  console.log(`Process exited with code ${exitCode}`)
})

// 입력 전송 (인터랙티브 모드)
ptyProcess.write('hello\n')

// 프로세스 종료
ptyProcess.kill()
```

---

## 3. 세션 관리

### 3.1 세션 키 전략

OpenClaw는 다양한 채널(Slack, Discord, Telegram 등)에서 세션을 관리합니다:

```typescript
// 세션 키 형식
type SessionKey =
  | `slack:${channelId}`      // Slack 채널
  | `discord:${channelId}`    // Discord 채널
  | `telegram:${chatId}`      // Telegram 채팅
  | `web:${sessionId}`        // 웹 UI
  | string                    // 기타 UUID
```

### 3.2 세션 파일 구조

```
~/.openclaw/sessions/
├── slack:C1234567890/
│   ├── session.json          # 세션 메타데이터
│   ├── history.jsonl         # 대화 히스토리
│   └── context/              # 컨텍스트 파일들
├── discord:987654321/
│   └── ...
└── web:abc123/
    └── ...
```

### 3.3 세션 상태 관리

```typescript
interface Session {
  sessionId: string           // Claude CLI 세션 ID (UUID)
  sessionKey: string          // 채널별 키 (slack:xxx)
  createdAt: number           // 생성 시간
  lastActiveAt: number        // 마지막 활동 시간
  model: string               // 사용 모델
  abortController?: AbortController  // 취소 컨트롤러
}

// 세션 레지스트리
const sessions = new Map<string, Session>()

// 세션 조회 또는 생성
function getOrCreateSession(sessionKey: string): Session {
  let session = sessions.get(sessionKey)

  if (!session) {
    session = {
      sessionId: undefined,  // Claude가 반환할 때까지 undefined
      sessionKey,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      model: 'sonnet',
    }
    sessions.set(sessionKey, session)
  }

  return session
}
```

---

## 4. 스트리밍 출력 처리

### 4.1 Claude CLI 출력 형식

Claude CLI는 `--output-format stream-json` 옵션으로 JSON Lines 형식의 스트리밍 출력을 제공합니다:

```json
{"type":"system","subtype":"init","session_id":"550e8400-e29b-41d4-a716-446655440000"}
{"type":"assistant","message":{"content":[{"type":"text","text":"안녕"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"안녕하세요!"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"안녕하세요! 무엇을"}]}}
{"type":"result","result":"안녕하세요! 무엇을 도와드릴까요?","session_id":"550e8400-e29b-41d4-a716-446655440000"}
```

### 4.2 스트림 파싱

```typescript
interface StreamEvent {
  type: 'system' | 'assistant' | 'result' | 'error'
  subtype?: string
  session_id?: string
  message?: {
    content?: Array<{ type: string; text?: string }>
  }
  result?: string
  error?: string
}

function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null

  try {
    return JSON.parse(line) as StreamEvent
  } catch {
    return null
  }
}

// PTY 출력 처리
let buffer = ''
let accumulatedText = ''
let sessionId: string | undefined

ptyProcess.onData((data: string) => {
  buffer += data

  // 완성된 라인 처리
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''  // 마지막 불완전한 라인 보관

  for (const line of lines) {
    const event = parseStreamLine(line)
    if (!event) continue

    // 세션 ID 추출
    if (event.session_id) {
      sessionId = event.session_id
    }

    // 텍스트 추출
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          accumulatedText = block.text  // 누적 텍스트로 교체
          onChunk(block.text, accumulatedText)
        }
      }
    }

    // 최종 결과
    if (event.type === 'result') {
      accumulatedText = event.result || accumulatedText
    }
  }
})
```

---

## 5. Gateway 프로토콜

### 5.1 WebSocket 프레임 구조

```typescript
// 요청 프레임
interface RequestFrame {
  type: 'req'
  id: string          // UUID (응답 매칭용)
  method: string      // 메서드 이름
  params?: unknown    // 파라미터
}

// 응답 프레임
interface ResponseFrame {
  type: 'res'
  id: string          // 요청 ID와 매칭
  ok: boolean         // 성공 여부
  payload?: unknown   // 결과 데이터
  error?: { message: string }
}

// 이벤트 프레임 (서버 → 클라이언트)
interface EventFrame {
  type: 'event'
  event: string       // 이벤트 타입 (chat, status 등)
  payload?: unknown   // 이벤트 데이터
}
```

### 5.2 chat.send 프로토콜

**요청:**
```json
{
  "type": "req",
  "id": "req-123",
  "method": "chat.send",
  "params": {
    "sessionKey": "slack:C1234567890",
    "message": "안녕하세요",
    "timeoutMs": 120000,
    "idempotencyKey": "idem-456"
  }
}
```

**즉시 응답:**
```json
{
  "type": "res",
  "id": "req-123",
  "ok": true,
  "payload": { "runId": "run-789" }
}
```

**스트리밍 이벤트 (delta):**
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run-789",
    "sessionKey": "slack:C1234567890",
    "seq": 0,
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "안녕하세요! 무엇을" }]
    }
  }
}
```

**최종 이벤트 (final):**
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run-789",
    "sessionKey": "slack:C1234567890",
    "seq": 1,
    "state": "final",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "안녕하세요! 무엇을 도와드릴까요?" }]
    }
  }
}
```

### 5.3 에러 및 취소

**에러:**
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run-789",
    "state": "error",
    "errorMessage": "Claude CLI timed out after 120000ms"
  }
}
```

**취소:**
```json
// 클라이언트 → 서버
{
  "type": "req",
  "id": "req-999",
  "method": "chat.abort",
  "params": { "sessionKey": "slack:C1234567890", "runId": "run-789" }
}

// 서버 → 클라이언트 (이벤트)
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run-789",
    "state": "aborted"
  }
}
```

---

## 6. 연결 핸드셰이크

### 6.1 connect 메서드

Gateway에 연결할 때 먼저 `connect` 요청을 보내야 합니다:

```typescript
// 클라이언트 → 서버
{
  "type": "req",
  "id": "connect-1",
  "method": "connect",
  "params": {
    "minProtocol": 2,
    "maxProtocol": 2,
    "client": {
      "id": "slack-connector",
      "displayName": "Slack Connector",
      "version": "1.0.0",
      "platform": "darwin",
      "mode": "backend"
    },
    "caps": [],
    "auth": { "token": "optional-auth-token" },
    "role": "operator",
    "scopes": ["operator.admin"]
  }
}

// 서버 → 클라이언트
{
  "type": "res",
  "id": "connect-1",
  "ok": true,
  "payload": { "protocol": 2 }
}
```

---

## 7. 핵심 코드 위치

| 기능 | 파일 위치 |
|------|----------|
| PTY 실행 | `openclaw/src/agents/bash-tools.exec.ts` |
| Agent Runner | `openclaw/src/agents/pi-embedded-runner/run/attempt.ts` |
| Gateway 서버 | `openclaw/src/gateway/server.ts` |
| 세션 관리 | `openclaw/src/gateway/session-utils.ts` |
| 프로토콜 정의 | `openclaw/src/gateway/protocol/schema/` |
| 스트리밍 처리 | `openclaw/src/agents/pi-embedded-subscribe.ts` |

---

## 8. slack-connector에 적용하기

### 8.1 필요한 변경사항

1. **node-pty 설치**: `@lydell/node-pty` 패키지 사용
2. **PTY Runner 생성**: `spawn()` 대신 `pty.spawn()` 사용
3. **Gateway Server 수정**: PTY Runner를 사용하도록 변경
4. **스트림 파싱 개선**: PTY 출력 버퍼링 처리

### 8.2 예상 구조

```
src/
├── claude/
│   ├── pty-runner.ts      # PTY 기반 Claude 실행
│   ├── stream-parser.ts   # 스트림 JSON 파싱
│   └── session-store.ts   # 세션 저장소
├── gateway/
│   └── server.ts          # Gateway 서버 (PTY Runner 사용)
└── slack/
    └── handler.ts         # Slack 핸들러
```

---

## 9. 참고 자료

- [node-pty GitHub](https://github.com/lydell/node-pty)
- [Claude Code CLI 문서](https://docs.anthropic.com/claude-code)
- [OpenClaw GitHub](https://github.com/anthropics/openclaw)
