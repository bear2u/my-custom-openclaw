# Slack-Claude Gateway

Slack과 Claude CLI를 연동하는 게이트웨이 서버입니다. Slack에서 Claude AI와 대화할 수 있습니다.

## 주요 기능

- **Slack 연동**: Slack 채널에서 봇 멘션으로 Claude와 대화
- **스트리밍 응답**: 실시간으로 응답을 청크 단위로 전송
- **세션 관리**: 채널별 대화 컨텍스트 유지
- **이미지 지원**: 첨부된 이미지 분석 가능
- **WebSocket Gateway**: 웹 클라이언트 연동용 WebSocket 서버
- **브라우저 자동화**: Puppeteer 또는 Chrome 확장 릴레이 모드 지원

## 실행 방법

### 1. 환경 설정

`.env` 파일 생성:

```bash
cp .env.example .env
```

필수 환경변수:

```env
# Slack 설정
ENABLE_SLACK=true
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# 프로젝트 경로 (Claude가 작업할 디렉토리)
PROJECT_PATH=/path/to/your/project

# Claude 설정 (선택)
CLAUDE_MODEL=sonnet          # sonnet | opus | haiku
CLAUDE_TIMEOUT_MS=120000     # 타임아웃 (ms)

# WebSocket 포트 (선택)
WS_PORT=4900

# 브라우저 모드 (선택)
BROWSER_MODE=off             # off | puppeteer | relay
```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. 실행

**백그라운드 실행 (권장):**
```bash
./run.sh
```

**개발 모드:**
```bash
pnpm dev
```

**프로덕션 빌드:**
```bash
pnpm build
pnpm start
```

### 4. 종료

```bash
pkill -f 'tsx src/index.ts'
```

### 5. 로그 확인

```bash
tail -f app.log
```

## Slack 사용법

Slack 채널에서 봇을 멘션하여 대화:

```
@Claude 안녕하세요
@Claude 이 코드를 설명해주세요
```

### 특수 명령어

| 명령어 | 설명 |
|--------|------|
| `새 세션`, `reset` | 새로운 대화 세션 시작 |
| `도움말`, `help` | 사용법 안내 |
| `환경설정`, `config` | 설정 메뉴 |
| `재시작`, `restart` | 게이트웨이 재시작 |

## 아키텍처

```
Slack Message
    ↓
[Slack Handler] ─── 멘션 감지, 명령어 처리
    ↓
[Claude Runner] ─── CLI 실행 (스트리밍 모드)
    ↓
[Session Manager] ─ 채널별 세션 관리
    ↓
Slack Response (청크 단위 전송)
```

## 주요 파일

| 파일 | 설명 |
|------|------|
| `src/index.ts` | 서버 진입점 |
| `src/slack/handler.ts` | Slack 메시지 처리 |
| `src/claude/runner.ts` | Claude CLI 실행 |
| `src/session/manager.ts` | 세션 관리 |
| `src/websocket/server.ts` | WebSocket 게이트웨이 |

## 기술 스택

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Slack SDK**: @slack/bolt
- **Build**: tsx (개발), tsc (빌드)

## 라이선스

MIT
