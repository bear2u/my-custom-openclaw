# OpenClaw Cron 시스템 분석: AI 에이전트를 위한 스케줄러 설계

OpenClaw의 Cron 시스템은 AI 에이전트가 특정 시간에 자동으로 작업을 수행할 수 있게 해주는 스케줄러입니다. 이 글에서는 OpenClaw가 어떻게 Cron Job을 구현했는지 소스 코드를 기반으로 분석합니다.

## 왜 AI 에이전트에게 Cron이 필요한가?

AI 에이전트는 사용자의 명령을 기다리는 것만으로는 부족합니다. 실제 업무 자동화를 위해서는:

- **정해진 시간에 보고서 생성**: "매일 아침 9시에 어제 이메일 요약해줘"
- **주기적인 모니터링**: "30분마다 서버 상태 확인해줘"
- **리마인더**: "20분 후에 회의 알림 보내줘"

이런 작업들을 위해 OpenClaw는 Gateway 내부에 Cron 스케줄러를 내장했습니다.

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  CronService │───►│    Timer     │───►│  JobRunner   │       │
│  │              │    │  (armTimer)  │    │ (executeJob) │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                        │               │
│         │                                        ▼               │
│         │                               ┌──────────────┐        │
│         │                               │   Session    │        │
│         │                               │ (main/cron)  │        │
│         │                               └──────────────┘        │
│         ▼                                        │               │
│  ┌──────────────┐                               ▼               │
│  │  CronStore   │                       ┌──────────────┐        │
│  │ (jobs.json)  │                       │   Delivery   │        │
│  └──────────────┘                       │  (Slack 등)  │        │
│                                         └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 타입 정의

### Schedule 타입 (언제 실행할지)

```typescript
// src/cron/types.ts
export type CronSchedule =
  | { kind: "at"; atMs: number }           // 일회성 (특정 시간)
  | { kind: "every"; everyMs: number; anchorMs?: number }  // 반복 (간격)
  | { kind: "cron"; expr: string; tz?: string };  // Cron 표현식
```

세 가지 스케줄 방식을 지원합니다:

| 종류 | 용도 | 예시 |
|------|------|------|
| `at` | 일회성 리마인더 | `--at "2026-02-01T16:00:00Z"` |
| `every` | 주기적 실행 | `--every "30m"` |
| `cron` | 정교한 스케줄 | `--cron "0 7 * * *"` (매일 7시) |

### Session Target (어디서 실행할지)

```typescript
export type CronSessionTarget = "main" | "isolated";
```

**Main 세션**
- 기존 대화 맥락을 유지
- System Event로 주입되어 Heartbeat에서 처리
- 가벼운 리마인더에 적합

**Isolated 세션**
- 독립적인 `cron:<jobId>` 세션에서 실행
- 매번 새로운 컨텍스트로 시작
- 무거운 작업, 외부 전달에 적합

### Payload (무엇을 실행할지)

```typescript
export type CronPayload =
  | { kind: "systemEvent"; text: string }  // Main 세션용
  | {
      kind: "agentTurn";                   // Isolated 세션용
      message: string;
      model?: string;          // 모델 오버라이드
      thinking?: string;       // 사고 수준
      deliver?: boolean;       // 외부 전달 여부
      channel?: CronMessageChannel;  // 전달 채널
      to?: string;             // 전달 대상
    };
```

## CronJob 전체 구조

```typescript
export type CronJob = {
  id: string;              // 고유 식별자
  agentId?: string;        // 멀티 에이전트 환경에서 에이전트 지정
  name: string;            // 작업 이름
  description?: string;    // 설명
  enabled: boolean;        // 활성화 상태
  deleteAfterRun?: boolean;  // 일회성 실행 후 삭제
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;  // 스케줄
  sessionTarget: CronSessionTarget;  // 세션 타입
  wakeMode: CronWakeMode;  // "now" | "next-heartbeat"
  payload: CronPayload;    // 실행 내용
  isolation?: CronIsolation;  // Isolated 세션 설정
  state: CronJobState;     // 실행 상태
};
```

## CronService 구현

### 서비스 클래스

