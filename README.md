# Slack-Claude Gateway

[![GitHub](https://img.shields.io/badge/GitHub-bear2u%2Fmy--custom--openclaw-blue)](https://github.com/bear2u/my-custom-openclaw)

Slack Bot과 Claude Code CLI를 연결하는 게이트웨이 서버입니다. Slack에서 메시지를 보내면 Claude Code CLI를 통해 AI 응답을 받을 수 있습니다.

## 주요 기능

### 백엔드
- **Slack Bot 연동**: Socket Mode를 통한 실시간 Slack 연동
- **메시지 큐 시스템**: 채널별 독립 큐, 순차 처리, 작업 취소 지원
- **Claude CLI 통합**: 스트리밍 응답, 세션 관리, AbortSignal 기반 취소
- **WebSocket 서버**: 프론트엔드와 실시간 양방향 통신
- **브라우저 자동화**: Puppeteer / Chrome Extension Relay 지원
- **SQLite 데이터베이스**: 칸반 태스크 영구 저장

### 프론트엔드
- **채팅 인터페이스**: Claude와 실시간 대화 (스트리밍 응답)
- **칸반 보드**: 드래그 앤 드롭 태스크 관리
- **설정 페이지**: CLAUDE.md, Skills, Agents, Slack, Browser 설정
- **세션 관리**: 대화 기록 저장 및 불러오기

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
| 🔄 | 재시작 중 |
| ❌ | 오류 발생/작업 취소됨 |
| ❓ | 응답 생성 실패 |

## 프로젝트 구조

```
slack-connector/
├── src/                  # 백엔드 소스 코드
│   ├── websocket/        # WebSocket 서버 및 핸들러
│   ├── slack/            # Slack Bot 핸들러 및 큐 시스템
│   │   ├── handler.ts    # 메시지 처리 핸들러
│   │   └── queue.ts      # 메시지 큐 (drain+pump 패턴)
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

자세한 아키텍처 설명은 [docs/architecture-guide.md](docs/architecture-guide.md)를 참조하세요.

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
