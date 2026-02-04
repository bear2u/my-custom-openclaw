# Slack-Claude Gateway 아키텍처 가이드

Slack과 Claude Code CLI를 연결하는 게이트웨이 시스템의 프론트엔드와 백엔드 아키텍처를 상세히 설명합니다.

---

## 시스템 개요

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Slack-Claude Gateway                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────┐     WebSocket      ┌────────────────────────┐    │
│   │  Frontend   │ ◄───────────────► │      Backend Server      │    │
│   │  (React)    │                    │     (Node.js/TS)        │    │
│   └─────────────┘                    └───────────┬────────────┘    │
│         │                                        │                  │
│         ▼                                        ▼                  │
│   ┌─────────────┐                    ┌────────────────────────┐    │
│   │   Vite Dev  │                    │    Claude Code CLI      │    │
│   │   Server    │                    │   (AI Processing)       │    │
│   └─────────────┘                    └────────────────────────┘    │
│                                                  │                  │
│                                                  ▼                  │
│                                      ┌────────────────────────┐    │
│                                      │   Slack Bot (Bolt)      │    │
│                                      │   Socket Mode          │    │
│                                      └────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 백엔드 아키텍처

### 핵심 모듈

#### 1. 진입점 (`src/index.ts`)

서버를 시작하고 모든 서비스를 초기화합니다.

```typescript
// 주요 초기화 순서
1. 환경 설정 로드 (loadConfig)
2. WebSocket 서버 시작 (startWebSocketServer)
3. Slack Bot 연결 (startSlackBot)
4. 브라우저 서비스 초기화 (선택적)
```

#### 2. WebSocket 서버 (`src/websocket/server.ts`)

프론트엔드와의 실시간 통신을 담당합니다.

```typescript
// 기본 포트: 4900
// 주요 이벤트
- connection: 클라이언트 연결
- message: JSON-RPC 스타일 메시지 처리
- close: 연결 종료
```

#### 3. WebSocket 핸들러 (`src/websocket/handlers.ts`)

RPC 스타일의 요청/응답을 처리합니다.

| 핸들러 | 설명 |
|--------|------|
| `projects.list` | 프로젝트 목록 조회 |
| `sessions.list` | 세션 목록 조회 |
| `chat.send` | 메시지 전송 및 Claude 호출 |
| `kanban.*` | 칸반 보드 CRUD |
| `browser.*` | 브라우저 자동화 명령 |

```typescript
// 핸들러 등록 예시
handlers.set('chat.send', async (params, ws) => {
  const { projectId, sessionId, message, images } = params

  // Claude CLI 실행
  const result = await runClaudeStreaming({
    message,
    sessionId,
    cwd: projectPath,
    onChunk: (chunk) => {
      // 스트리밍 응답 전송
      sendChunk(ws, chunk)
    }
  })

  return { text: result.text, sessionId: result.sessionId }
})
```

#### 4. Claude 러너 (`src/claude/runner.ts`)

Claude Code CLI를 실행하고 결과를 파싱합니다.

```typescript
// 주요 함수
runClaude(options)         // 동기 실행
runClaudeStreaming(options) // 스트리밍 실행

// 옵션
interface RunOptions {
  message: string      // 사용자 메시지
  model: string        // 모델 (sonnet, opus, haiku)
  sessionId?: string   // 세션 ID (대화 연속성)
  cwd?: string         // 작업 디렉토리
  signal?: AbortSignal // 취소 시그널
}
```

**AbortSignal 지원** (신규):
```typescript
// 작업 취소 시 프로세스 종료
if (options.signal) {
  options.signal.addEventListener('abort', () => {
    proc.kill('SIGTERM')
    reject(new Error('Request cancelled'))
  })
}
```

#### 5. Slack 핸들러 (`src/slack/handler.ts`)

Slack Bot 이벤트를 처리합니다.

```typescript
// 지원하는 명령어
- @bot 질문      → 큐에 추가, Claude 호출
- @bot !질문     → 이전 작업 취소 후 새 작업
- @bot 큐        → 대기열 상태 표시
- @bot 큐 비우기 → 대기 중인 작업 취소
- @bot 새 세션   → 새 대화 세션 시작
- @bot 환경설정  → 설정 메뉴 표시
- @bot 도움말    → 사용법 안내
```

#### 6. 메시지 큐 (`src/slack/queue.ts`) - 신규

OpenClaw의 command-queue 패턴을 적용한 메시지 큐 시스템입니다.

```typescript
// 핵심 개념: 채널별 독립 큐 + drain/pump 패턴

export class MessageQueue extends EventEmitter {
  // 큐에 추가
  add(item, options): { position, cancelled, queueFull }

  // 현재 작업 취소
  cancelCurrent(channel): boolean

  // 작업 완료 시 호출 (다음 작업 자동 시작)
  complete(channel): QueueItem | null

  // 대기 큐 비우기
  clearPending(channel): number
}

// 사용 흐름
1. 메시지 도착 → messageQueue.add()
2. position === 0 → 바로 처리 시작
3. position > 0 → "큐에 추가됨" 메시지
4. 처리 완료 → messageQueue.complete() → 다음 작업 자동 시작
```

**주요 특징:**
- **채널별 독립 큐**: 각 Slack 채널마다 별도의 큐
- **순차 처리**: 한 번에 하나의 작업만 처리
- **취소 기능**: AbortController로 진행 중인 작업 취소
- **자동 이어받기**: 작업 완료 시 다음 대기 작업 자동 시작

---

## 프론트엔드 아키텍처

### 기술 스택

