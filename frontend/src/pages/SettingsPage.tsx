import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { ClaudeMdInfo, PlanMdInfo, SkillInfo, AgentInfo, Project, SlackConfig, BrowserStatus } from '../types'
import './SettingsPage.css'

interface SettingsPageProps {
  project: Project | null
  sendRpc: <T>(method: string, params?: unknown) => Promise<T>
}

type TabType = 'claudemd' | 'planmd' | 'skills' | 'agents' | 'slack' | 'browser'

export function SettingsPage({ project, sendRpc }: SettingsPageProps) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<TabType>('claudemd')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // CLAUDE.md 상태
  const [claudeMd, setClaudeMd] = useState<ClaudeMdInfo | null>(null)
  const [claudeMdContent, setClaudeMdContent] = useState('')
  const [claudeMdDirty, setClaudeMdDirty] = useState(false)

  // plan.md 상태
  const [planMd, setPlanMd] = useState<PlanMdInfo | null>(null)
  const [planMdContent, setPlanMdContent] = useState('')
  const [planMdDirty, setPlanMdDirty] = useState(false)

  // Skills 상태
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)
  const [skillContent, setSkillContent] = useState('')
  const [skillDirty, setSkillDirty] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [isAddingSkill, setIsAddingSkill] = useState(false)

  // Agents 상태
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null)
  const [agentContent, setAgentContent] = useState('')
  const [agentDirty, setAgentDirty] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [isAddingAgent, setIsAddingAgent] = useState(false)

  // Slack 상태
  const [slackConfig, setSlackConfig] = useState<SlackConfig>({
    enabled: false,
    botToken: '',
    appToken: '',
  })
  const [slackDirty, setSlackDirty] = useState(false)
  const [showTokens, setShowTokens] = useState(false)

  // Slack 매니페스트 상태
  const [manifestBotName, setManifestBotName] = useState('ClaudeBot')
  const [manifestCopied, setManifestCopied] = useState(false)

  // Browser 상태
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus>({
    connected: false,
    extensionConnected: false,
    targets: [],
    relayRunning: false,
    mode: 'off',
  })
  const [browserLoading, setBrowserLoading] = useState(false)

  // 매니페스트 생성 함수
  const generateSlackManifest = (botName: string) => {
    const safeName = botName.trim() || 'ClaudeBot'
    return {
      display_information: {
        name: safeName,
        description: `${safeName} connector for Claude`,
        background_color: '#000000',
      },
      features: {
        app_home: {
          home_tab_enabled: false,
          messages_tab_enabled: true,
          messages_tab_read_only_enabled: false,
        },
        bot_user: {
          display_name: safeName,
          always_online: false,
        },
        slash_commands: [
          {
            command: '/claude',
            description: `Send a message to ${safeName}`,
            should_escape: false,
          },
        ],
      },
      oauth_config: {
        scopes: {
          bot: [
            'chat:write',
            'channels:history',
            'channels:read',
            'groups:history',
            'im:history',
            'mpim:history',
            'users:read',
            'app_mentions:read',
            'reactions:read',
            'reactions:write',
            'pins:read',
            'pins:write',
            'emoji:read',
            'commands',
            'files:read',
            'files:write',
          ],
        },
      },
      settings: {
        socket_mode_enabled: true,
        event_subscriptions: {
          bot_events: [
            'app_mention',
            'message.channels',
            'message.groups',
            'message.im',
            'message.mpim',
            'reaction_added',
            'reaction_removed',
            'member_joined_channel',
            'member_left_channel',
            'channel_rename',
            'pin_added',
            'pin_removed',
          ],
        },
      },
    }
  }

  // 매니페스트 복사 함수
  const copyManifest = async () => {
    const manifest = generateSlackManifest(manifestBotName)
    const json = JSON.stringify(manifest, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setManifestCopied(true)
      setTimeout(() => setManifestCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = json
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setManifestCopied(true)
      setTimeout(() => setManifestCopied(false), 2000)
    }
  }

  // CLAUDE.md 로드
  const loadClaudeMd = useCallback(async () => {
    if (!projectId) return
    try {
      const info = await sendRpc<ClaudeMdInfo>('config.claudeMd.get', { projectId })
      setClaudeMd(info)
      setClaudeMdContent(info.content)
      setClaudeMdDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CLAUDE.md')
    }
  }, [projectId, sendRpc])

  // CLAUDE.md 저장
  const saveClaudeMd = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.claudeMd.save', { projectId, content: claudeMdContent })
      setClaudeMdDirty(false)
      setSuccess('CLAUDE.md 저장 완료')
      setTimeout(() => setSuccess(null), 2000)
      await loadClaudeMd()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save CLAUDE.md')
    } finally {
      setLoading(false)
    }
  }

  // plan.md 로드
  const loadPlanMd = useCallback(async () => {
    if (!projectId) return
    try {
      const info = await sendRpc<PlanMdInfo>('config.planMd.get', { projectId })
      setPlanMd(info)
      setPlanMdContent(info.content)
      setPlanMdDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plan.md')
    }
  }, [projectId, sendRpc])

  // plan.md 저장
  const savePlanMd = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.planMd.save', { projectId, content: planMdContent })
      setPlanMdDirty(false)
      setSuccess('plan.md 저장 완료')
      setTimeout(() => setSuccess(null), 2000)
      await loadPlanMd()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan.md')
    } finally {
      setLoading(false)
    }
  }

  // Skills 로드
  const loadSkills = useCallback(async () => {
    if (!projectId) return
    try {
      const list = await sendRpc<SkillInfo[]>('config.skills.list', { projectId })
      setSkills(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills')
    }
  }, [projectId, sendRpc])

  // Skill 저장
  const saveSkill = async () => {
    if (!selectedSkill || !projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.skills.save', {
        projectId,
        name: selectedSkill.name,
        content: skillContent,
      })
      setSkillDirty(false)
      setSuccess('Skill 저장 완료')
      setTimeout(() => setSuccess(null), 2000)
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill')
    } finally {
      setLoading(false)
    }
  }

  // 새 Skill 생성
  const createSkill = async () => {
    if (!newSkillName.trim() || !projectId) return
    setLoading(true)
    setError(null)
    try {
      const defaultContent = `---
name: ${newSkillName}
description: 새로운 스킬 설명
---

# ${newSkillName}

여기에 스킬 지침을 작성하세요.
`
      await sendRpc('config.skills.save', {
        projectId,
        name: newSkillName,
        content: defaultContent,
      })
      setNewSkillName('')
      setIsAddingSkill(false)
      await loadSkills()
      setSuccess('Skill 생성 완료')
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setLoading(false)
    }
  }

  // Skill 삭제
  const deleteSkill = async (name: string) => {
    if (!confirm(`"${name}" 스킬을 삭제하시겠습니까?`) || !projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.skills.delete', { projectId, name })
      if (selectedSkill?.name === name) {
        setSelectedSkill(null)
        setSkillContent('')
      }
      await loadSkills()
      setSuccess('Skill 삭제 완료')
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill')
    } finally {
      setLoading(false)
    }
  }

  // Agents 로드
  const loadAgents = useCallback(async () => {
    if (!projectId) return
    try {
      const list = await sendRpc<AgentInfo[]>('config.agents.list', { projectId })
      setAgents(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents')
    }
  }, [projectId, sendRpc])

  // Agent 저장
  const saveAgent = async () => {
    if (!selectedAgent || !projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.agents.save', {
        projectId,
        name: selectedAgent.name,
        content: agentContent,
      })
      setAgentDirty(false)
      setSuccess('Agent 저장 완료')
      setTimeout(() => setSuccess(null), 2000)
      await loadAgents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent')
    } finally {
      setLoading(false)
    }
  }

  // 새 Agent 생성
  const createAgent = async () => {
    if (!newAgentName.trim() || !projectId) return
    setLoading(true)
    setError(null)
    try {
      const defaultContent = `---
name: ${newAgentName}
description: 새로운 에이전트 설명
model: sonnet
tools: Read, Grep, Glob
---

# ${newAgentName}

여기에 에이전트 지침을 작성하세요.
`
      await sendRpc('config.agents.save', {
        projectId,
        name: newAgentName,
        content: defaultContent,
      })
      setNewAgentName('')
      setIsAddingAgent(false)
      await loadAgents()
      setSuccess('Agent 생성 완료')
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setLoading(false)
    }
  }

  // Agent 삭제
  const deleteAgent = async (name: string) => {
    if (!confirm(`"${name}" 에이전트를 삭제하시겠습니까?`) || !projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.agents.delete', { projectId, name })
      if (selectedAgent?.name === name) {
        setSelectedAgent(null)
        setAgentContent('')
      }
      await loadAgents()
      setSuccess('Agent 삭제 완료')
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent')
    } finally {
      setLoading(false)
    }
  }

  // Slack 설정 로드
  const loadSlackConfig = useCallback(async () => {
    if (!projectId) return
    try {
      const config = await sendRpc<SlackConfig>('config.slack.get', { projectId })
      setSlackConfig(config)
      setSlackDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Slack config')
    }
  }, [projectId, sendRpc])

  // Slack 설정 저장
  const saveSlackConfig = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      await sendRpc('config.slack.save', { projectId, config: slackConfig })
      setSlackDirty(false)
      setSuccess('Slack 설정 저장 완료')
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Slack config')
    } finally {
      setLoading(false)
    }
  }

  // Browser 상태 로드
  const loadBrowserStatus = useCallback(async () => {
    try {
      const status = await sendRpc<BrowserStatus>('browser.status', {})
      setBrowserStatus(status)
    } catch (err) {
      console.error('Failed to load browser status:', err)
    }
  }, [sendRpc])

  // Browser 시작
  const startBrowser = async (mode: 'puppeteer' | 'relay') => {
    setBrowserLoading(true)
    setError(null)
    try {
      await sendRpc('browser.start', { mode })
      setSuccess(`브라우저 (${mode}) 시작됨`)
      setTimeout(() => setSuccess(null), 2000)
      await loadBrowserStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start browser')
    } finally {
      setBrowserLoading(false)
    }
  }

  // Browser 중지
  const stopBrowser = async () => {
    setBrowserLoading(true)
    setError(null)
    try {
      await sendRpc('browser.stop', {})
      setSuccess('브라우저 중지됨')
      setTimeout(() => setSuccess(null), 2000)
      await loadBrowserStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop browser')
    } finally {
      setBrowserLoading(false)
    }
  }

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (!projectId) return
    if (activeTab === 'claudemd') {
      loadClaudeMd()
    } else if (activeTab === 'planmd') {
      loadPlanMd()
    } else if (activeTab === 'skills') {
      loadSkills()
    } else if (activeTab === 'agents') {
      loadAgents()
    } else if (activeTab === 'slack') {
      loadSlackConfig()
    } else if (activeTab === 'browser') {
      loadBrowserStatus()
    }
  }, [activeTab, projectId, loadClaudeMd, loadPlanMd, loadSkills, loadAgents, loadSlackConfig, loadBrowserStatus])

  // Browser 탭에서 주기적으로 상태 갱신
  useEffect(() => {
    if (activeTab !== 'browser') return
    const interval = setInterval(loadBrowserStatus, 3000)
    return () => clearInterval(interval)
  }, [activeTab, loadBrowserStatus])

  // Skill 선택 시 컨텐츠 로드
  useEffect(() => {
    if (selectedSkill) {
      setSkillContent(selectedSkill.content)
      setSkillDirty(false)
    }
  }, [selectedSkill])

  // Agent 선택 시 컨텐츠 로드
  useEffect(() => {
    if (selectedAgent) {
      setAgentContent(selectedAgent.content)
      setAgentDirty(false)
    }
  }, [selectedAgent])

  if (!project) {
    return (
      <div className="settings-page">
        <div className="settings-header">
          <button className="back-btn" onClick={() => navigate('/')}>
            ← 돌아가기
          </button>
          <h1>프로젝트를 찾을 수 없습니다</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← 돌아가기
        </button>
        <div className="header-info">
          <h1>{project.name} 설정</h1>
          <span className="project-path">{project.path}</span>
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      <div className="settings-tabs">
        <button
          className={`tab-btn ${activeTab === 'claudemd' ? 'active' : ''}`}
          onClick={() => setActiveTab('claudemd')}
        >
          CLAUDE.md
        </button>
        <button
          className={`tab-btn ${activeTab === 'planmd' ? 'active' : ''}`}
          onClick={() => setActiveTab('planmd')}
        >
          plan.md
        </button>
        <button
          className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          Skills ({skills.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agents ({agents.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'slack' ? 'active' : ''}`}
          onClick={() => setActiveTab('slack')}
        >
          Slack {slackConfig.enabled && '(ON)'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'browser' ? 'active' : ''}`}
          onClick={() => setActiveTab('browser')}
        >
          Browser {browserStatus.extensionConnected ? '(ON)' : '(OFF)'}
        </button>
      </div>

      <div className="settings-content">
        {/* CLAUDE.md 탭 */}
        {activeTab === 'claudemd' && (
          <div className="tab-content">
            <div className="content-header">
              <div className="header-info">
                <span className="file-status">
                  {claudeMd?.exists ? '파일 있음' : '파일 없음 (새로 생성됩니다)'}
                </span>
                {claudeMd?.path && <span className="file-path">{claudeMd.path}</span>}
              </div>
              <button
                className="save-btn"
                onClick={saveClaudeMd}
                disabled={loading || !claudeMdDirty}
              >
                {loading ? '저장 중...' : '저장'}
              </button>
            </div>
            <textarea
              className="content-editor"
              value={claudeMdContent}
              onChange={(e) => {
                setClaudeMdContent(e.target.value)
                setClaudeMdDirty(true)
              }}
              placeholder="# 프로젝트 지침을 작성하세요..."
            />
          </div>
        )}

        {/* plan.md 탭 */}
        {activeTab === 'planmd' && (
          <div className="tab-content">
            <div className="content-header">
              <div className="header-info">
                <span className="file-status">
                  {planMd?.exists ? '파일 있음' : '파일 없음 (새로 생성됩니다)'}
                </span>
                {planMd?.path && <span className="file-path">{planMd.path}</span>}
              </div>
              <button
                className="save-btn"
                onClick={savePlanMd}
                disabled={loading || !planMdDirty}
              >
                {loading ? '저장 중...' : '저장'}
              </button>
            </div>
            <textarea
              className="content-editor"
              value={planMdContent}
              onChange={(e) => {
                setPlanMdContent(e.target.value)
                setPlanMdDirty(true)
              }}
              placeholder="# 계획을 작성하세요..."
            />
          </div>
        )}

        {/* Skills 탭 */}
        {activeTab === 'skills' && (
          <div className="tab-content split-view">
            <div className="list-panel">
              <div className="panel-header">
                <span>Skills</span>
                <button
                  className="add-btn"
                  onClick={() => setIsAddingSkill(!isAddingSkill)}
                >
                  {isAddingSkill ? '취소' : '+'}
                </button>
              </div>
              {isAddingSkill && (
                <div className="add-form">
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="스킬 이름"
                    onKeyDown={(e) => e.key === 'Enter' && createSkill()}
                  />
                  <button onClick={createSkill} disabled={loading || !newSkillName.trim()}>
                    생성
                  </button>
                </div>
              )}
              <div className="item-list">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    className={`list-item ${selectedSkill?.name === skill.name ? 'selected' : ''}`}
                    onClick={() => setSelectedSkill(skill)}
                  >
                    <div className="item-info">
                      <span className="item-name">{skill.name}</span>
                      <span className="item-desc">{skill.description}</span>
                    </div>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSkill(skill.name)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {skills.length === 0 && !isAddingSkill && (
                  <div className="empty-message">스킬이 없습니다</div>
                )}
              </div>
            </div>
            <div className="editor-panel">
              {selectedSkill ? (
                <>
                  <div className="content-header">
                    <span className="file-path">{selectedSkill.path}</span>
                    <button
                      className="save-btn"
                      onClick={saveSkill}
                      disabled={loading || !skillDirty}
                    >
                      {loading ? '저장 중...' : '저장'}
                    </button>
                  </div>
                  <textarea
                    className="content-editor"
                    value={skillContent}
                    onChange={(e) => {
                      setSkillContent(e.target.value)
                      setSkillDirty(true)
                    }}
                  />
                </>
              ) : (
                <div className="no-selection">스킬을 선택하세요</div>
              )}
            </div>
          </div>
        )}

        {/* Agents 탭 */}
        {activeTab === 'agents' && (
          <div className="tab-content split-view">
            <div className="list-panel">
              <div className="panel-header">
                <span>Agents</span>
                <button
                  className="add-btn"
                  onClick={() => setIsAddingAgent(!isAddingAgent)}
                >
                  {isAddingAgent ? '취소' : '+'}
                </button>
              </div>
              {isAddingAgent && (
                <div className="add-form">
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="에이전트 이름"
                    onKeyDown={(e) => e.key === 'Enter' && createAgent()}
                  />
                  <button onClick={createAgent} disabled={loading || !newAgentName.trim()}>
                    생성
                  </button>
                </div>
              )}
              <div className="item-list">
                {agents.map((agent) => (
                  <div
                    key={agent.name}
                    className={`list-item ${selectedAgent?.name === agent.name ? 'selected' : ''}`}
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <div className="item-info">
                      <span className="item-name">{agent.name}</span>
                      <span className="item-desc">{agent.description}</span>
                      {agent.model && <span className="item-meta">모델: {agent.model}</span>}
                    </div>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteAgent(agent.name)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {agents.length === 0 && !isAddingAgent && (
                  <div className="empty-message">에이전트가 없습니다</div>
                )}
              </div>
            </div>
            <div className="editor-panel">
              {selectedAgent ? (
                <>
                  <div className="content-header">
                    <span className="file-path">{selectedAgent.path}</span>
                    <button
                      className="save-btn"
                      onClick={saveAgent}
                      disabled={loading || !agentDirty}
                    >
                      {loading ? '저장 중...' : '저장'}
                    </button>
                  </div>
                  <textarea
                    className="content-editor"
                    value={agentContent}
                    onChange={(e) => {
                      setAgentContent(e.target.value)
                      setAgentDirty(true)
                    }}
                  />
                </>
              ) : (
                <div className="no-selection">에이전트를 선택하세요</div>
              )}
            </div>
          </div>
        )}

        {/* Slack 탭 */}
        {activeTab === 'slack' && (
          <div className="tab-content slack-settings">
            <div className="slack-header">
              <h2>Slack 연동 설정</h2>
              <p className="slack-desc">
                이 프로젝트에서 Slack Bot을 통해 Claude와 대화할 수 있습니다.
              </p>
            </div>

            <div className="slack-form">
              {/* Step 1: 매니페스트 복사 섹션 */}
              <div className="slack-step">
                <div className="step-header">
                  <span className="step-number">1</span>
                  <h3>Slack App Manifest 생성</h3>
                </div>
                <p className="step-desc">
                  봇 이름을 입력하고 매니페스트를 복사하세요.
                </p>

                <div className="manifest-config">
                  <div className="form-group">
                    <label>Bot 이름</label>
                    <input
                      type="text"
                      value={manifestBotName}
                      onChange={(e) => setManifestBotName(e.target.value)}
                      placeholder="ClaudeBot"
                    />
                    <span className="form-hint">
                      Slack에 표시될 봇의 이름입니다
                    </span>
                  </div>

                  <button
                    className={`copy-manifest-btn ${manifestCopied ? 'copied' : ''}`}
                    onClick={copyManifest}
                  >
                    {manifestCopied ? '복사 완료!' : '매니페스트 복사'}
                  </button>
                </div>

                <div className="manifest-preview">
                  <div className="manifest-preview-header">
                    <span>미리보기</span>
                  </div>
                  <pre className="manifest-code">
                    {JSON.stringify(generateSlackManifest(manifestBotName), null, 2)}
                  </pre>
                </div>
              </div>

              {/* Step 2: Slack App 생성 가이드 */}
              <div className="slack-step">
                <div className="step-header">
                  <span className="step-number">2</span>
                  <h3>Slack App 생성</h3>
                </div>
                <ol className="step-guide">
                  <li>
                    <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                      api.slack.com/apps
                    </a>
                    에서 <strong>"Create New App"</strong> 클릭
                  </li>
                  <li><strong>"From an app manifest"</strong> 선택</li>
                  <li>워크스페이스 선택 후 위에서 복사한 매니페스트 붙여넣기</li>
                  <li>앱 생성 완료</li>
                </ol>
              </div>

              {/* Step 3: 토큰 발급 */}
              <div className="slack-step">
                <div className="step-header">
                  <span className="step-number">3</span>
                  <h3>토큰 발급</h3>
                </div>
                <ol className="step-guide">
                  <li>
                    <strong>Basic Information → App-Level Tokens</strong>에서
                    "Generate Token and Scopes" 클릭
                  </li>
                  <li>Token Name 입력, <code>connections:write</code> scope 추가 후 Generate</li>
                  <li><strong>OAuth &amp; Permissions</strong>에서 "Install to Workspace" 클릭</li>
                  <li>발급된 Bot Token과 App Token을 아래에 입력</li>
                </ol>
              </div>

              {/* Step 4: 토큰 입력 및 활성화 */}
              <div className="slack-step">
                <div className="step-header">
                  <span className="step-number">4</span>
                  <h3>토큰 입력 및 활성화</h3>
                </div>

                <div className="form-group">
                  <label>Bot Token (xoxb-...)</label>
                  <input
                    type={showTokens ? 'text' : 'password'}
                    value={slackConfig.botToken}
                    onChange={(e) => {
                      setSlackConfig({ ...slackConfig, botToken: e.target.value })
                      setSlackDirty(true)
                    }}
                    placeholder="xoxb-your-bot-token"
                  />
                  <span className="form-hint">
                    OAuth &amp; Permissions → Bot User OAuth Token
                  </span>
                </div>

                <div className="form-group">
                  <label>App Token (xapp-...)</label>
                  <input
                    type={showTokens ? 'text' : 'password'}
                    value={slackConfig.appToken}
                    onChange={(e) => {
                      setSlackConfig({ ...slackConfig, appToken: e.target.value })
                      setSlackDirty(true)
                    }}
                    placeholder="xapp-your-app-token"
                  />
                  <span className="form-hint">
                    Basic Information → App-Level Tokens
                  </span>
                </div>

                <div className="form-group">
                  <label className="show-tokens-label">
                    <input
                      type="checkbox"
                      checked={showTokens}
                      onChange={(e) => setShowTokens(e.target.checked)}
                    />
                    토큰 표시
                  </label>
                </div>

                <div className="form-group toggle-group">
                  <label className="toggle-label">
                    <span>Slack 연동 활성화</span>
                    <input
                      type="checkbox"
                      checked={slackConfig.enabled}
                      onChange={(e) => {
                        setSlackConfig({ ...slackConfig, enabled: e.target.checked })
                        setSlackDirty(true)
                      }}
                    />
                    <span className="toggle-switch" />
                  </label>
                </div>

                <div className="slack-actions">
                  <button
                    className="save-btn"
                    onClick={saveSlackConfig}
                    disabled={loading || !slackDirty}
                  >
                    {loading ? '저장 중...' : '설정 저장'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Browser 탭 */}
        {activeTab === 'browser' && (
          <div className="tab-content browser-settings">
            <div className="browser-header">
              <h2>Browser 자동화</h2>
              <p className="browser-desc">
                Puppeteer 또는 Chrome 확장 프로그램을 통해 AI 에이전트가 브라우저를 제어할 수 있습니다.
              </p>
            </div>

            <div className="browser-status-card">
              <div className="status-row">
                <span className="status-label">모드</span>
                <span className={`status-badge ${browserStatus.mode !== 'off' ? 'active' : 'inactive'}`}>
                  {browserStatus.mode === 'off' ? 'Off' : browserStatus.mode === 'puppeteer' ? 'Puppeteer' : 'Relay'}
                </span>
              </div>

              <div className="status-row">
                <span className="status-label">릴레이 서버</span>
                <span className={`status-badge ${browserStatus.relayRunning ? 'active' : 'inactive'}`}>
                  {browserStatus.relayRunning ? 'Running' : 'Stopped'}
                </span>
              </div>

              <div className="status-row">
                <span className="status-label">Chrome 확장 프로그램</span>
                <span className={`status-badge ${browserStatus.extensionConnected ? 'active' : 'inactive'}`}>
                  {browserStatus.extensionConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div className="status-row">
                <span className="status-label">연결된 탭</span>
                <span className="status-value">{browserStatus.targets.length}개</span>
              </div>
            </div>

            {/* 브라우저 제어 버튼 */}
            <div className="browser-controls">
              <h3>브라우저 제어</h3>
              <div className="control-buttons">
                {browserStatus.mode === 'off' ? (
                  <>
                    <button
                      className="start-btn puppeteer"
                      onClick={() => startBrowser('puppeteer')}
                      disabled={browserLoading}
                    >
                      {browserLoading ? '시작 중...' : 'Puppeteer 시작'}
                    </button>
                    <button
                      className="start-btn relay"
                      onClick={() => startBrowser('relay')}
                      disabled={browserLoading}
                    >
                      {browserLoading ? '시작 중...' : 'Relay 시작'}
                    </button>
                  </>
                ) : (
                  <button
                    className="stop-btn"
                    onClick={stopBrowser}
                    disabled={browserLoading}
                  >
                    {browserLoading ? '중지 중...' : '브라우저 중지'}
                  </button>
                )}
              </div>
              <p className="control-hint">
                <strong>Puppeteer:</strong> 새로운 Chrome 인스턴스를 자동으로 시작합니다.<br />
                <strong>Relay:</strong> Chrome 확장 프로그램을 통해 기존 브라우저에 연결합니다.
              </p>
            </div>

            {browserStatus.targets.length > 0 && (
              <div className="browser-targets">
                <h3>활성 탭</h3>
                <div className="targets-list">
                  {browserStatus.targets.map((target) => (
                    <div key={target.sessionId} className="target-item">
                      <div className="target-info">
                        <span className="target-title">
                          {target.targetInfo.title || '(제목 없음)'}
                        </span>
                        <span className="target-url">
                          {target.targetInfo.url || '(URL 없음)'}
                        </span>
                      </div>
                      <span className={`target-status ${target.targetInfo.attached ? 'attached' : ''}`}>
                        {target.targetInfo.attached ? 'Attached' : 'Detached'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!browserStatus.extensionConnected && (
              <div className="browser-setup">
                <h3>설정 방법</h3>
                <ol className="setup-steps">
                  <li>
                    <code>assets/chrome-extension</code> 폴더를 Chrome에 로드합니다.
                    <ul>
                      <li>Chrome에서 <code>chrome://extensions</code> 접속</li>
                      <li>우측 상단 "개발자 모드" 활성화</li>
                      <li>"압축해제된 확장 프로그램을 로드합니다" 클릭</li>
                      <li><code>assets/chrome-extension</code> 폴더 선택</li>
                    </ul>
                  </li>
                  <li>
                    브라우저에서 원하는 탭을 열고 확장 아이콘을 클릭하여 연결합니다.
                  </li>
                  <li>
                    연결되면 AI 에이전트가 해당 탭을 제어할 수 있습니다.
                  </li>
                </ol>
              </div>
            )}

            <div className="browser-actions">
              <button className="refresh-btn" onClick={loadBrowserStatus}>
                상태 새로고침
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
