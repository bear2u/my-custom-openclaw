# RS-SDK MCP 연동 가이드: Claude가 게임 봇을 제어하는 방법

> AI가 게임 캐릭터를 자동으로 제어한다면 어떨까요? RS-SDK의 MCP(Model Context Protocol) 연동을 통해 Claude AI가 직접 게임 봇에 명령을 내리고, 상태를 확인하고, 복잡한 자동화 스크립트를 실행할 수 있습니다.

---

## 목차

1. [MCP란 무엇인가?](#mcp란-무엇인가)
2. [RS-SDK의 아키텍처](#rs-sdk의-아키텍처)
3. [MCP 서버 구조](#mcp-서버-구조)
4. [BotManager: 다중 봇 연결 관리](#botmanager-다중-봇-연결-관리)
5. [2계층 API 설계](#2계층-api-설계)
6. [실제 사용 예시](#실제-사용-예시)
7. [설정 및 실행 방법](#설정-및-실행-방법)

---

## MCP란 무엇인가?

**MCP(Model Context Protocol)**는 Anthropic이 개발한 AI 모델과 외부 도구를 연결하는 표준 프로토콜입니다. 쉽게 말해, Claude가 "외부 세계와 상호작용"할 수 있게 해주는 다리 역할을 합니다.

```
┌─────────────────┐
│  Claude AI      │  "나무를 베어줘"
└────────┬────────┘
         │ MCP Protocol (stdio)
         ↓
┌─────────────────┐
│  MCP Server     │  execute_code 도구 실행
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  게임 봇        │  bot.chopTree()
└─────────────────┘
```

MCP를 통해 Claude는:
- **도구(Tools)**: 특정 작업을 수행하는 함수 호출
- **리소스(Resources)**: 파일이나 데이터 읽기
- **프롬프트(Prompts)**: 미리 정의된 템플릿 사용

이 중 RS-SDK는 **도구** 기능을 활용해 게임 봇을 제어합니다.

---

## RS-SDK의 아키텍처

RS-SDK는 4계층 아키텍처로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: AI Layer (Claude + MCP)                               │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ MCP Server (mcp/server.ts)                                  │
│  │ - execute_code: 봇에서 코드 실행                            │
│  │ - list_bots: 연결된 봇 목록                                 │
│  │ - disconnect_bot: 봇 연결 해제                              │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: SDK Layer                                             │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │ BotActions (고수준)   │  │ BotSDK (저수준)                  │ │
│  │ - chopTree()          │  │ - getState()                     │ │
│  │ - walkTo()            │  │ - sendWalk()                     │ │
│  │ - attackNpc()         │  │ - findNearbyNpc()                │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Gateway (:7780)                                       │
│  - Bot ↔ SDK 메시지 라우팅                                      │
│  - 다중 봇 세션 관리                                            │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Bot Client (브라우저 또는 헤드리스)                    │
│  - 게임 서버와 직접 통신                                        │
│  - 화면 렌더링 및 입력 처리                                     │
└─────────────────────────────────────────────────────────────────┘
```

이 아키텍처의 핵심은 **관심사의 분리**입니다:
- Bot Client는 게임 프로토콜만 처리
- Gateway는 메시지 라우팅만 담당
- SDK는 비즈니스 로직 제공
- MCP는 AI 인터페이스 담당

---

## MCP 서버 구조

### 핵심 파일

```
mcp/
├── server.ts           # MCP 서버 메인 (stdio transport)
├── package.json        # @modelcontextprotocol/sdk 의존성
└── api/
    ├── index.ts        # BotManager - 봇 연결 관리자
    ├── bot.ts          # 고수준 API 문서
    └── sdk.ts          # 저수준 API 문서
```

### server.ts 핵심 코드

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { botManager } from './api/index.js';

const server = new Server({
  name: 'rs-agent-bot',
  version: '2.0.0'
}, {
  capabilities: {
    resources: {},  // API 문서 제공
    tools: {}       // 봇 제어 도구 제공
  }
});
```

### 제공되는 도구들

| 도구 | 설명 | 파라미터 |
|------|------|---------|
| `execute_code` | 봇에서 TypeScript 코드 실행 | `bot_name`, `code` |
| `list_bots` | 연결된 봇 목록 조회 | 없음 |
| `disconnect_bot` | 봇 연결 해제 | `name` |

가장 핵심은 `execute_code` 도구입니다:

```typescript
case 'execute_code': {
  const botName = args?.bot_name as string;
  const code = args?.code as string;

  // 자동 연결 - 봇이 없으면 bots/{name}/bot.env에서 자격증명 로드
  let connection = botManager.get(botName);
  if (!connection) {
    connection = await botManager.connect(botName);
  }

  // 동적 함수 생성 및 실행
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('bot', 'sdk', code);
  const result = await fn(connection.bot, connection.sdk);

  return {
    content: [{
      type: 'text',
      text: formatWorldState(connection.sdk.getState())
    }]
  };
}
```

**핵심 포인트:**
1. `bot_name`으로 자동 연결 (자격증명은 `bots/{name}/bot.env`에서 로드)
2. `code`는 `async` 컨텍스트에서 실행됨
3. `bot` (고수준)과 `sdk` (저수준) 객체 사용 가능
4. 실행 후 현재 게임 상태 자동 반환

---

## BotManager: 다중 봇 연결 관리

`BotManager`는 여러 봇을 동시에 관리하는 싱글톤 클래스입니다.

### 연결 흐름

```typescript
class BotManager {
  private connections: Map<string, BotConnection> = new Map();

  async connect(name: string): Promise<BotConnection> {
    // 1. 이미 연결된 봇이면 재사용
    if (this.connections.has(name)) {
      return this.connections.get(name)!;
    }

    // 2. bot.env에서 자격증명 로드
    const envPath = join(process.cwd(), 'bots', name, 'bot.env');
    const envContent = await readFile(envPath, 'utf-8');
    const { BOT_USERNAME, PASSWORD, GATEWAY_URL } = parseEnv(envContent);

    // 3. SDK 인스턴스 생성
    const sdk = new BotSDK({
      botUsername: BOT_USERNAME,
      password: PASSWORD,
      gatewayUrl: GATEWAY_URL,
      connectionMode: 'control',
    });

    // 4. 고수준 액션 래퍼 생성
    const bot = new BotActions(sdk);

    // 5. 연결 및 저장
    await sdk.connect();
    this.connections.set(name, { sdk, bot, username, connected: true });

    return connection;
  }
}

export const botManager = new BotManager();
```

### bot.env 파일 형식

```env
# bots/mybot/bot.env
BOT_USERNAME=mybot
PASSWORD=mypassword123
SERVER=rs-sdk-demo.fly.dev  # 또는 로컬: 없으면 localhost:7780
SHOW_CHAT=false             # 다른 플레이어 채팅 표시 여부
```

---

## 2계층 API 설계

RS-SDK는 **고수준**과 **저수준** 두 가지 API를 제공합니다.

### 저수준 API (sdk)

상태 조회와 원시 명령 전송:

```typescript
// 상태 조회 (동기)
const state = sdk.getState();
const inventory = sdk.getInventory();
const npc = sdk.findNearbyNpc(/merchant/i);

// 원시 명령 (Promise - 서버 ACK 시 resolve)
await sdk.sendWalk(3200, 3200);
await sdk.sendInteractNpc(npc.index, 0);  // 0 = 첫 번째 옵션
await sdk.sendTakeGroundItem(x, z, itemId);
```

**특징:**
- 동기적 상태 조회 (캐시된 상태)
- 서버 **응답(ACK)** 시점에 Promise resolve
- 효과 완료를 기다리지 않음

### 고수준 API (bot)

도메인 로직이 포함된 복합 액션:

```typescript
// 나무 베기 - 통나무를 얻을 때까지 대기
const result = await bot.chopTree(/^tree$/i);
if (result.success) {
  console.log('획득한 통나무:', result.logs);
}

// 좌표 이동 - 도착하거나 막힐 때까지 대기
await bot.walkTo(3200, 3200, 5);  // 허용 오차 5타일

// NPC 공격 - 전투 완료까지 대기
await bot.attackNpc('goblin');

// 은행 열기 - NPC 찾기 + 대화까지 자동 처리
await bot.openBank();
await bot.depositAll();
```

**특징:**
- 효과가 **완료**될 때까지 대기
- 실패 시 재시도 로직 포함
- 결과 객체로 성공/실패 및 상세 정보 반환

### API 선택 가이드

| 상황 | 추천 API |
|------|---------|
| 단순 상태 확인 | `sdk.getState()` |
| 복잡한 작업 (채광, 벌목 등) | `bot.mineRock()`, `bot.chopTree()` |
| 커스텀 대기 로직 필요 | `sdk.sendInteractLoc()` + `sdk.waitForCondition()` |
| 인벤토리 확인 | `sdk.getInventory()` |
| 은행 작업 | `bot.openBank()`, `bot.depositItem()` |

---

## 실제 사용 예시

### 예시 1: Claude에게 나무 베기 요청

**사용자**: "mybot을 제어해서 주변 나무를 베고 통나무를 수집해줘"

**Claude가 호출하는 도구**:
```json
{
  "name": "execute_code",
  "arguments": {
    "bot_name": "mybot",
    "code": "const tree = sdk.findNearbyLoc(/^tree$/i);\nif (tree) {\n  const result = await bot.chopTree(tree);\n  console.log('결과:', result);\n}\nreturn sdk.getInventory();"
  }
}
```

**결과**:
```
── Console ──
결과: { success: true, logs: 1 }

── World State ──
Player: mybot Lv35 HP:99/99
  Position: (3205, 3210) Zone: lumbridge
  ATK:35 DEF:30 XP:45230
Inventory: 28 items
  - Bronze axe x1
  - Logs x5
```

### 예시 2: 복합 작업 스크립트

```typescript
// 벌목 → 불피우기 루프
const ITERATIONS = 10;

for (let i = 0; i < ITERATIONS; i++) {
  // 나무 찾기
  const tree = sdk.findNearbyLoc(/^tree$/i);
  if (!tree) {
    console.log('나무를 찾을 수 없음');
    break;
  }

  // 나무 베기
  const chopResult = await bot.chopTree(tree);
  if (!chopResult.success) {
    console.log('벌목 실패:', chopResult.message);
    continue;
  }

  // 통나무 불태우기
  const logs = sdk.findInventoryItem(/^logs$/i);
  if (logs) {
    const burnResult = await bot.burnLogs(logs);
    console.log(`루프 ${i + 1}: 불피우기 ${burnResult.success ? '성공' : '실패'}`);
  }
}

return { logsProcessed: ITERATIONS };
```

### 예시 3: 다중 봇 제어

```typescript
// 봇 1: 광부
execute_code({
  bot_name: "miner",
  code: `
    while (true) {
      const rock = sdk.findNearbyLoc(/copper rock/i);
      if (rock) await bot.mineRock(rock);
      if (sdk.getInventory().length >= 28) {
        await bot.openBank();
        await bot.depositAll();
      }
    }
  `
});

// 봇 2: 벌목꾼
execute_code({
  bot_name: "woodcutter",
  code: `
    while (true) {
      const tree = sdk.findNearbyLoc(/^tree$/i);
      if (tree) await bot.chopTree(tree);
      // ... 동일 패턴
    }
  `
});
```

---

## 설정 및 실행 방법

### 1. 봇 생성

```bash
# 봇 디렉토리 및 설정 파일 생성
mkdir -p bots/mybot
cat > bots/mybot/bot.env << EOF
BOT_USERNAME=mybot
PASSWORD=mypassword123
EOF
```

### 2. MCP 서버 설정

프로젝트 루트에 `.mcp.json` 생성:

```json
{
  "mcpServers": {
    "rs-agent": {
      "command": "bun",
      "args": ["run", "mcp/server.ts"]
    }
  }
}
```

### 3. 의존성 설치

```bash
cd mcp && bun install
```

### 4. Claude Code/Desktop에서 사용

Claude Code를 프로젝트 디렉토리에서 실행하면 `.mcp.json`을 자동 감지합니다:

```bash
cd rs-sdk
claude
```

MCP 서버 승인 후, Claude에게 요청:

```
"mybot을 연결하고 현재 상태를 알려줘"
"주변에 있는 NPC 목록을 보여줘"
"가장 가까운 나무를 베고 결과를 알려줘"
```

### 5. 수동 테스트

MCP 서버 없이 SDK만 테스트:

```typescript
// scripts/test.ts
import { botManager } from '../mcp/api/index';

const connection = await botManager.connect('mybot');
console.log('상태:', connection.sdk.getState());
await connection.bot.chopTree();
await botManager.disconnect('mybot');
```

```bash
bun run scripts/test.ts
```

---

## 마치며

RS-SDK의 MCP 연동은 AI와 게임 자동화의 경계를 허물어줍니다. Claude가 자연어로 요청을 받으면:

1. 요청을 `execute_code` 도구 호출로 변환
2. BotManager가 해당 봇에 연결
3. TypeScript 코드가 봇에서 실행
4. 결과와 현재 게임 상태가 Claude에게 반환

이 구조 덕분에:
- **자연어 인터페이스**: "나무 10그루 베줘" 같은 요청 가능
- **코드 생성**: Claude가 상황에 맞는 코드 자동 생성
- **상태 인식**: 게임 상태를 보고 판단하여 다음 행동 결정
- **다중 봇 관리**: 여러 봇을 동시에 제어

게임 봇 개발의 새로운 패러다임, MCP와 함께 시작해보세요!

---

## 참고 자료

- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [RS-SDK GitHub](https://github.com/MaxBittker/rs-sdk)
- [Anthropic Claude API](https://docs.anthropic.com/)
