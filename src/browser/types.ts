// Browser Automation Types

import type WebSocket from 'ws'

// CDP (Chrome DevTools Protocol) Types
export interface CDPCommand {
  id: number
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}

export interface CDPResponse {
  id: number
  result?: unknown
  error?: { message: string }
  sessionId?: string
}

export interface CDPEvent {
  method: string
  params?: unknown
  sessionId?: string
}

// Extension Relay Protocol Types
export interface ExtensionForwardCommandMessage {
  id: number
  method: 'forwardCDPCommand'
  params: {
    method: string
    params?: unknown
    sessionId?: string
  }
}

export interface ExtensionResponseMessage {
  id: number
  result?: unknown
  error?: string
}

export interface ExtensionForwardEventMessage {
  method: 'forwardCDPEvent'
  params: {
    method: string
    params?: unknown
    sessionId?: string
  }
}

export interface ExtensionPingMessage {
  method: 'ping'
}

export interface ExtensionPongMessage {
  method: 'pong'
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionForwardEventMessage
  | ExtensionPongMessage

// Target (Tab) Types
export interface TargetInfo {
  targetId: string
  type?: string
  title?: string
  url?: string
  attached?: boolean
}

export interface AttachedToTargetEvent {
  sessionId: string
  targetInfo: TargetInfo
  waitingForDebugger?: boolean
}

export interface DetachedFromTargetEvent {
  sessionId: string
  targetId?: string
}

export interface ConnectedTarget {
  sessionId: string
  targetId: string
  targetInfo: TargetInfo
}

// Relay Server Types
export interface RelayServerStatus {
  connected: boolean
  extensionConnected: boolean
  targets: ConnectedTarget[]
  activeTargetId?: string
}

export interface RelayServerOptions {
  port?: number
  host?: string
}

export interface OpenUrlResult {
  tabId: number
  sessionId: string
  targetId: string
  url: string
}

export interface RelayServer {
  host: string
  port: number
  baseUrl: string
  cdpWsUrl: string
  extensionConnected: () => boolean
  getStatus: () => RelayServerStatus
  openUrl: (url: string, activate?: boolean) => Promise<OpenUrlResult>
  stop: () => Promise<void>
}

// Browser Tool Types
export interface BrowserToolOptions {
  relayServer: RelayServer
}

export interface ScreenshotResult {
  data: string  // base64 encoded
  format: 'png' | 'jpeg'
}

export interface ClickOptions {
  selector?: string
  x?: number
  y?: number
}

export interface TypeOptions {
  text: string
  delay?: number
}

export interface NavigateOptions {
  url: string
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
}

export interface EvaluateOptions {
  script: string
  returnByValue?: boolean
}

// Pending Request Tracking
export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}
