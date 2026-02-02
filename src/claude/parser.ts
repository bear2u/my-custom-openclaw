export interface CliOutput {
  text: string
  sessionId?: string
}

// 세션 ID 필드 이름들 (Claude CLI 버전에 따라 다를 수 있음)
const SESSION_ID_FIELDS = ['session_id', 'sessionId', 'conversation_id', 'conversationId']

export function parseCliOutput(raw: string): CliOutput | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  // JSONL 형식 지원 (여러 줄의 JSON)
  if (trimmed.includes('\n')) {
    return parseJsonl(trimmed)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // JSON 파싱 실패 시 텍스트 그대로 반환
    return { text: trimmed }
  }

  if (!isRecord(parsed)) {
    return { text: trimmed }
  }

  // 텍스트 추출 (여러 경로 시도)
  const text =
    collectText(parsed.message) ||
    collectText(parsed.content) ||
    collectText(parsed.result) ||
    collectText(parsed.text) ||
    collectText(parsed)

  // 세션 ID 추출
  const sessionId = pickSessionId(parsed)

  return { text: text.trim(), sessionId }
}

function parseJsonl(raw: string): CliOutput | null {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let sessionId: string | undefined
  const texts: string[] = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (isRecord(parsed)) {
        sessionId ??= pickSessionId(parsed)

        // 다양한 텍스트 필드 지원
        if (typeof parsed.text === 'string') {
          texts.push(parsed.text)
        } else if (isRecord(parsed.item) && typeof parsed.item.text === 'string') {
          texts.push(parsed.item.text)
        } else {
          const text = collectText(parsed.message) || collectText(parsed.content)
          if (text) texts.push(text)
        }
      }
    } catch {
      // 개별 라인 파싱 실패 무시
    }
  }

  if (texts.length === 0) {
    return null
  }

  return { text: texts.join('\n').trim(), sessionId }
}

function pickSessionId(obj: Record<string, unknown>): string | undefined {
  for (const field of SESSION_ID_FIELDS) {
    const value = obj[field]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') {
          return item.text
        }
        return ''
      })
      .filter(Boolean)
      .join('')
  }

  if (isRecord(value)) {
    // content 배열 형태
    if (Array.isArray(value.content)) {
      return collectText(value.content)
    }
    // text 필드
    if (typeof value.text === 'string') {
      return value.text
    }
  }

  return ''
}
