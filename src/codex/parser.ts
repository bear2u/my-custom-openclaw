import type { CliOutput } from '../claude/parser.js'

interface CodexEvent {
  type: string
  thread_id?: string
  item?: {
    id?: string
    type?: string
    text?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCodexJsonl(raw: string): CliOutput | null {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  let sessionId: string | undefined
  const texts: string[] = []

  for (const line of lines) {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (!isRecord(parsed)) continue

    const event = parsed as unknown as CodexEvent

    if (!sessionId && typeof event.thread_id === 'string') {
      sessionId = event.thread_id
    }

    if (event.type === 'item.completed' && event.item) {
      if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
        texts.push(event.item.text)
      }
    }
  }

  const text = texts.join('\n').trim()
  if (!text) return null
  return { text, sessionId }
}
