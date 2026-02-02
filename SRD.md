# Claude Code로 하는 스펙 기반 개발 (Spec-Driven Development) 완전 가이드

> AI를 단독 코더가 아닌 "개발팀"처럼 활용하는 새로운 워크플로우

## 들어가며

Claude Code를 사용해본 개발자라면 한 번쯤 이런 경험이 있을 것입니다. 복잡한 리팩토링이나 마이그레이션 작업을 Claude에게 맡겼는데, 컨텍스트가 꽉 차버리거나 중간에 세션이 끊기면 처음부터 다시 설명해야 하는 상황 말입니다.

오늘 소개할 **스펙 기반 개발(Spec-Driven Development)**은 이런 문제를 해결하는 체계적인 워크플로우입니다. 핵심 아이디어는 간단합니다. Claude를 혼자 일하는 코더가 아니라, **나는 프로덕트 오너, Claude는 테크 리드, 서브에이전트들은 개발자**인 팀처럼 활용하는 것입니다.

이 글에서는 SQLite/WASM 스토리지를 IndexedDB로 마이그레이션하는 실제 사례를 통해, 어떻게 하루 만에 15개 이상의 파일을 수정하는 대규모 리팩토링을 완료할 수 있었는지 상세히 설명합니다.

---

## 문제 상황: 왜 스펙 기반 개발이 필요한가?

### 기존 AI 코딩의 한계

전통적인 AI 코딩 워크플로우는 다음과 같은 패턴을 따릅니다:

```
프롬프트 → 코드 작성 → 디버깅 → 반복...
```

이 방식의 문제점은 명확합니다:

1. **컨텍스트 오염**: 실패한 시도들이 컨텍스트 윈도우를 채워 점점 성능이 저하됩니다
2. **세션 간 기억 손실**: 새 세션을 시작하면 모든 진행 상황을 잃어버립니다
3. **버그 추적 불가**: 발견된 버그가 제대로 추적되지 않고 잊혀집니다
4. **완료 기준 부재**: 언제 작업이 끝났는지 명확하지 않습니다

### 실제 사례: SQLite에서 IndexedDB로

저자(Alex)는 Nuxt 4로 동기화 엔진을 구축하고 있었습니다. 기존에는 `sql.js`(WASM으로 컴파일된 SQLite)를 클라이언트 스토리지로 사용했는데, 몇 가지 문제가 있었습니다:

- 대용량 WASM 번들 (~1MB)
- 복잡한 COOP/COEP 헤더 요구사항
- 네이티브 크로스탭 동기화 미지원

