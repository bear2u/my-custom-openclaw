# Slack-Claude Gateway

[![GitHub](https://img.shields.io/badge/GitHub-bear2u%2Fmy--custom--openclaw-blue)](https://github.com/bear2u/my-custom-openclaw)

Slack Bot과 Claude Code CLI를 연결하는 게이트웨이 서버입니다. Slack에서 메시지를 보내면 Claude Code CLI를 통해 AI 응답을 받을 수 있습니다.

## 주요 기능

### 백엔드
- **Slack Bot 연동**: Socket Mode를 통한 실시간 Slack 연동
- **메시지 큐 시스템**: 채널별 독립 큐, 순차 처리, 작업 취소 지원
- **Claude CLI 통합**: PTY 기반 실행 (OpenClaw 방식), 스트리밍 응답, 세션 관리, AbortSignal 기반 취소
- **크론 스케줄러**: 자연어 기반 일정 예약, 반복 작업, 리마인더 지원
- **WebSocket 서버**: 프론트엔드와 실시간 양방향 통신
- **브라우저 자동화**: Puppeteer / Chrome Extension Relay 지원
- **SQLite 데이터베이스**: 칸반 태스크, 크론 작업 영구 저장

### 프론트엔드
- **채팅 인터페이스**: Claude와 실시간 대화 (스트리밍 응답)
- **칸반 보드**: 드래그 앤 드롭 태스크 관리, 자연어 명령 지원
- **설정 페이지**: CLAUDE.md, Skills, Agents, Slack, Browser 설정
- **세션 관리**: 대화 기록 저장 및 불러오기

### 자연어 칸반 보드 관리
Slack이나 웹 채팅에서 자연어로 칸반 보드를 관리할 수 있습니다:
- `@bot 로그인 버그 수정 태스크 추가해줘` → 태스크 생성
- `@bot 현재 진행 중인 작업 보여줘` → 칸반 현황 조회
- `@bot abc123 완료 처리해줘` → 상태 변경
- `@bot 태스크 삭제해줘` → 태스크 삭제

### Slack 명령어

| 명령어 | 설명 |
|--------|------|
| `@bot 질문` | 질문 처리 (처리 중이면 대기열에 추가) |
| `@bot !질문` | 이전 작업 취소 후 바로 시작 |
| `@bot 큐` | 현재 대기열 상태 표시 |
| `@bot 큐 비우기` | 대기 중인 작업 모두 취소 |
| `@bot 새 세션` | 새로운 대화 세션 시작 |
| `@bot 환경설정` | 게이트웨이 설정 메뉴 |
| `@bot 도움말` | 사용법 안내 |

### 자연어 칸반 명령어

| 예시 | 설명 |
|------|------|
| `@bot API 버그 수정 태스크 추가해줘` | 새 태스크 생성 |
| `@bot 현재 할일 보여줘` | 칸반 보드 현황 조회 |
| `@bot abc123 완료 처리해줘` | 태스크 상태를 done으로 변경 |
| `@bot 우선순위 높음으로 설정해줘` | 태스크 우선순위 변경 |
| `@bot 태스크 삭제해줘` | 태스크 삭제 |

Claude가 `태스크`, `할일`, `버그`, `이슈`, `완료`, `진행중` 등의 키워드를 감지하면 자동으로 칸반 보드를 참조하여 응답합니다.

### 크론/스케줄 명령어

| 명령어 | 설명 |
|--------|------|
| `@bot 20분 후에 "알림" 보내줘` | 일회성 리마인더 (🔔 알림) |
| `@bot 내일 오후 3시에 "보고서 작성" 해줘` | 특정 시간 예약 (🤖 AI) |
| `@bot 매주 월요일 아침에 "주간보고" 해줘` | 주간 반복 |
| `@bot 매일 저녁 6시에 "정리" 해줘` | 일간 반복 |
| `@bot 매 30분마다 "상태 체크" 해줘` | 주기적 반복 |
| `@bot 크론 목록` | 등록된 크론 작업 목록 |
| `@bot 크론 삭제 <id>` | 크론 작업 삭제 |
| `@bot 크론 실행 <id>` | 크론 작업 즉시 실행 |
| `@bot 크론 상태` | 스케줄러 상태 확인 |

**알림 타입 자동 구분:**
- 🔔 **알림 (notify)**: "알려줘", "보내줘" → 메시지만 전달
- 🤖 **AI (agent)**: "해줘", "정리해줘", "분석해줘" → Claude가 응답 생성

## 메시지 큐 시스템

Slack에서 여러 메시지가 동시에 들어올 때를 위한 큐 시스템입니다.

### 동작 방식

```
사용자: @bot 질문1
봇:     👀 처리 중...

사용자: @bot 질문2
봇:     📋 대기열에 추가됨 (대기: 1개)

[질문1 완료]
봇:     ✅ [응답1]
봇:     👀 대기 중인 작업을 시작합니다... (0개 남음)
봇:     ✅ [응답2]
```

### 이전 작업 취소

```
사용자: @bot 질문1
봇:     👀 처리 중...

사용자: @bot !질문2    ← ! 접두사로 취소
봇:     🔄 이전 작업을 취소하고 새 작업을 시작합니다.
봇:     👀 처리 중...
```

### 리액션 의미

| 리액션 | 의미 |
|--------|------|
| 👀 | 메시지 처리 중 |
| ✅ | 응답 완료 |
| 📋 | 대기열에 추가됨 |
| ✨ | 새 세션 시작됨 |
| ⚙️ | 환경설정 모드 |
| 🕐 | 크론 작업 등록됨 |
| 🔄 | 재시작 중 |
| ❌ | 오류 발생/작업 취소됨 |
| ❓ | 응답 생성 실패 |

## 크론 스케줄러

자연어로 예약 작업을 등록하고, 지정된 시간에 Claude가 자동으로 실행하여 결과를 Slack으로 전달합니다.

### 지원하는 자연어 패턴

**일회성 (리마인더)**
```
@bot 20분 후에 "회의 알림" 보내줘
@bot 2시간 후에 "점검 시작" 해줘
@bot 내일 오후 3시에 "보고서 작성" 해줘
@bot 다음주 월요일에 "주간 회의 준비" 해줘
```

**반복 스케줄**
```
@bot 매일 아침 9시에 "출근 인사" 해줘
@bot 매일 저녁 6시에 "오늘 작업 정리" 해줘
@bot 매주 월요일 아침에 "주간 보고서 작성" 해줘
@bot 매 30분마다 "서버 상태 체크" 해줘
```

### 시간 표현 지원

| 표현 | 변환 시간 |
|------|----------|
| 아침 | 09:00 |
| 오전 | 10:00 |
| 점심 | 12:00 |
| 오후 | 14:00 |
| 저녁 | 18:00 |
| 밤 | 21:00 |
| 오후 3시 | 15:00 |
| 오전 10시 30분 | 10:30 |

### 동작 방식

```
사용자: @bot 30분 후에 "회의 시작 알림" 보내줘
봇:     🕐 크론 작업 등록됨 `abc12345`
        ⏰ 30분 후 (일회성)
        📝 "회의 시작 알림"

[30분 후]
봇:     ⏰ [회의 시작 알림] (30분 후)

        회의가 곧 시작됩니다. 참석 준비를 해주세요.
        (Claude가 생성한 응답)
```

### 관리 명령어

```
@bot 크론 목록              → 등록된 모든 크론 작업 표시
@bot 크론 상태              → 스케줄러 상태 (활성, 작업 수, 다음 실행)
@bot 크론 삭제 abc12345     → 해당 ID의 크론 작업 삭제
@bot 크론 실행 abc12345     → 해당 크론 작업 즉시 실행
```

### WebSocket API

프론트엔드에서도 크론 작업을 관리할 수 있습니다:

| 메서드 | 설명 |
|--------|------|
| `cron.list` | 크론 작업 목록 조회 |
| `cron.add` | 크론 작업 추가 |
| `cron.update` | 크론 작업 수정 |
| `cron.remove` | 크론 작업 삭제 |
| `cron.run` | 크론 작업 즉시 실행 |
| `cron.status` | 스케줄러 상태 조회 |

### REST API

MCP 서버나 외부 클라이언트에서 크론 작업을 관리할 수 있는 REST API입니다:

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/cron` | GET | 크론 작업 목록 조회 |
| `/api/cron` | POST | 새 크론 작업 추가 |
| `/api/cron` | DELETE | 모든 크론 작업 삭제 |
| `/api/cron/:number` | DELETE | 번호로 크론 작업 삭제 |
| `/api/cron/:number/run` | POST | 번호로 크론 작업 즉시 실행 |
| `/api/cron/status` | GET | 스케줄러 상태 조회 |
| `/api/messages/search` | GET | 대화 내용 검색 (FTS5) |
| `/health` | GET | 헬스 체크 |

### 대화 검색 API

과거 대화 내용을 전문 검색(Full-Text Search)할 수 있습니다.

**요청:**
```
GET /api/messages/search?q=검색어&session_id=채널ID&limit=10
```

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `q` | ✅ | 검색 키워드 |
| `session_id` | ❌ | 특정 세션/채널로 제한 |
| `limit` | ❌ | 최대 결과 수 (기본: 10, 최대: 50) |

**응답 예시:**
```json
{
  "query": "API 설계",
  "count": 2,
  "results": [
    {
      "id": "msg-123",
      "sessionId": "slack:C123456",
      "role": "user",
      "content": "API 인증은 JWT로 하자",
      "timestamp": 1707225600000,
      "date": "2025-02-06T10:00:00.000Z",
      "rank": -1.5
    }
  ]
}
```

### MCP 서버 (Claude Code 연동)

Claude Code에서 크론 작업을 자연어로 관리할 수 있는 MCP(Model Context Protocol) 서버를 제공합니다.

**MCP 등록:**

```bash
# 프로젝트 범위로 등록
claude mcp add slack-cron -s project node dist/mcp/server.js

# 또는 전역으로 등록
claude mcp add slack-cron node /Users/your-path/slack-connector/dist/mcp/server.js
```

**제공되는 MCP 도구:**

| 도구 | 설명 |
|------|------|
| `cron_list` | 등록된 크론 작업 목록 조회 |
| `cron_add` | 새로운 크론 작업 추가 |
| `cron_delete` | 크론 작업 삭제 (번호 또는 "all") |
| `cron_run` | 크론 작업 즉시 실행 |
| `cron_status` | 크론 서비스 상태 확인 |
| `conversation_search` | 과거 대화 내용 검색 (FTS5) |

**사용 예시 (Claude Code에서):**

```
> 크론 목록 보여줘
> 1번 크론 삭제해줘
> 매일 오전 9시에 날씨 알려달라고 크론 추가해줘
> 크론 상태 확인해줘
> 지난번에 API 설계 얘기한 거 찾아줘
> 이전 대화에서 JWT 관련 검색해줘
```

**참고:** MCP 서버는 REST API(`http://localhost:4900`)를 통해 메인 프로세스와 통신하므로, 백엔드가 실행 중이어야 합니다.

## Claude 실행 모드

환경변수 `CLAUDE_MODE`로 Claude CLI 실행 방식을 선택할 수 있습니다.

| 모드 | 설명 | 특징 |
|------|------|------|
| `pty` (기본값) | PTY 기반 실행 | OpenClaw 방식, 터미널 에뮬레이션, 실시간 스트리밍 |
| `cli` | spawn() 기반 실행 | 기본 프로세스 실행 |
| `gateway` | WebSocket 클라이언트 | 외부 Gateway 서버 연결 |

### PTY 모드 (권장)

[OpenClaw](https://github.com/anthropics/openclaw)와 동일한 방식으로 `node-pty`를 사용하여 가상 터미널에서 Claude CLI를 실행합니다.

```env
CLAUDE_MODE=pty
```

**장점:**
- 터미널 에뮬레이션으로 더 안정적인 출력 처리
- 실시간 스트리밍 응답
- ANSI 이스케이프 시퀀스 지원
- 세션 관리 및 resume 지원

## 프로젝트 구조

```
slack-connector/
├── src/                  # 백엔드 소스 코드
│   ├── websocket/        # WebSocket 서버 및 핸들러
│   ├── slack/            # Slack Bot 핸들러 및 큐 시스템
│   │   ├── handler.ts    # 메시지 처리 핸들러
│   │   └── queue.ts      # 메시지 큐 (drain+pump 패턴)
│   ├── cron/             # 크론 스케줄러
│   │   ├── service.ts    # CronService (armTimer 패턴)
│   │   ├── schedule.ts   # 스케줄 계산 (croner 기반)
│   │   ├── parse.ts      # 자연어 파싱
│   │   └── types.ts      # 타입 정의
│   ├── mcp/              # MCP 서버 (Claude Code 연동)
│   │   └── server.ts     # REST API 기반 크론 MCP 서버
│   ├── claude/           # Claude CLI 러너
│   ├── browser/          # 브라우저 자동화
│   ├── db/               # SQLite 데이터베이스
│   └── session/          # 세션 관리
├── frontend/             # React 프론트엔드
│   ├── src/
│   │   ├── components/   # UI 컴포넌트
│   │   ├── pages/        # 페이지 컴포넌트
│   │   └── hooks/        # React 훅
│   └── package.json
├── docs/                 # 문서
│   ├── architecture-guide.md  # 아키텍처 가이드
│   └── slack-app-manifest.json
├── assets/               # 정적 자산
│   └── chrome-extension/ # Chrome 확장 프로그램
└── package.json
```

## 설치

### 백엔드 설치

```bash
pnpm install
```

### 프론트엔드 설치

```bash
cd frontend
pnpm install
```

### 전체 설치 (한 번에)

```bash
pnpm install && cd frontend && pnpm install && cd ..
```

## 환경 설정

`.env.example`을 복사하여 `.env` 파일을 생성합니다:

```bash
cp .env.example .env
```

### 필수 설정

```env
# 프로젝트 경로
PROJECT_PATH=/path/to/your/project
CLAUDE_PATH=/opt/homebrew/bin/claude

# Slack 연동
ENABLE_SLACK=true
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 전체 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PROJECT_PATH` | Claude가 작업할 프로젝트 경로 | (필수) |
| `CLAUDE_PATH` | Claude CLI 실행 파일 경로 | `/opt/homebrew/bin/claude` |
| `ENABLE_SLACK` | Slack 연동 활성화 | `false` |
| `SLACK_BOT_TOKEN` | Slack Bot 토큰 (xoxb-...) | - |
| `SLACK_APP_TOKEN` | Slack App 토큰 (xapp-...) | - |
| `CLAUDE_MODEL` | Claude 모델 선택 | `sonnet` |
| `CLAUDE_TIMEOUT_MS` | Claude 응답 타임아웃 (ms) | `120000` |
| `CLAUDE_MODE` | Claude 실행 모드 (cli/pty/gateway) | `pty` |
| `GATEWAY_URL` | Gateway 서버 URL (gateway 모드) | `ws://127.0.0.1:18789` |
| `GATEWAY_TOKEN` | Gateway 인증 토큰 (선택) | - |
| `WS_PORT` | WebSocket 서버 포트 | `4900` |
| `BROWSER_MODE` | 브라우저 모드 (off/puppeteer/relay) | `off` |
| `BROWSER_RELAY_PORT` | 브라우저 릴레이 포트 | `18792` |

## Slack App 설정

Slack App을 생성하려면 매니페스트 파일을 사용하세요.

### 1. 매니페스트 파일

[docs/slack-app-manifest.json](docs/slack-app-manifest.json) 파일을 사용하여 Slack App을 빠르게 생성할 수 있습니다.

### 2. Slack App 생성 절차

1. [api.slack.com/apps](https://api.slack.com/apps)에서 **"Create New App"** 클릭
2. **"From an app manifest"** 선택
3. 워크스페이스 선택
4. [docs/slack-app-manifest.json](docs/slack-app-manifest.json) 내용을 붙여넣기
5. 앱 생성 완료

### 3. 토큰 발급

1. **Basic Information → App-Level Tokens**에서 "Generate Token and Scopes" 클릭
2. Token Name 입력, `connections:write` scope 추가 후 Generate
3. **App Token** (`xapp-...`) 복사
4. **OAuth & Permissions**에서 "Install to Workspace" 클릭
5. **Bot User OAuth Token** (`xoxb-...`) 복사
6. `.env` 파일에 토큰 입력

## 실행

### 개발 모드

```bash
# 백엔드만 실행 (포트: 4900)
pnpm dev

# 프론트엔드만 실행 (포트: 4800)
pnpm dev:frontend

# 백엔드 + 프론트엔드 동시 실행
pnpm dev:all
```

### 프로덕션

```bash
# 빌드
pnpm build
cd frontend && pnpm build && cd ..

# 실행
pnpm start
```

## 프론트엔드

### 기능

- **채팅 화면**: Claude와 실시간 대화 (스트리밍 응답)
- **단일 프로젝트**: 환경 변수로 설정된 프로젝트 표시
- **세션 관리**: 대화 기록 저장 및 불러오기
- **설정 페이지** (`/settings/:projectId`): CLAUDE.md, plan.md, Skills, Agents, Slack, Browser 설정
- **칸반 보드** (`/kanban/:projectId`): 작업 관리

### 기술 스택

- React 19
- React Router 7
- Vite 7
- TypeScript 5.9

### 포트

- 개발: `http://localhost:4800`
- 프로덕션: Nginx를 통해 백엔드와 통합

## 문서

- **[아키텍처 가이드](docs/architecture-guide.md)**: 시스템 구조 및 핵심 모듈 설명
- **[블로그 소개](docs/blog-introduction.md)**: 프로젝트 소개 및 주요 특징

## Docker

Docker를 사용하여 실행할 수도 있습니다:

```bash
# 개발 모드
docker-compose -f docker-compose.dev.yml up

# 프로덕션 모드
docker-compose up
```

## 라이선스

MIT
