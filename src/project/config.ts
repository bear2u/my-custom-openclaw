import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'

export interface SlackConfig {
  enabled: boolean
  botToken: string
  appToken: string
}

export interface ClaudeMdInfo {
  exists: boolean
  content: string
  path: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  content: string
}

export interface AgentInfo {
  name: string
  description: string
  path: string
  content: string
  model?: string
  tools?: string[]
}

export interface PlanMdInfo {
  exists: boolean
  content: string
  path: string
}

// CLAUDE.md 파일 경로 (루트 우선)
function getClaudeMdPaths(projectPath: string): string[] {
  return [
    join(projectPath, 'CLAUDE.md'),  // 루트 우선
    join(projectPath, '.claude', 'CLAUDE.md'),
  ]
}

// plan.md 읽기
export async function getPlanMd(projectPath: string): Promise<PlanMdInfo> {
  const planPath = join(projectPath, 'plan.md')

  if (existsSync(planPath)) {
    try {
      const content = await readFile(planPath, 'utf-8')
      return { exists: true, content, path: planPath }
    } catch {
      // 읽기 실패
    }
  }

  return { exists: false, content: '', path: planPath }
}

// plan.md 저장
export async function savePlanMd(projectPath: string, content: string): Promise<string> {
  const planPath = join(projectPath, 'plan.md')
  await writeFile(planPath, content, 'utf-8')
  return planPath
}

// CLAUDE.md 읽기
export async function getClaudeMd(projectPath: string): Promise<ClaudeMdInfo> {
  const paths = getClaudeMdPaths(projectPath)

  for (const filePath of paths) {
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8')
        return { exists: true, content, path: filePath }
      } catch {
        // 읽기 실패 시 다음 경로 시도
      }
    }
  }

  // 기본 경로 반환 (파일이 없는 경우)
  return { exists: false, content: '', path: paths[0] }
}

// CLAUDE.md 저장
export async function saveClaudeMd(projectPath: string, content: string, preferredPath?: string): Promise<string> {
  let targetPath = preferredPath

  if (!targetPath) {
    // 기존 파일이 있으면 해당 경로 사용
    const existing = await getClaudeMd(projectPath)
    if (existing.exists) {
      targetPath = existing.path
    } else {
      // 기본적으로 루트의 CLAUDE.md 사용
      targetPath = join(projectPath, 'CLAUDE.md')
    }
  }

  // 디렉토리 생성
  const dir = join(targetPath, '..')
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  await writeFile(targetPath, content, 'utf-8')
  return targetPath
}

// YAML frontmatter 파싱
function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  // 간단한 YAML 파싱 (key: value 형태만)
  const frontmatter: Record<string, unknown> = {}
  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value: unknown = line.slice(colonIndex + 1).trim()

      // 배열 처리 (간단한 형태)
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim())
      }

      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}

// Skills 목록 가져오기
export async function getSkills(projectPath: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  const skillsDir = join(projectPath, '.claude', 'skills')

  if (!existsSync(skillsDir)) {
    return skills
  }

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md')
        if (existsSync(skillMdPath)) {
          try {
            const content = await readFile(skillMdPath, 'utf-8')
            const { frontmatter, body } = parseYamlFrontmatter(content)

            skills.push({
              name: (frontmatter.name as string) || entry.name,
              description: (frontmatter.description as string) || '',
              path: skillMdPath,
              content,
            })
          } catch {
            // 개별 스킬 읽기 실패 무시
          }
        }
      }
    }
  } catch {
    // 디렉토리 읽기 실패
  }

  return skills
}

// Skill 저장
export async function saveSkill(projectPath: string, skillName: string, content: string): Promise<string> {
  const skillDir = join(projectPath, '.claude', 'skills', skillName)
  const skillPath = join(skillDir, 'SKILL.md')

  if (!existsSync(skillDir)) {
    await mkdir(skillDir, { recursive: true })
  }

  await writeFile(skillPath, content, 'utf-8')
  return skillPath
}

// Skill 삭제
export async function deleteSkill(projectPath: string, skillName: string): Promise<boolean> {
  const { rm } = await import('node:fs/promises')
  const skillDir = join(projectPath, '.claude', 'skills', skillName)

  if (!existsSync(skillDir)) {
    return false
  }

  try {
    await rm(skillDir, { recursive: true })
    return true
  } catch {
    return false
  }
}

// Agents 목록 가져오기
export async function getAgents(projectPath: string): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = []
  const agentsDir = join(projectPath, '.claude', 'agents')

  if (!existsSync(agentsDir)) {
    return agents
  }

  try {
    const entries = await readdir(agentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agentPath = join(agentsDir, entry.name)
        try {
          const content = await readFile(agentPath, 'utf-8')
          const { frontmatter } = parseYamlFrontmatter(content)

          agents.push({
            name: (frontmatter.name as string) || basename(entry.name, '.md'),
            description: (frontmatter.description as string) || '',
            path: agentPath,
            content,
            model: frontmatter.model as string | undefined,
            tools: frontmatter.tools as string[] | undefined,
          })
        } catch {
          // 개별 에이전트 읽기 실패 무시
        }
      }
    }
  } catch {
    // 디렉토리 읽기 실패
  }

  return agents
}

// Agent 저장
export async function saveAgent(projectPath: string, agentName: string, content: string): Promise<string> {
  const agentsDir = join(projectPath, '.claude', 'agents')
  const agentPath = join(agentsDir, `${agentName}.md`)

  if (!existsSync(agentsDir)) {
    await mkdir(agentsDir, { recursive: true })
  }

  await writeFile(agentPath, content, 'utf-8')
  return agentPath
}

// Agent 삭제
export async function deleteAgent(projectPath: string, agentName: string): Promise<boolean> {
  const { unlink } = await import('node:fs/promises')
  const agentPath = join(projectPath, '.claude', 'agents', `${agentName}.md`)

  if (!existsSync(agentPath)) {
    return false
  }

  try {
    await unlink(agentPath)
    return true
  } catch {
    return false
  }
}

// Slack 설정 파일 경로
function getSlackConfigPath(projectPath: string): string {
  return join(projectPath, '.claude', 'slack.json')
}

// Slack 설정 읽기
export async function getSlackConfig(projectPath: string): Promise<SlackConfig> {
  const configPath = getSlackConfigPath(projectPath)

  const defaultConfig: SlackConfig = {
    enabled: false,
    botToken: '',
    appToken: '',
  }

  if (!existsSync(configPath)) {
    return defaultConfig
  }

  try {
    const content = await readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as Partial<SlackConfig>
    return {
      enabled: config.enabled ?? false,
      botToken: config.botToken ?? '',
      appToken: config.appToken ?? '',
    }
  } catch {
    return defaultConfig
  }
}

// Slack 설정 저장
export async function saveSlackConfig(projectPath: string, config: SlackConfig): Promise<void> {
  const configPath = getSlackConfigPath(projectPath)
  const claudeDir = join(projectPath, '.claude')

  if (!existsSync(claudeDir)) {
    await mkdir(claudeDir, { recursive: true })
  }

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
