import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import type {
  Project,
  TestScenario,
  TestRun,
  CommandResult,
  TestCommand,
} from '../types'
import './TestPage.css'

interface TestPageProps {
  projects: Project[]
  sendRpc: <T>(method: string, params?: unknown) => Promise<T>
  subscribeToEvent: (event: string, callback: (data: unknown) => void) => () => void
}

type ViewMode = 'list' | 'edit' | 'run'

// AI 채팅 메시지 타입
interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  yaml?: string  // AI가 생성한 YAML
}

// 샘플 YAML
const SAMPLE_YAML = `# 테스트 시나리오 설정
url: https://www.google.com
timeout: 10000
retryCount: 3
screenshotOnFailure: true
---
# 검색 테스트
- waitForElement: "input[name='q']"
- click: "input[name='q']"
- type: "Hello World"
- pressKey: Enter
- wait: 2000
- assertVisible: "#search"
- screenshot: search-results
`

// 명령어 설명 함수 (export하여 나중에 다른 곳에서 사용 가능)
export function getCommandDescription(cmd: TestCommand): string {
  switch (cmd.command) {
    case 'navigate': return `Navigate to ${cmd.url}`
    case 'back': return 'Go back'
    case 'forward': return 'Go forward'
    case 'reload': return 'Reload page'
    case 'click': return cmd.text ? `Click "${cmd.text}"` : cmd.selector ? `Click ${cmd.selector}` : `Click at (${cmd.x}, ${cmd.y})`
    case 'type': {
      const text = String(cmd.text || '')
      return `Type "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`
    }
    case 'clear': return `Clear ${cmd.selector}`
    case 'pressKey': return `Press ${cmd.key}`
    case 'scroll': return `Scroll ${cmd.direction || 'down'}`
    case 'scrollTo': return `Scroll to ${cmd.selector}`
    case 'wait': return `Wait ${cmd.ms}ms`
    case 'waitForElement': return cmd.text ? `Wait for "${cmd.text}"` : `Wait for ${cmd.selector}`
    case 'assertVisible': return cmd.text ? `Assert "${cmd.text}" visible` : `Assert ${cmd.selector} visible`
    case 'assertNotVisible': return cmd.text ? `Assert "${cmd.text}" not visible` : `Assert ${cmd.selector} not visible`
    case 'assertText': return `Assert text "${cmd.expected}"`
    case 'assertUrl': return `Assert URL matches "${cmd.pattern}"`
    case 'assertTitle': return `Assert title matches "${cmd.pattern}"`
    case 'assertExists': return `Assert ${cmd.selector} exists`
    case 'screenshot': return cmd.name ? `Screenshot "${cmd.name}"` : 'Take screenshot'
    case 'log': return `Log: ${cmd.message}`
    default: return cmd.command
  }
}

