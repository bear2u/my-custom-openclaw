import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

const DATA_DIR = join(homedir(), '.claude-gateway')
const PROJECTS_FILE = join(DATA_DIR, 'projects.json')

export class ProjectManager {
  private projects: Map<string, Project> = new Map()
  private loaded = false

  async load(): Promise<void> {
    if (this.loaded) return

    try {
      if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true })
      }

      if (existsSync(PROJECTS_FILE)) {
        const data = await readFile(PROJECTS_FILE, 'utf-8')
        const projects = JSON.parse(data) as Project[]
        for (const project of projects) {
          this.projects.set(project.id, project)
        }
      }
    } catch (err) {
      console.error('[ProjectManager] Failed to load projects:', err)
    }

    this.loaded = true
  }

  private async save(): Promise<void> {
    try {
      const projects = Array.from(this.projects.values())
      await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2))
    } catch (err) {
      console.error('[ProjectManager] Failed to save projects:', err)
    }
  }

  async add(name: string, path: string): Promise<Project> {
    await this.load()

    // 경로 유효성 검사
    if (!existsSync(path)) {
      throw new Error(`Directory does not exist: ${path}`)
    }

    const id = crypto.randomUUID()
    const project: Project = {
      id,
      name,
      path,
      createdAt: Date.now(),
    }

    this.projects.set(id, project)
    await this.save()

    console.log(`[ProjectManager] Added project: ${name} (${path})`)
    return project
  }

  async remove(id: string): Promise<boolean> {
    await this.load()

    const deleted = this.projects.delete(id)
    if (deleted) {
      await this.save()
      console.log(`[ProjectManager] Removed project: ${id}`)
    }
    return deleted
  }

  async get(id: string): Promise<Project | undefined> {
    await this.load()
    return this.projects.get(id)
  }

  async list(): Promise<Project[]> {
    await this.load()
    return Array.from(this.projects.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  async update(id: string, updates: Partial<Pick<Project, 'name' | 'path'>>): Promise<Project | null> {
    await this.load()

    const project = this.projects.get(id)
    if (!project) return null

    if (updates.path && !existsSync(updates.path)) {
      throw new Error(`Directory does not exist: ${updates.path}`)
    }

    const updated = { ...project, ...updates }
    this.projects.set(id, updated)
    await this.save()

    return updated
  }
}