```typescript
// src/cron/service.ts
export class CronService {
  private readonly state;

  constructor(deps: CronServiceDeps) {
    this.state = createCronServiceState(deps);
  }

  async start() { await ops.start(this.state); }
  stop() { ops.stop(this.state); }

  async status() { return await ops.status(this.state); }
  async list(opts?) { return await ops.list(this.state, opts); }
  async add(input: CronJobCreate) { return await ops.add(this.state, input); }
  async update(id: string, patch: CronJobPatch) { return await ops.update(this.state, id, patch); }
  async remove(id: string) { return await ops.remove(this.state, id); }
  async run(id: string, mode?: "due" | "force") { return await ops.run(this.state, id, mode); }

  wake(opts: { mode: "now" | "next-heartbeat"; text: string }) {
    return ops.wakeNow(this.state, opts);
  }
}
```

### 핵심 Operations

```typescript
// src/cron/service/ops.ts

// 서비스 시작
export async function start(state: CronServiceState) {
  await locked(state, async () => {
    if (!state.deps.cronEnabled) {
      state.deps.log.info({ enabled: false }, "cron: disabled");
      return;
    }
    await ensureLoaded(state);      // jobs.json 로드
    recomputeNextRuns(state);       // 다음 실행 시간 계산
    await persist(state);           // 저장
    armTimer(state);                // 타이머 설정
  });
}

// Job 추가
export async function add(state: CronServiceState, input: CronJobCreate) {
  return await locked(state, async () => {
    warnIfDisabled(state, "add");
    await ensureLoaded(state);

    const job = createJob(state, input);
    state.store?.jobs.push(job);

    await persist(state);
    armTimer(state);  // 새 job에 맞춰 타이머 재설정

    emit(state, {
      jobId: job.id,
      action: "added",
      nextRunAtMs: job.state.nextRunAtMs,
    });

    return job;
  });
}

// Job 실행
export async function run(state: CronServiceState, id: string, mode?: "due" | "force") {
  return await locked(state, async () => {
    const job = findJobOrThrow(state, id);
    const now = state.deps.nowMs();
    const due = isJobDue(job, now, { forced: mode === "force" });

    if (!due) {
      return { ok: true, ran: false, reason: "not-due" };
    }

    await executeJob(state, job, now, { forced: mode === "force" });
    await persist(state);
    armTimer(state);

    return { ok: true, ran: true };
  });
}
```

**핵심 패턴**:
- `locked()`: 동시성 제어를 위한 락
- `armTimer()`: 가장 빠른 job에 맞춰 타이머 재설정
- `emit()`: 이벤트 발생 (UI 등에서 구독 가능)

## 저장소 (Persistence)

```typescript
// src/cron/store.ts
export const DEFAULT_CRON_DIR = path.join(CONFIG_DIR, "cron");
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, "jobs.json");

// 로드
export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const parsed = JSON5.parse(raw);
    return {
      version: 1,
      jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { version: 1, jobs: [] };  // 파일 없으면 빈 상태
  }
}

// 저장 (Atomic Write)
export async function saveCronStore(storePath: string, store: CronStoreFile) {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });

  // 임시 파일에 먼저 쓰고 rename (원자적 쓰기)
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.promises.rename(tmp, storePath);

  // 백업
  await fs.promises.copyFile(storePath, `${storePath}.bak`);
}
```

**설계 포인트**:
- `~/.openclaw/cron/jobs.json`에 영구 저장
- Atomic Write로 데이터 손실 방지
- JSON5 지원으로 주석 허용

## Agent Tool로서의 Cron

AI 에이전트가 직접 Cron Job을 관리할 수 있습니다.

```typescript
// src/agents/tools/cron-tool.ts
export function createCronTool(opts?: CronToolOptions): AnyAgentTool {
  return {
    label: "Cron",
    name: "cron",
    description: `Manage Gateway cron jobs (status/list/add/update/remove/run/runs)...`,
    parameters: CronToolSchema,
    execute: async (_toolCallId, args) => {
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "status":
          return jsonResult(await callGatewayTool("cron.status", gatewayOpts, {}));
        case "list":
          return jsonResult(await callGatewayTool("cron.list", gatewayOpts, {...}));
        case "add":
          // job 생성 로직
          const job = normalizeCronJobCreate(params.job);
          return jsonResult(await callGatewayTool("cron.add", gatewayOpts, job));
        // ... 기타 actions
      }
    },
  };
}
```

