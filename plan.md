# Slack-Claude Gateway TDD 구현 계획

## Phase 1: 프로젝트 초기화
- [x] 1. package.json, tsconfig.json 생성
- [x] 2. 의존성 설치

## Phase 2: Config
- [x] 3. 환경변수 로드 테스트
- [x] 4. 필수 토큰 검증 테스트

## Phase 3: SessionManager
- [x] 5. 세션 생성 테스트
- [x] 6. 세션 조회 테스트
- [x] 7. TTL 만료 테스트

## Phase 4: Claude Parser
- [x] 8. JSON text 추출 테스트
- [x] 9. sessionId 추출 테스트

## Phase 5: ClaudeRunner
- [x] 10. CLI 인자 빌드 테스트
- [x] 11. spawn 실행 테스트

## Phase 6: Slack Handler
- [x] 12. 메시지 필터링 테스트
- [x] 13. 응답 전송 테스트

## Phase 7: 통합
- [x] 14. 전체 흐름 테스트