- **React 19**: UI 프레임워크
- **React Router 7**: 라우팅
- **Vite 7**: 빌드 도구
- **TypeScript 5.9**: 타입 시스템
- **WebSocket**: 실시간 통신

### 페이지 구조

```
frontend/src/
├── App.tsx              # 라우터 설정
├── main.tsx             # 엔트리 포인트
├── pages/
│   ├── SettingsPage.tsx # 설정 페이지
│   └── KanbanPage.tsx   # 칸반 보드
├── components/
│   ├── ChatWindow.tsx   # 채팅 창
│   ├── MessageList.tsx  # 메시지 목록
│   ├── MessageInput.tsx # 메시지 입력
│   ├── Sidebar.tsx      # 사이드바
│   ├── ProjectPanel.tsx # 프로젝트 패널
│   ├── SessionList.tsx  # 세션 목록
│   └── MarkdownContent.tsx # 마크다운 렌더링
└── hooks/
    └── useWebSocket.ts  # WebSocket 커스텀 훅
```

### 주요 컴포넌트

#### 1. ChatWindow (`components/ChatWindow.tsx`)

채팅 인터페이스의 핵심 컴포넌트입니다.

```tsx
function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  // WebSocket으로 메시지 전송
  const sendMessage = async (text: string) => {
    ws.send(JSON.stringify({
      method: 'chat.send',
      params: { projectId, sessionId, message: text }
    }))
  }

  // 스트리밍 응답 처리
  useEffect(() => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'stream') {
        // 실시간 텍스트 업데이트
        updateStreamingMessage(data.chunk)
      }
    }
  }, [ws])
}
```

#### 2. KanbanPage (`pages/KanbanPage.tsx`)

드래그 앤 드롭 칸반 보드입니다.

```tsx
// 칸반 컬럼
const columns = ['backlog', 'todo', 'in_progress', 'done']

// 태스크 상태 변경
const moveTask = (taskId: string, newStatus: string) => {
  ws.send(JSON.stringify({
    method: 'kanban.updateTask',
    params: { id: taskId, status: newStatus }
  }))
}
```

#### 3. SettingsPage (`pages/SettingsPage.tsx`)

프로젝트 설정을 관리합니다.

- CLAUDE.md 편집
- plan.md 편집
- Skills 관리
- Agents 설정
- Slack 연동 설정
- Browser 모드 설정

### WebSocket 통신

```typescript
// 메시지 형식 (JSON-RPC 스타일)
interface WSMessage {
  id?: string           // 요청 ID (응답 매칭용)
  method: string        // 핸들러 이름
  params: Record<string, any>  // 파라미터
}

interface WSResponse {
  id?: string           // 요청 ID
  result?: any          // 성공 결과
  error?: { message: string }  // 에러
}

// 스트리밍 메시지
interface StreamMessage {
  type: 'stream'
  chunk: string         // 텍스트 청크
  sessionId: string
}
```

---

## 데이터베이스

### SQLite (`src/db/database.ts`)

칸반 태스크를 저장합니다.

```sql
-- 테이블 스키마
CREATE TABLE IF NOT EXISTS kanban_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 브라우저 자동화

### 모드

| 모드 | 설명 |
|------|------|
| `off` | 비활성화 |
| `puppeteer` | Headless Chrome (Puppeteer) |
| `relay` | Chrome Extension 릴레이 |

### Puppeteer 모드

```typescript
// src/browser/puppeteer-tool.ts
class PuppeteerBrowser {
  async navigate(url: string)
  async click(selector: string)
  async type(selector: string, text: string)
  async screenshot(): Promise<string>
  async getContent(): Promise<string>
}
```

### Relay 모드

Chrome Extension을 통해 사용자의 브라우저를 원격 제어합니다.

```typescript
// src/browser/relay-server.ts
// WebSocket 서버로 Extension과 통신
// 명령 전송 → Extension 실행 → 결과 수신
```

---

## 배포

### Docker

```yaml
# docker-compose.yml
services:
  gateway:
    build: .
    ports:
      - "4900:4900"
    volumes:
      - ./projects:/app/projects
    environment:
      - PROJECT_PATH=/app/projects/my-project
      - CLAUDE_PATH=/usr/local/bin/claude
```

### Nginx (프로덕션)

```nginx
server {
    listen 80;

    # 프론트엔드 정적 파일
    location / {
        root /app/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 프록시
    location /ws {
        proxy_pass http://localhost:4900;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 확장 가이드

### 새 WebSocket 핸들러 추가

```typescript
// src/websocket/handlers.ts
handlers.set('myFeature.action', async (params, ws) => {
  // 1. 파라미터 검증
  const { someParam } = params

  // 2. 비즈니스 로직
  const result = await doSomething(someParam)

  // 3. 결과 반환
  return { success: true, data: result }
})
```

### 새 Slack 명령어 추가

```typescript
// src/slack/handler.ts

// 1. 키워드 정의
const MY_KEYWORDS = ['내명령', 'mycommand']

// 2. 확인 함수
function isMyRequest(text: string): boolean {
  return MY_KEYWORDS.some(k => text.toLowerCase().includes(k))
}

// 3. 핸들러에서 처리
if (isMyRequest(userMessage)) {
  await sendMessage(client, ctx.channel, '내 명령 실행됨!')
  return
}
```

---

## 참고 자료

- [Slack Bolt for JavaScript](https://slack.dev/bolt-js/concepts)
- [Claude Code CLI 문서](https://docs.anthropic.com/claude-code)
- [React 19 문서](https://react.dev)
- [Vite 가이드](https://vitejs.dev/guide/)

---

GitHub: https://github.com/bear2u/my-custom-openclaw
