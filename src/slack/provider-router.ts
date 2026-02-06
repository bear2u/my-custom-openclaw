export type Provider = 'claude' | 'codex'

export interface RouteResult {
  provider: Provider
  message: string
}

const CODEX_PREFIX = /^\/(codex|gpt)\s+/i

export function routeMessage(text: string): RouteResult {
  if (CODEX_PREFIX.test(text)) {
    return {
      provider: 'codex',
      message: text.replace(CODEX_PREFIX, ''),
    }
  }
  return { provider: 'claude', message: text }
}