export function TestPage({ projects, sendRpc, subscribeToEvent }: TestPageProps) {
  const { projectId } = useParams<{ projectId: string }>()
  const project = projects.find((p) => p.id === projectId)

  const [scenarios, setScenarios] = useState<TestScenario[]>([])
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 시나리오 편집 상태
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editYaml, setEditYaml] = useState('')

  // 테스트 실행 상태
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null)
  const [commandResults, setCommandResults] = useState<Map<number, CommandResult>>(new Map())
  const [currentCommandIndex, setCurrentCommandIndex] = useState<number>(-1)
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [totalCommands, setTotalCommands] = useState(0)

  // AI 채팅 상태
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 시나리오 목록 로드
  const loadScenarios = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const list = await sendRpc<TestScenario[]>('test.scenario.list', { projectId })
      setScenarios(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }, [projectId, sendRpc])

  useEffect(() => {
    loadScenarios()
  }, [loadScenarios])

  // 테스트 이벤트 구독
  useEffect(() => {
    const unsubscribes = [
      subscribeToEvent('test.run.start', (data) => {
        const event = data as { runId: string; totalCommands: number }
        setTotalCommands(event.totalCommands)
      }),
      subscribeToEvent('test.command.start', (data) => {
        const event = data as { index: number; command: TestCommand }
        setCurrentCommandIndex(event.index)
      }),
      subscribeToEvent('test.command.screenshot', (data) => {
        const event = data as { screenshot: string }
        setCurrentScreenshot(event.screenshot)
      }),
      subscribeToEvent('test.command.retry', (data) => {
        const event = data as { index: number; attempt: number; error: string }
        console.log('[Test] Retry:', event)
      }),
      subscribeToEvent('test.command.complete', (data) => {
        const event = data as { index: number; result: CommandResult }
        setCommandResults((prev) => new Map(prev).set(event.index, event.result))
        // 스크린샷이 있으면 업데이트
        if (event.result.screenshot) {
          setCurrentScreenshot(event.result.screenshot)
        }
      }),
      subscribeToEvent('test.run.complete', (data) => {
        const event = data as { result: TestRun }
        setCurrentRun(event.result)
        setIsRunning(false)
        setCurrentCommandIndex(-1)
      }),
      subscribeToEvent('test.run.error', (data) => {
        const event = data as { runId: string; error: string }
        setError(event.error)
        setIsRunning(false)
      }),
    ]

    return () => {
      unsubscribes.forEach((unsub) => unsub())
    }
  }, [subscribeToEvent])

  // 시나리오 선택
  const selectScenario = (scenario: TestScenario) => {
    setSelectedScenario(scenario)
    setViewMode('list')
    resetEditState(scenario)
    resetRunState()
  }

  const resetEditState = (scenario?: TestScenario) => {
    setEditName(scenario?.name ?? '')
    setEditDescription(scenario?.description ?? '')
    setEditYaml(scenario?.yaml ?? SAMPLE_YAML)
  }

  const resetRunState = () => {
    setCommandResults(new Map())
    setCurrentScreenshot(null)
    setCurrentRun(null)
    setCurrentCommandIndex(-1)
    setIsRunning(false)
    setTotalCommands(0)
  }

  // 새 시나리오 생성
  const createNewScenario = () => {
    setSelectedScenario(null)
    setViewMode('edit')
    resetEditState()
    resetRunState()
    // AI 채팅 초기화
    setAiMessages([{
      id: 'welcome',
      role: 'assistant',
      content: '안녕하세요! 테스트 시나리오 작성을 도와드리겠습니다.\n\n자연어로 원하는 테스트를 설명해 주세요. 예:\n- "구글에서 검색하는 테스트 만들어줘"\n- "로그인 페이지에서 아이디 비밀번호 입력 후 로그인 버튼 클릭"\n- "네이버 메인 페이지 스크린샷 찍어줘"',
      timestamp: Date.now(),
    }])
  }

  // AI 채팅 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages])

  // AI에게 메시지 전송
  const sendAiMessage = async () => {
    if (!aiInput.trim() || isAiLoading) return

    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: aiInput.trim(),
      timestamp: Date.now(),
    }

    setAiMessages(prev => [...prev, userMessage])
    setAiInput('')
    setIsAiLoading(true)

    try {
      // 기존 YAML 컨텍스트와 함께 AI에 요청
      const response = await sendRpc<{ message: string; yaml?: string }>('ai.generate.yaml', {
        projectId,
        prompt: userMessage.content,
        currentYaml: editYaml !== SAMPLE_YAML ? editYaml : undefined,
      })

      const assistantMessage: AiChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
        yaml: response.yaml,
      }

      setAiMessages(prev => [...prev, assistantMessage])

      // YAML이 있으면 에디터에 적용
      if (response.yaml) {
        setEditYaml(response.yaml)
      }
    } catch (err) {
      const errorMessage: AiChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
        timestamp: Date.now(),
      }
      setAiMessages(prev => [...prev, errorMessage])
    } finally {
      setIsAiLoading(false)
    }
  }

  // 시나리오 저장
  const saveScenario = async () => {
    if (!projectId || !editName.trim() || !editYaml.trim()) {
      setError('이름과 YAML은 필수입니다')
      return
    }

    setLoading(true)
    try {
      if (selectedScenario) {
        const updated = await sendRpc<TestScenario>('test.scenario.update', {
          id: selectedScenario.id,
          name: editName.trim(),
          description: editDescription.trim(),
          yaml: editYaml,
        })
        setSelectedScenario(updated)
      } else {
        const created = await sendRpc<TestScenario>('test.scenario.create', {
          projectId,
          name: editName.trim(),
          description: editDescription.trim(),
          yaml: editYaml,
        })
        setSelectedScenario(created)
      }

      setViewMode('list')
      await loadScenarios()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scenario')
    } finally {
      setLoading(false)
    }
  }

  // 시나리오 삭제
  const deleteScenario = async () => {
    if (!selectedScenario) return
    if (!confirm('정말 삭제하시겠습니까?')) return

    setLoading(true)
    try {
      await sendRpc('test.scenario.delete', { id: selectedScenario.id })
      setSelectedScenario(null)
      setViewMode('list')
      await loadScenarios()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scenario')
    } finally {
      setLoading(false)
    }
  }

  // 테스트 실행
  const runTest = async () => {
    if (!selectedScenario) return

    setViewMode('run')
    resetRunState()
    setIsRunning(true)
    setError(null)

    try {
      const run = await sendRpc<TestRun>('test.run.start', {
        scenarioId: selectedScenario.id,
      })
      setCurrentRun(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test')
      setIsRunning(false)
    }
  }

  // 테스트 중단
  const stopTest = async () => {
    if (!currentRun) return
    try {
      await sendRpc('test.run.stop', { runId: currentRun.id })
    } catch (err) {
      console.error('Failed to stop test:', err)
    }
  }

  // 명령어 상태 아이콘 반환
  const getCommandIcon = (index: number) => {
    const result = commandResults.get(index)

    if (currentCommandIndex === index && isRunning) {
      return <span className="step-icon running">⟳</span>
    }

    if (result) {
      if (result.status === 'passed') {
        return <span className="step-icon passed">✓</span>
      }
      if (result.status === 'failed') {
        return <span className="step-icon failed">✗</span>
      }
      if (result.status === 'skipped') {
        return <span className="step-icon skipped">○</span>
      }
      if (result.status === 'warned') {
        return <span className="step-icon warned">!</span>
      }
    }

    // 아직 실행 안됨
    return <span className="step-icon pending">{index + 1}</span>
  }

  // YAML에서 명령어 라인 파싱 (간단한 표시용)
  const parseYamlLines = (yaml: string) => {
    const lines = yaml.split('\n')
    const result: { lineNum: number; text: string; isCommand: boolean; isHeader: boolean }[] = []
    let inHeader = true

    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed === '---') {
        inHeader = false
        result.push({ lineNum: i + 1, text: line, isCommand: false, isHeader: false })
      } else if (trimmed.startsWith('-')) {
        result.push({ lineNum: i + 1, text: line, isCommand: true, isHeader: false })
      } else {
        result.push({ lineNum: i + 1, text: line, isCommand: false, isHeader: inHeader })
      }
    })
    return result
  }

  if (!projectId || !project) {
    return <div className="test-page empty">프로젝트를 선택해주세요</div>
  }

  // 실행 모드 UI (Maestro 스타일)
  if (viewMode === 'run' && selectedScenario) {
    const yamlLines = parseYamlLines(selectedScenario.yaml)
    let commandIndex = 0

    return (
      <div className="test-page run-mode">
        {/* 에러 표시 */}
        {error && (
          <div className="test-error">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* 좌측: 스크린샷 */}
        <div className="run-screenshot-panel">
          <div className="screenshot-header">
            <button className="btn-back" onClick={() => setViewMode('list')}>
              ← 뒤로
            </button>
            <span className="scenario-title">{selectedScenario.name}</span>
            {isRunning && (
              <button className="btn-stop" onClick={stopTest}>
                ■ 중지
              </button>
            )}
          </div>
          <div className="screenshot-container">
            {currentScreenshot ? (
              <img
                src={`data:image/png;base64,${currentScreenshot}`}
                alt="Browser Screenshot"
                className="live-screenshot"
              />
            ) : (
              <div className="screenshot-placeholder">
                {isRunning ? '스크린샷 로딩 중...' : '테스트를 실행하면 스크린샷이 표시됩니다'}
              </div>
            )}
          </div>
        </div>

        {/* 우측: YAML 코드 뷰 */}
        <div className="run-steps-panel">
          <div className="steps-header">
            <div className="file-tab">
              <span className="file-name">{selectedScenario.name}.yaml</span>
              {isRunning ? (
                <span className="status-badge running">
                  Running {totalCommands > 0 && `(${currentCommandIndex + 1}/${totalCommands})`}
                </span>
              ) : currentRun?.status === 'passed' ? (
                <span className="status-badge passed">Passed</span>
              ) : currentRun?.status === 'failed' ? (
                <span className="status-badge failed">Failed</span>
              ) : currentRun?.status === 'stopped' ? (
                <span className="status-badge stopped">Stopped</span>
              ) : null}
            </div>
          </div>

          <div className="steps-code">
            {yamlLines.map((line) => {
              const isCommand = line.isCommand
              let thisCommandIndex = -1
              if (isCommand) {
                thisCommandIndex = commandIndex
                commandIndex++
              }

              const result = thisCommandIndex >= 0 ? commandResults.get(thisCommandIndex) : undefined
              const isCurrent = thisCommandIndex >= 0 && currentCommandIndex === thisCommandIndex && isRunning

              return (
                <div
                  key={line.lineNum}
                  className={`code-line ${
                    result?.status === 'passed' ? 'passed' :
                    result?.status === 'failed' ? 'failed' :
                    result?.status === 'skipped' ? 'skipped' :
                    result?.status === 'warned' ? 'warned' :
                    isCurrent ? 'running' :
                    line.isHeader ? 'header' : ''
                  }`}
                >
                  {isCommand && getCommandIcon(thisCommandIndex)}
                  <span className="line-number">{line.lineNum}</span>
                  <span className="code-content">{line.text || ' '}</span>
                  {result?.error && (
                    <div className="step-error-tooltip">{result.error}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 실행 결과 요약 */}
          {currentRun && !isRunning && (
            <div className={`run-summary ${currentRun.status}`}>
              <div className="summary-title">
                {currentRun.status === 'passed' ? '✓ 테스트 통과' :
                 currentRun.status === 'failed' ? '✗ 테스트 실패' :
                 currentRun.status === 'stopped' ? '■ 테스트 중단' :
                 '테스트 완료'}
              </div>
              {currentRun.summary && (
                <div className="summary-stats">
                  <span className="stat passed">{currentRun.summary.passed} 성공</span>
                  <span className="stat failed">{currentRun.summary.failed} 실패</span>
                  <span className="stat skipped">{currentRun.summary.skipped} 스킵</span>
                  {currentRun.summary.warned > 0 && (
                    <span className="stat warned">{currentRun.summary.warned} 경고</span>
                  )}
                </div>
              )}
              {currentRun.duration && (
                <div className="summary-duration">
                  소요 시간: {(currentRun.duration / 1000).toFixed(1)}초
                </div>
              )}
              {currentRun.error && (
                <div className="summary-error">{currentRun.error}</div>
              )}
              <button className="btn-rerun" onClick={runTest}>
                ▶ 다시 실행
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 기본 UI (목록/편집)
  return (
    <div className="test-page">
      {/* 에러 표시 */}
      {error && (
        <div className="test-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* 사이드바: 시나리오 목록 */}
      <aside className="test-sidebar">
        <div className="sidebar-header">
          <h2>테스트 시나리오</h2>
          <button className="btn-new" onClick={createNewScenario}>
            + 새 시나리오
          </button>
        </div>

        <div className="scenario-list">
          {loading && scenarios.length === 0 && (
            <div className="loading">로딩 중...</div>
          )}
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className={`scenario-item ${selectedScenario?.id === scenario.id ? 'selected' : ''}`}
              onClick={() => selectScenario(scenario)}
            >
              <div className="scenario-name">{scenario.name}</div>
              {scenario.description && (
                <div className="scenario-description">{scenario.description}</div>
              )}
            </div>
          ))}
          {scenarios.length === 0 && !loading && (
            <div className="empty-list">시나리오가 없습니다</div>
          )}
        </div>
      </aside>

      {/* 메인: 시나리오 편집 / 상세 */}
      <main className="test-main">
        {!selectedScenario && viewMode !== 'edit' ? (
          <div className="no-selection">
            시나리오를 선택하거나 새로 만들어주세요
          </div>
        ) : viewMode === 'edit' ? (
          /* 편집 모드 (with AI 채팅) */
          <div className="scenario-editor-with-ai">
            {/* 왼쪽: YAML 에디터 */}
            <div className="editor-panel">
              <h2>{selectedScenario ? '시나리오 편집' : '새 시나리오'}</h2>

              <div className="form-group">
                <label>시나리오 이름</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="예: 로그인 테스트"
                />
              </div>

              <div className="form-group">
                <label>설명</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="테스트 시나리오에 대한 설명"
                  rows={2}
                />
              </div>

              <div className="form-group yaml-group">
                <label>테스트 YAML</label>
                <textarea
                  className="yaml-editor"
                  value={editYaml}
                  onChange={(e) => setEditYaml(e.target.value)}
                  placeholder={SAMPLE_YAML}
                  rows={15}
                  spellCheck={false}
                />
              </div>

              <div className="form-actions">
                <button className="btn-save" onClick={saveScenario} disabled={loading}>
                  {loading ? '저장 중...' : '저장'}
                </button>
                <button className="btn-cancel" onClick={() => {
                  if (selectedScenario) {
                    setViewMode('list')
                    resetEditState(selectedScenario)
                  } else {
                    setSelectedScenario(null)
                    setViewMode('list')
                  }
                }}>
                  취소
                </button>
              </div>
            </div>

            {/* 오른쪽: AI 채팅 패널 */}
            <div className="ai-chat-panel">
              <div className="chat-header">
                <span className="chat-title">🤖 AI 어시스턴트</span>
                <span className="chat-subtitle">자연어로 테스트를 설명하세요</span>
              </div>

              <div className="chat-messages">
                {aiMessages.map((msg) => (
                  <div key={msg.id} className={`chat-message ${msg.role}`}>
                    <div className="message-content">
                      {msg.content.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    {msg.yaml && (
                      <div className="message-yaml-applied">
                        ✓ YAML이 에디터에 적용되었습니다
                      </div>
                    )}
                  </div>
                ))}
                {isAiLoading && (
                  <div className="chat-message assistant loading">
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-input-area">
                <textarea
                  className="chat-input"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="테스트 시나리오를 자연어로 설명하세요..."
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendAiMessage()
                    }
                  }}
                />
                <button
                  className="btn-send"
                  onClick={sendAiMessage}
                  disabled={isAiLoading || !aiInput.trim()}
                >
                  {isAiLoading ? '...' : '전송'}
                </button>
              </div>

              <div className="chat-help">
                <strong>예시:</strong>
                <ul>
                  <li>"구글에서 Claude 검색하는 테스트"</li>
                  <li>"검색 결과가 나오는지 확인 추가"</li>
                  <li>"대기 시간을 3초로 늘려줘"</li>
                </ul>
              </div>
            </div>
          </div>
        ) : selectedScenario && (
          /* 상세 보기 */
          <div className="scenario-detail-view">
            <div className="detail-header">
              <h2>{selectedScenario.name}</h2>
              <div className="detail-actions">
                <button className="btn-run" onClick={runTest} disabled={isRunning}>
                  ▶ 테스트 실행
                </button>
                <button className="btn-edit" onClick={() => setViewMode('edit')}>
                  편집
                </button>
                <button className="btn-delete" onClick={deleteScenario}>
                  삭제
                </button>
              </div>
            </div>

            {selectedScenario.description && (
              <p className="detail-description">{selectedScenario.description}</p>
            )}

            <div className="detail-yaml">
              <h3>테스트 YAML</h3>
              <pre className="yaml-preview">{selectedScenario.yaml}</pre>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