[Jazz](https://jazz.tools)라는 local-first 프레임워크의 패턴을 참고해 IndexedDB로 마이그레이션하고 싶었지만, 이는 15개 이상의 파일을 수정해야 하는 대규모 리팩토링이었습니다.

---

## 스펙 기반 개발 워크플로우: 4단계 프로세스

스펙 기반 개발은 다음 4단계로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                    스펙 기반 개발 워크플로우                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Phase 1          Phase 2          Phase 3          Phase 4   │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐│
│  │ Research│  →   │  Spec   │  →   │ Refine  │  →   │Implement││
│  │         │      │Creation │      │         │      │         ││
│  └─────────┘      └─────────┘      └─────────┘      └─────────┘│
│       │                │                │                │     │
│  병렬 서브           문서 작성        Q&A 인터뷰       태스크별   │
│  에이전트           (Spec.md)          패턴         서브에이전트 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

이제 각 단계를 자세히 살펴보겠습니다.

---

## Phase 1: 병렬 리서치 (Research with Parallel Subagents)

### 사용 프롬프트

```
you have access to jazz source repo explain to me how they use
indexdb in the client to persist state our project is using sqlite
but we want to change to indexdb with jazz your goal is to write
a report spin up multiple subagents for your research task
```

**핵심 키워드**: `spin up multiple subagents for your research task`

이 프롬프트를 사용하면 Claude가 병렬로 여러 리서치 에이전트를 생성합니다.

### 실행 결과

Claude는 5개의 병렬 리서치 에이전트를 생성해 각각 독립적으로 Jazz 코드베이스를 조사했습니다:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Research Phase 구조                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐│
│   │  CRDT   │  │WebSocket│  │Push/Pull│  │ Storage │  │  Arch  ││
│   │  Agent  │  │  Agent  │  │  Agent  │  │  Agent  │  │ Agent  ││
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └───┬────┘│
│        │            │            │            │            │     │
│        └────────────┴─────┬──────┴────────────┴────────────┘     │
│                           │                                      │
│                           ▼                                      │
│                 ┌─────────────────────┐                          │
│                 │ 통합 리서치 리포트  │                          │
│                 └─────────────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 에이전트별 조사 결과

| 에이전트 | 조사 영역 | 주요 발견 사항 |
|---------|----------|--------------|
| **CRDT** | 데이터 구조 | CoMap, CoList가 LWW 기반 operation-based CRDT 사용 |
| **WebSocket** | 실시간 동기화 | 4-메시지 프로토콜: load, known, content, done |
| **Push/Pull** | 동기화 전략 | known-state 추적이 있는 하이브리드 모델 |
| **Storage** | 영속성 | IndexedDB에 `coValues`, `sessions`, `transactions` 스토어 |
| **Architecture** | 전체 설계 | 플랫폼 어댑터가 있는 모노레포 구조 |

### 추가 리서치 프롬프트

```
research longer and improve the plan
```

이 후속 프롬프트로 엣지 케이스와 구현 세부사항을 더 깊이 조사하도록 지시합니다.

**팁**: Jazz 같은 참조 코드베이스가 있다면, 프로젝트에 소스 코드를 클론해두면 Claude가 리서치 중에 직접 참조할 수 있습니다.

---

## Phase 2: 스펙 문서 작성 (Spec Creation)

### 리서치 결과물: 기술 명세서

리서치가 완료되면 Claude가 포괄적인 기술 명세서를 `docs/indexeddb-migration-spec.md`에 작성합니다.

### 스펙 문서 구조 예시

```markdown
# IndexedDB 마이그레이션 명세서

## Part 1: Jazz의 IndexedDB 사용 방식
- 데이터베이스 스키마 (coValues, sessions, transactions 스토어)
- 트랜잭션 큐잉 패턴
- 엔티티 캐싱 레이어
- 세션 기반 충돌 해결

## Part 2: 현재 SQLite 아키텍처 분석
- sql.js WASM 설정
- 기존 동기화 프로토콜
- 문제점 및 한계

## Part 3: 마이그레이션 계획 (4 Phases)
- Phase 1: 핵심 IndexedDB 유틸리티
- Phase 2: Composables 레이어
- Phase 3: 크로스탭 동기화
- Phase 4: 정리 및 테스트

## Part 4: 구현 체크리스트
- [ ] idb-helpers.ts
- [ ] useIndexedDB.ts
- [ ] useSessionTracking.ts
- ... (총 14개 항목)
```

### 스펙이 중요한 이유

**스펙 문서는 진실의 원천(Source of Truth)이 됩니다.**

1. **구현 중 일관성 유지**: Claude가 각 태스크 수행 시 스펙을 참조해 일관된 구현 보장
2. **복구 지점 역할**: 세션이 꼬이거나 컨텍스트가 오염되면 스펙을 Pin해서 새 세션에서 즉시 복구 가능
3. **명확한 완료 기준**: 체크리스트로 무엇이 완료되었고 무엇이 남았는지 명확

---

## Phase 3: 스펙 개선 (Spec Refinement via Interview)

### 구현 전 Q&A 인터뷰

구현에 들어가기 전, 스펙이 충분히 견고한지 확인하는 과정입니다.

### 사용 프롬프트

```
use the ask_user_question tool do you have any questions regarding
@docs/indexeddb-migration-spec.md before we implement it we want
to improve the specs
```

**핵심 키워드**: `use the ask_user_question tool`

### Claude의 질문 예시

Claude가 `AskUserQuestion` 도구를 사용해 명확화 질문을 합니다:

- "기존 SQLite 데이터에서 마이그레이션을 지원해야 하나요?"
- "선호하는 충돌 해결 전략은 무엇인가요?"
- "크로스탭 동기화에 BroadcastChannel을 사용할까요, SharedWorker를 사용할까요?"

### 추가 개선 요청

답변 후, 특정 기술 스택에 맞는 패턴 연구를 추가로 요청할 수 있습니다:

```
we want to use provide and inject you have access to the source
code of pinia spin up multiple subagents how they do it so we can
use same patterns
```

이 프롬프트로 Pinia의 패턴을 연구해 스펙에 다음을 추가했습니다:

- Symbol 기반 인젝션 키
- 폴백 패턴이 있는 Provider composables
- unmount 시 적절한 정리(cleanup)

---

## Phase 4: 태스크 위임 구현 (Implementation with Task Delegation)

### Claude Code의 Task 시스템 이해하기

Claude Code의 태스크 시스템은 [Beads](https://github.com/beads-ai/beads)(Steve Yegge의 분산 git 기반 이슈 트래커)에서 영감을 받았습니다. 이 시스템은 AI 코딩 에이전트의 두 가지 중요한 문제를 해결합니다:

**1. Agent Amnesia (에이전트 기억상실)**
- 태스크 중간에 새 세션을 시작하면 수동으로 남은 작업을 기록하지 않는 한 모든 진행 상황을 잃어버림

**2. Context Pollution (컨텍스트 오염)**
- 컨텍스트 윈도우가 가득 차면 에이전트가 발견한 버그를 추적하지 않고 드롭함

### 태스크 영속화 방식

태스크는 `.claude/tasks/{session-id}/`에 JSON 파일로 저장됩니다:

```json
{
  "id": "task-1",
  "subject": "Create idb-helpers.ts",
  "description": "IndexedDB promise wrapper 구현...",
  "status": "pending | in_progress | completed",
  "blocks": ["task-3", "task-4"],
  "blockedBy": ["task-0"]
}
```

### 4가지 태스크 도구

| 도구 | 용도 |
|-----|-----|
| `TaskCreate` | subject, description, 의존성으로 새 태스크 생성 |
| `TaskUpdate` | 상태 업데이트 (pending → in_progress → completed) 또는 의존성 수정 |
| `TaskList` | 모든 태스크, 상태, 블로킹 관계 조회 |
| `TaskGet` | description 포함 특정 태스크 상세 정보 조회 |

### 구현 프롬프트

```
implement @docs/indexeddb-migration-spec.md use the task tool and
each task should only be done by a subagent so that context is
clear after each task do a commit before you continue you are the
main agent and your subagents are your devs
```

**핵심 키워드들**:
- `use the task tool` - 태스크 시스템 활성화
- `each task should only be done by a subagent` - 서브에이전트 위임
- `after each task do a commit` - 원자적 커밋
- `you are the main agent and your subagents are your devs` - 역할 할당

### 실행 흐름

```
┌──────────────────────────────────────────────────────────────────┐
│                    태스크 오케스트레이션 흐름                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Main Agent                                                      │
│  (Orchestrator)                                                  │
│       │                                                          │
│       ▼                                                          │
│  TaskCreate ──────────────────────────────────────┐              │
│       │                                           │              │
│       ▼                                           ▼              │
│  ┌──────────────┐                        .claude/tasks/          │
│  │ Subagent #1  │   ◄────── 태스크 읽기 ──────  task-1.json      │
│  │ (fresh ctx)  │                                                │
│  └──────┬───────┘                                                │
│         │                                                        │
│         │ 구현 완료 & 반환                                        │
│         ▼                                                        │
│  TaskUpdate (status: completed)                                  │
│       │                                                          │
│       ▼                                                          │
│  git commit -m "feat: task-1 complete"                           │
│       │                                                          │
│       ▼                                                          │
│  TaskCreate (다음 태스크)                                         │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────┐                                                │
│  │ Subagent #2  │   ◄────── 새로운 컨텍스트                      │
│  │ (fresh ctx)  │                                                │
│  └──────────────┘                                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 의존성 기반 병렬 실행

```
┌──────────────────────────────────────────────────────────────────┐
│                    태스크 의존성 그래프                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Wave 1 (병렬 실행 가능)                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                           │
│  │ Task 1  │  │ Task 2  │  │ Task 3  │                           │
│  │ (core)  │  │ (types) │  │ (utils) │                           │
│  └────┬────┘  └────┬────┘  └────┬────┘                           │
│       │            │            │                                │
│       └────────────┼────────────┘                                │
│                    │                                             │
│  Wave 2 (Wave 1 완료 후)                                          │
│                    ▼                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                           │
│  │ Task 4  │  │ Task 5  │  │ Task 6  │                           │
│  │(compose)│  │ (hook)  │  │ (sync)  │                           │
│  └────┬────┘  └────┬────┘  └────┬────┘                           │
│       │            │            │                                │
│       └────────────┼────────────┘                                │
│                    │                                             │
│  Wave 3 (Wave 2 완료 후)                                          │
│                    ▼                                             │
│              ┌─────────┐                                         │
│              │ Task 7  │                                         │
│              │(integr.)│                                         │
│              └─────────┘                                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 서브에이전트 + 태스크 = 컨텍스트 효율성

### 이 패턴이 효과적인 이유

1. **컨텍스트 격리**: 각 서브에이전트가 새로운 컨텍스트로 시작해 필요한 것만 읽음 - 누적된 찌꺼기 없음
2. **영속적 진행**: 태스크가 세션 재시작에도 살아남음 - 중단된 곳에서 재개 가능
3. **의존성 인식 병렬화**: Claude가 어떤 태스크를 동시에 실행할 수 있는지 식별
4. **원자적 커밋**: 모든 태스크 = 하나의 커밋 - 롤백이 쉬움
5. **스펙을 계약서로**: 서브에이전트들이 스펙을 참조해 일관성 보장

### Backpressure: 시스템이 실수를 잡게 하기

원자적 커밋을 강력하게 만드는 핵심 요소가 있습니다: **백프레셔(Backpressure)**

모든 변경사항을 수동으로 검토하는 대신, pre-commit 훅으로 테스트, 린팅, 타입 체크를 자동으로 실행하세요:

```bash
# .husky/pre-commit
pnpm typecheck && pnpm lint && pnpm test-run
```

서브에이전트가 커밋하면 훅이 즉시 실행됩니다. 테스트가 실패하면 커밋이 거부되고 에이전트가 에러 출력을 보게 됩니다 - 다음 태스크로 넘어가기 전에 자체 수정할 기회를 얻는 것입니다.

**결과**: 품질 관리의 병목이 되는 것을 멈추게 됩니다. 시스템이 정확성을 검증하는 동안 여러분은 더 높은 수준의 결정에 집중할 수 있습니다.

---

## 문제가 생겼을 때: 스펙의 복구 지점 역할

첫 번째 실행이 완벽하지 않았습니다 - 프로젝트를 시작했는데 몇 가지 에러가 발생했습니다.

하지만 여기서 스펙이 빛을 발합니다:

1. **새 채팅을 열고**
2. **스펙 문서를 Pin하고**
3. **에러를 붙여넣으면**
4. **Claude가 즉시 수정합니다**

컨텍스트를 재구축하거나 아키텍처를 다시 설명할 필요가 없습니다. 스펙이 전체 의도와 설계 결정을 캡처한 문서로서 복구 지점 역할을 합니다.

---

## 실행 결과

약 45분 후:

```bash
$ git log --oneline | head -20

9dc1c96 refactor: clean up code structure
9fce16b feat(storage): migrate from SQLite to IndexedDB
835c494 feat: integrate IDB sync engine provider
d2cd7b7 refactor: remove SQLite/sql.js dependencies
2fb7656 feat: add browser mode test stubs
... (총 14개 커밋)
```

**최종 결과**:
- ✅ 14개 태스크 완료
- ✅ 14개 커밋
- ✅ 15개 이상 파일 수정
- ✅ 리뷰 준비된 PR 1개

### 컨텍스트 사용량

14개의 서브에이전트를 오케스트레이션했음에도 메인 세션의 컨텍스트는 관리 가능한 수준으로 유지되었습니다:

```
Context Usage 71%

claude-opus-4-5-20251101 143k / 200k tokens

System prompt     2.8k  (1.4%)
System tools     16.2k  (8.1%)
MCP tools          293  (0.1%)
Custom agents      641  (0.3%)
Memory files       431  (0.2%)
Skills           1.6k   (0.8%)
Messages       122.9k  (61.4%)
Free space       22k  (11.1%)
Autocompact buffer 33.0k (16.5%)
```

이것이 위임 패턴의 효과를 증명합니다 - 메인 에이전트가 오케스트레이션을 담당하는 동안 서브에이전트들이 격리된 컨텍스트에서 실제 작업을 수행했습니다.

---

## 핵심 프롬프트 패턴 정리

### 1. 병렬 리서치

```
spin up multiple subagents for your research task
```

Claude가 각각 독립적으로 조사하는 병렬 에이전트를 생성하도록 트리거합니다. 순차 리서치보다 훨씬 빠릅니다.

### 2. 스펙 우선 개발

```
your goal is to write a report/document
```

코드 전에 작성된 아티팩트를 생성하도록 강제합니다. 이것이 진실의 원천이 됩니다.

### 3. 구현 전 인터뷰

```
use the ask_user_question tool… before we implement
```

버그가 되기 전에 모호함과 설계 결정을 표면화합니다.

### 4. 커밋과 함께 태스크 위임

```
use the task tool and each task should only be done by a subagent
after each task do a commit before you continue
```

원자적 커밋과 함께 오케스트레이션 패턴을 생성합니다.

### 5. 역할 할당

```
you are the main agent and your subagents are your devs
```

Claude가 어떻게 행동해야 하는지 기대치를 설정합니다 - 솔로 구현자가 아닌 조정자로서.

---

## 전통적 방식 vs 스펙 기반 개발 비교

| 항목 | 전통적 AI 코딩 | 스펙 기반 개발 |
|-----|--------------|--------------|
| **흐름** | 프롬프트 → 코드 → 디버그 → 반복 | 리서치 → 스펙 → 개선 → 태스크 → 완료 |
| **컨텍스트** | 실패한 시도로 가득 참 | 각 태스크가 새 컨텍스트 획득 |
| **메모리** | 세션 간 영속성 없음 | 스펙이 영속적 진실의 원천 |
| **버그 추적** | 늦게 발견되고 잊혀짐 | 버그가 새 태스크가 됨 |
| **완료** | 명확한 종료 지점 없음 | 명확한 완료 기준 |

---

## 고급: 멀티 세션 워크플로우

태스크 시스템은 여러 Claude Code 세션 간 조정을 지원합니다.

### 공유 태스크 목록 ID 설정

```bash
CLAUDE_CODE_TASK_LIST_ID=myproject claude
```

또는 `.claude/settings.json`에 추가:

```json
{
  "env": {
    "CLAUDE_CODE_TASK_LIST_ID": "myproject"
  }
}
```

한 세션은 **오케스트레이터**로, 다른 세션은 **체커**로 작동하여 완료된 태스크를 모니터링하고, 구현 품질을 검증하고, 누락된 것에 대한 후속 태스크를 추가할 수 있습니다.

---

## 더 큰 프로젝트를 위한 대안: Ralph

며칠이나 몇 주에 걸친 정말 대규모 프로젝트의 경우, [Ralph](https://ghuntley.com/ralph) 같은 완전 자율 에이전트가 더 적합합니다.

Ralph는 우아하게 단순합니다 - 마크다운 파일을 Claude Code에 반복적으로 공급하는 bash 루프:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

핵심 차이점: Ralph는 각 반복을 완전히 새로운 Claude 세션에서 실행하며, 마크다운 파일만을 유일한 영속적 메모리로 사용합니다. 이로 인해 진정한 무상태(stateless)가 되어 며칠 동안 실행할 수 있습니다.

스펙 기반 접근 방식은 중간 지점을 차지합니다: 서브에이전트는 새 컨텍스트를 얻지만 메인 오케스트레이터는 단일 세션 내에서 상태를 유지합니다. 일관성을 유지하기에 충분히 구조화되어 있고, 복잡성을 처리하기에 충분히 유연하며, 완전 자율 시스템의 설정 오버헤드가 없습니다.

---

## 이 워크플로우를 사용해야 할 때

### 적합한 경우

- **대규모 리팩토링**: 많은 파일을 건드리는 작업
- **마이그레이션**: 외부 코드베이스 리서치가 필요한 작업
- **기능 구현**: 요구사항이 불명확한 작업
- **새 라이브러리 학습**: 소스 코드를 분석해서 배우는 작업

### 과한 경우

- 작은 버그 수정
- 단일 파일 변경
- 잘 정의된 단순한 기능

---

## 필요한 도구

1. **Claude Code CLI** (태스크 도구가 있는 최신 버전)
2. **스펙 문서** (마크다운 추천)
3. **참조 코드베이스** (기존 구현에서 배우는 경우)
4. **Git** (원자적 커밋용)

---

## 더 읽을거리

- [Beads](https://github.com/beads-ai/beads) - 태스크 시스템에 영감을 준 Steve Yegge의 git 기반 이슈 트래커
- [12 Factor Agents](https://12factor.net/agents) - AI 코딩 에이전트 설계 원칙
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) - Anthropic의 에이전트 아키텍처 연구

---

## 결론

스펙 기반 개발은 실제 엔지니어링 워크플로우를 반영합니다: 병렬 작업, 핸드오프, 블로커, 의존성. Claude를 솔로 코더로 취급하는 대신 팀으로 취급하는 것입니다.

Beads의 핵심 통찰이 여기에도 적용됩니다:

> "코딩 에이전트에게 주는 각 태스크를 자체 컨텍스트 윈도우에 격리함으로써, 이제 나중을 위해 버그를 로깅하는 능력을 부여할 수 있습니다."

SQLite에서 IndexedDB로의 마이그레이션은 수동으로 했다면 2-3일이 걸렸을 것입니다. 이 워크플로우로 한 오후 만에 완료했고 - 리서치 단계에서 Jazz의 패턴을 발견했기 때문에 더 나은 코드를 생산했습니다.

---

**직접 시도해보세요**: 다음 중요한 기능을 "X에 대한 스펙을 작성하고, 리서치를 위해 서브에이전트를 생성해"로 시작하고 워크플로우가 어떻게 바뀌는지 확인해보세요.

---

*원문: [Spec-Driven Development with Claude Code in Action](https://alexop.dev/posts/spec-driven-development-claude-code-in-action/) by Alex Opalic (2026.02.01)*