**에이전트 대화 예시**:
```
사용자: 20분 후에 회의 시작한다고 알려줘

에이전트: (내부적으로 cron.add 툴 호출)
{
  "action": "add",
  "job": {
    "name": "회의 리마인더",
    "schedule": { "kind": "at", "atMs": 1738262400000 },
    "sessionTarget": "main",
    "wakeMode": "now",
    "payload": { "kind": "systemEvent", "text": "리마인더: 회의가 시작됩니다." },
    "deleteAfterRun": true
  }
}

에이전트: 20분 후에 회의 시작 알림을 설정했습니다!
```

## CLI 사용법

### 일회성 리마인더

```bash
openclaw cron add \
  --name "회의 리마인더" \
  --at "20m" \
  --session main \
  --system-event "회의가 10분 후 시작됩니다." \
  --wake now \
  --delete-after-run
```

### 매일 아침 브리핑 (Isolated)

```bash
openclaw cron add \
  --name "Morning briefing" \
  --cron "0 7 * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --message "오늘 일정과 중요 이메일을 요약해줘." \
  --model opus \
  --deliver \
  --channel slack \
  --to "channel:C1234567890"
```

### 관리 명령어

```bash
# 목록 조회
openclaw cron list

# 상태 확인
openclaw cron status

# 수동 실행
openclaw cron run <jobId> --force

# 실행 기록
openclaw cron runs --id <jobId>

# Job 수정
openclaw cron edit <jobId> --message "새로운 프롬프트"

# Job 삭제
openclaw cron remove <jobId>
```

## Heartbeat vs Cron: 언제 무엇을 쓸까?

| 상황 | 추천 | 이유 |
|------|------|------|
| 매 30분 이메일 확인 | Heartbeat | 다른 체크와 배치 가능 |
| 매일 9시 정각 보고서 | Cron (isolated) | 정확한 시간 필요 |
| 20분 후 리마인더 | Cron (main, at) | 일회성 + 정확한 시간 |
| 주간 딥 분석 | Cron (isolated) | 다른 모델 사용 가능 |
| 캘린더 이벤트 체크 | Heartbeat | 맥락 기반 판단 필요 |

**핵심 원칙**:
- **Heartbeat**: "주기적으로 확인해야 하는 것" (배치 가능)
- **Cron**: "정확한 시간에 실행해야 하는 것" (독립적)

## 설계 인사이트

### 1. Timer 재설정 패턴 (armTimer)
모든 Job 변경 시 가장 빠른 실행 시간에 맞춰 타이머를 재설정합니다. 이로써:
- 메모리 효율: 하나의 타이머만 사용
- 정확성: 항상 다음 실행 시간에 정확히 깨어남

### 2. Atomic Write
파일 저장 시 임시 파일 + rename으로 원자적 쓰기를 보장합니다.

### 3. Lock 기반 동시성 제어
`locked()` 함수로 모든 상태 변경을 직렬화하여 경쟁 조건을 방지합니다.

### 4. Main vs Isolated 분리
- Main: 대화 맥락 유지, 가벼운 리마인더
- Isolated: 독립 실행, 모델 오버라이드, 외부 전달

### 5. Tool로서의 Cron
에이전트가 자연어로 스케줄을 관리할 수 있어 사용자 경험이 크게 향상됩니다.

## 마치며

OpenClaw의 Cron 시스템은 단순한 타이머가 아닌, AI 에이전트를 위한 정교한 스케줄러입니다.

핵심 가치:
- **영속성**: Gateway 재시작에도 Job 유지
- **유연성**: 세 가지 스케줄 방식 + Main/Isolated 세션
- **통합성**: CLI, Tool Call, Gateway API 모두 지원
- **확장성**: 다중 채널 전달, 모델 오버라이드

이런 설계 덕분에 "매일 아침 브리핑 보내줘"라는 한 마디로 AI 에이전트가 자동화된 워크플로우를 구축할 수 있습니다.

---

**참고 자료**:
- [OpenClaw Cron Jobs 공식 문서](https://openclaw.dev/automation/cron-jobs)
- [Cron vs Heartbeat 가이드](https://openclaw.dev/automation/cron-vs-heartbeat)
