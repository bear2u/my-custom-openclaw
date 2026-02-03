import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import type {
  CDPCommand,
  CDPResponse,
  CDPEvent,
  ExtensionForwardCommandMessage,
  ExtensionMessage,
  ExtensionForwardEventMessage,
  ExtensionPingMessage,
  AttachedToTargetEvent,
  DetachedFromTargetEvent,
  ConnectedTarget,
  RelayServer,
  RelayServerStatus,
  RelayServerOptions,
  PendingRequest,
  OpenUrlResult,
} from './types.js'

const DEFAULT_PORT = 18792
const DEFAULT_HOST = '127.0.0.1'
const SCREENSHOTS_DIR = join(process.cwd(), 'screenshots')

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf-8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf-8')
  return String(data)
}

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false
  if (ip === '127.0.0.1') return true
  if (ip.startsWith('127.')) return true
  if (ip === '::1') return true
  if (ip.startsWith('::ffff:127.')) return true
  return false
}

function rejectUpgrade(socket: Duplex, status: number, bodyText: string) {
  const body = Buffer.from(bodyText)
  socket.write(
    `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'ERR'}\r\n` +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${body.length}\r\n` +
      'Connection: close\r\n' +
      '\r\n'
  )
  socket.write(body)
  socket.end()
  try {
    socket.destroy()
  } catch {
    // ignore
  }
}

let relayServerInstance: RelayServer | null = null

export async function startRelayServer(
  options: RelayServerOptions = {}
): Promise<RelayServer> {
  if (relayServerInstance) {
    return relayServerInstance
  }

  const port = options.port ?? DEFAULT_PORT
  const host = options.host ?? DEFAULT_HOST

  let extensionWs: WebSocket | null = null
  const cdpClients = new Set<WebSocket>()
  const connectedTargets = new Map<string, ConnectedTarget>()

  const pendingExtension = new Map<number, PendingRequest>()
  let nextExtensionId = 1

  const sendToExtension = async (
    payload: ExtensionForwardCommandMessage
  ): Promise<unknown> => {
    const ws = extensionWs
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Chrome extension not connected')
    }
    ws.send(JSON.stringify(payload))
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExtension.delete(payload.id)
        reject(new Error(`extension request timeout: ${payload.params.method}`))
      }, 30_000)
      pendingExtension.set(payload.id, { resolve, reject, timer })
    })
  }

  const broadcastToCdpClients = (evt: CDPEvent) => {
    const msg = JSON.stringify(evt)
    for (const ws of cdpClients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      ws.send(msg)
    }
  }

  const sendResponseToCdp = (ws: WebSocket, res: CDPResponse) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(res))
  }

  const ensureTargetEventsForClient = (
    ws: WebSocket,
    mode: 'autoAttach' | 'discover'
  ) => {
    for (const target of connectedTargets.values()) {
      if (mode === 'autoAttach') {
        ws.send(
          JSON.stringify({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: { ...target.targetInfo, attached: true },
              waitingForDebugger: false,
            },
          } satisfies CDPEvent)
        )
      } else {
        ws.send(
          JSON.stringify({
            method: 'Target.targetCreated',
            params: { targetInfo: { ...target.targetInfo, attached: true } },
          } satisfies CDPEvent)
        )
      }
    }
  }

  const routeCdpCommand = async (cmd: CDPCommand): Promise<unknown> => {
    switch (cmd.method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Claude-Gateway-Extension-Relay',
          revision: '0',
          userAgent: 'Claude-Gateway-Extension-Relay',
          jsVersion: 'V8',
        }
      case 'Browser.setDownloadBehavior':
        return {}
      case 'Target.setAutoAttach':
      case 'Target.setDiscoverTargets':
        return {}
      case 'Target.getTargets':
        return {
          targetInfos: Array.from(connectedTargets.values()).map((t) => ({
            ...t.targetInfo,
            attached: true,
          })),
        }
      case 'Target.getTargetInfo': {
        const params = (cmd.params ?? {}) as { targetId?: string }
        const targetId =
          typeof params.targetId === 'string' ? params.targetId : undefined
        if (targetId) {
          for (const t of connectedTargets.values()) {
            if (t.targetId === targetId) {
              return { targetInfo: t.targetInfo }
            }
          }
        }
        if (cmd.sessionId && connectedTargets.has(cmd.sessionId)) {
          const t = connectedTargets.get(cmd.sessionId)
          if (t) return { targetInfo: t.targetInfo }
        }
        const first = Array.from(connectedTargets.values())[0]
        return { targetInfo: first?.targetInfo }
      }
      case 'Target.attachToTarget': {
        const params = (cmd.params ?? {}) as { targetId?: string }
        const targetId =
          typeof params.targetId === 'string' ? params.targetId : undefined
        if (!targetId) throw new Error('targetId required')
        for (const t of connectedTargets.values()) {
          if (t.targetId === targetId) {
            return { sessionId: t.sessionId }
          }
        }
        throw new Error('target not found')
      }
      default: {
        const id = nextExtensionId++
        return await sendToExtension({
          id,
          method: 'forwardCDPCommand',
          params: {
            method: cmd.method,
            sessionId: cmd.sessionId,
            params: cmd.params,
          },
        })
      }
    }
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)
    const path = url.pathname

    if (req.method === 'HEAD' && path === '/') {
      res.writeHead(200)
      res.end()
      return
    }

    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('OK')
      return
    }

    if (path === '/extension/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ connected: Boolean(extensionWs) }))
      return
    }

    if (path === '/status') {
      const status: RelayServerStatus = {
        connected: Boolean(extensionWs),
        extensionConnected: Boolean(extensionWs),
        targets: Array.from(connectedTargets.values()),
        activeTargetId: Array.from(connectedTargets.values())[0]?.targetId,
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(status))
      return
    }

    // URL 열기 및 자동 연결 엔드포인트 (POST /open-url)
    if (path === '/open-url' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', async () => {
        try {
          const params = JSON.parse(body) as { url?: string; activate?: boolean }
          const targetUrl = params.url
          const activate = params.activate !== false

          if (!targetUrl || typeof targetUrl !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'url parameter is required' }))
            return
          }

          // URL 유효성 검사
          try {
            const parsed = new URL(targetUrl)
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Only http and https URLs are allowed' }))
              return
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid URL' }))
            return
          }

          // 확장 프로그램 연결 확인
          const ws = extensionWs
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Chrome extension not connected' }))
            return
          }

          // openAndAttach 명령 전송
          const id = nextExtensionId++
          const payload = {
            id,
            method: 'openAndAttach',
            params: { url: targetUrl, activate },
          }

          ws.send(JSON.stringify(payload))

          // 응답 대기
          const result = await new Promise<OpenUrlResult>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingExtension.delete(id)
              reject(new Error('openAndAttach request timeout'))
            }, 60_000)

            pendingExtension.set(id, {
              resolve: (value) => resolve(value as OpenUrlResult),
              reject,
              timer,
            })
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
      return
    }

    // 스크린샷 파일 서빙
    if (path.startsWith('/screenshots/')) {
      const filename = path.replace('/screenshots/', '')
      // 경로 탐색 공격 방지
      if (filename.includes('..') || filename.includes('/')) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      const filePath = join(SCREENSHOTS_DIR, filename)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const ext = extname(filename).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'

      try {
        const data = readFileSync(filePath)
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(data)
      } catch {
        res.writeHead(500)
        res.end('Error reading file')
      }
      return
    }

    const hostHeader = req.headers.host?.trim() || `${host}:${port}`
    const wsHost = `ws://${hostHeader}`
    const cdpWsUrl = `${wsHost}/cdp`

    if (
      (path === '/json/version' || path === '/json/version/') &&
      (req.method === 'GET' || req.method === 'PUT')
    ) {
      const payload: Record<string, unknown> = {
        Browser: 'Claude-Gateway/extension-relay',
        'Protocol-Version': '1.3',
      }
      if (extensionWs) {
        payload.webSocketDebuggerUrl = cdpWsUrl
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    const listPaths = new Set(['/json', '/json/', '/json/list', '/json/list/'])
    if (listPaths.has(path) && (req.method === 'GET' || req.method === 'PUT')) {
      const list = Array.from(connectedTargets.values()).map((t) => ({
        id: t.targetId,
        type: t.targetInfo.type ?? 'page',
        title: t.targetInfo.title ?? '',
        description: t.targetInfo.title ?? '',
        url: t.targetInfo.url ?? '',
        webSocketDebuggerUrl: cdpWsUrl,
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${cdpWsUrl.replace('ws://', '')}`,
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(list))
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  const wssExtension = new WebSocketServer({ noServer: true })
  const wssCdp = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)
    const pathname = url.pathname
    const remote = req.socket.remoteAddress

    if (!isLoopbackAddress(remote)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }

    const origin = req.headers.origin
    if (origin && !origin.startsWith('chrome-extension://')) {
      rejectUpgrade(socket, 403, 'Forbidden: invalid origin')
      return
    }

    if (pathname === '/extension') {
      if (extensionWs) {
        rejectUpgrade(socket, 409, 'Extension already connected')
        return
      }
      wssExtension.handleUpgrade(req, socket, head, (ws) => {
        wssExtension.emit('connection', ws, req)
      })
      return
    }

    if (pathname === '/cdp') {
      if (!extensionWs) {
        rejectUpgrade(socket, 503, 'Extension not connected')
        return
      }
      wssCdp.handleUpgrade(req, socket, head, (ws) => {
        wssCdp.emit('connection', ws, req)
      })
      return
    }

    rejectUpgrade(socket, 404, 'Not Found')
  })

  wssExtension.on('connection', (ws: WebSocket) => {
    extensionWs = ws
    console.log('[relay] ✅ Chrome extension connected')
    console.log('[relay] Browser automation is now available')

    const ping = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ method: 'ping' } satisfies ExtensionPingMessage))
    }, 5000)

    ws.on('message', (data: RawData) => {
      let parsed: ExtensionMessage | null = null
      try {
        parsed = JSON.parse(rawDataToString(data)) as ExtensionMessage
      } catch {
        return
      }

      if (
        parsed &&
        typeof parsed === 'object' &&
        'id' in parsed &&
        typeof parsed.id === 'number'
      ) {
        const pending = pendingExtension.get(parsed.id)
        if (!pending) return
        pendingExtension.delete(parsed.id)
        clearTimeout(pending.timer)
        if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          pending.reject(new Error(parsed.error))
        } else {
          pending.resolve(parsed.result)
        }
        return
      }

      if (parsed && typeof parsed === 'object' && 'method' in parsed) {
        if ((parsed as { method: string }).method === 'pong') return
        if ((parsed as ExtensionForwardEventMessage).method !== 'forwardCDPEvent')
          return
        const evt = parsed as ExtensionForwardEventMessage
        const method = evt.params?.method
        const params = evt.params?.params
        const sessionId = evt.params?.sessionId
        if (!method || typeof method !== 'string') return

        if (method === 'Target.attachedToTarget') {
          const attached = (params ?? {}) as AttachedToTargetEvent
          const targetType = attached?.targetInfo?.type ?? 'page'
          if (targetType !== 'page') return
          if (attached?.sessionId && attached?.targetInfo?.targetId) {
            const prev = connectedTargets.get(attached.sessionId)
            const nextTargetId = attached.targetInfo.targetId
            const prevTargetId = prev?.targetId
            const changedTarget = Boolean(
              prev && prevTargetId && prevTargetId !== nextTargetId
            )
            connectedTargets.set(attached.sessionId, {
              sessionId: attached.sessionId,
              targetId: nextTargetId,
              targetInfo: attached.targetInfo,
            })
            // 탭 연결 로그
            const title = attached.targetInfo.title || 'Untitled'
            const url = attached.targetInfo.url || ''
            console.log(`[relay] 📄 Tab attached: "${title}" (${url})`)
            if (changedTarget && prevTargetId) {
              broadcastToCdpClients({
                method: 'Target.detachedFromTarget',
                params: { sessionId: attached.sessionId, targetId: prevTargetId },
                sessionId: attached.sessionId,
              })
            }
            if (!prev || changedTarget) {
              broadcastToCdpClients({ method, params, sessionId })
            }
            return
          }
        }

        if (method === 'Target.detachedFromTarget') {
          const detached = (params ?? {}) as DetachedFromTargetEvent
          if (detached?.sessionId) {
            const target = connectedTargets.get(detached.sessionId)
            if (target) {
              console.log(`[relay] 📄 Tab detached: "${target.targetInfo.title || 'Untitled'}"`)
            }
            connectedTargets.delete(detached.sessionId)
          }
          broadcastToCdpClients({ method, params, sessionId })
          return
        }

        if (method === 'Target.targetInfoChanged') {
          const changed = (params ?? {}) as {
            targetInfo?: { targetId?: string; type?: string }
          }
          const targetInfo = changed?.targetInfo
          const targetId = targetInfo?.targetId
          if (targetId && (targetInfo?.type ?? 'page') === 'page') {
            for (const [sid, target] of connectedTargets) {
              if (target.targetId !== targetId) continue
              connectedTargets.set(sid, {
                ...target,
                targetInfo: { ...target.targetInfo, ...(targetInfo as object) },
              })
            }
          }
        }

        broadcastToCdpClients({ method, params, sessionId })
      }
    })

    ws.on('close', () => {
      clearInterval(ping)
      extensionWs = null
      console.log('[relay] ❌ Chrome extension disconnected')
      console.log('[relay] Browser automation is now unavailable')
      for (const [, pending] of pendingExtension) {
        clearTimeout(pending.timer)
        pending.reject(new Error('extension disconnected'))
      }
      pendingExtension.clear()
      connectedTargets.clear()

      for (const client of cdpClients) {
        try {
          client.close(1011, 'extension disconnected')
        } catch {
          // ignore
        }
      }
      cdpClients.clear()
    })
  })

  wssCdp.on('connection', (ws: WebSocket) => {
    cdpClients.add(ws)

    ws.on('message', async (data: RawData) => {
      let cmd: CDPCommand | null = null
      try {
        cmd = JSON.parse(rawDataToString(data)) as CDPCommand
      } catch {
        return
      }
      if (!cmd || typeof cmd !== 'object') return
      if (typeof cmd.id !== 'number' || typeof cmd.method !== 'string') return

      if (!extensionWs) {
        sendResponseToCdp(ws, {
          id: cmd.id,
          sessionId: cmd.sessionId,
          error: { message: 'Extension not connected' },
        })
        return
      }

      try {
        const result = await routeCdpCommand(cmd)

        if (cmd.method === 'Target.setAutoAttach' && !cmd.sessionId) {
          ensureTargetEventsForClient(ws, 'autoAttach')
        }
        if (cmd.method === 'Target.setDiscoverTargets') {
          const discover = (cmd.params ?? {}) as { discover?: boolean }
          if (discover.discover === true) {
            ensureTargetEventsForClient(ws, 'discover')
          }
        }
        if (cmd.method === 'Target.attachToTarget') {
          const params = (cmd.params ?? {}) as { targetId?: string }
          const targetId =
            typeof params.targetId === 'string' ? params.targetId : undefined
          if (targetId) {
            const target = Array.from(connectedTargets.values()).find(
              (t) => t.targetId === targetId
            )
            if (target) {
              ws.send(
                JSON.stringify({
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: target.sessionId,
                    targetInfo: { ...target.targetInfo, attached: true },
                    waitingForDebugger: false,
                  },
                } satisfies CDPEvent)
              )
            }
          }
        }

        sendResponseToCdp(ws, { id: cmd.id, sessionId: cmd.sessionId, result })
      } catch (err) {
        sendResponseToCdp(ws, {
          id: cmd.id,
          sessionId: cmd.sessionId,
          error: { message: err instanceof Error ? err.message : String(err) },
        })
      }
    })

    ws.on('close', () => {
      cdpClients.delete(ws)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve())
    server.once('error', reject)
  })

  const addr = server.address() as AddressInfo | null
  const actualPort = addr?.port ?? port
  const baseUrl = `http://${host}:${actualPort}`

  console.log(`[relay] Browser relay server started at ${baseUrl}`)

  const relay: RelayServer = {
    host,
    port: actualPort,
    baseUrl,
    cdpWsUrl: `ws://${host}:${actualPort}/cdp`,
    extensionConnected: () => Boolean(extensionWs),
    getStatus: () => ({
      connected: Boolean(extensionWs),
      extensionConnected: Boolean(extensionWs),
      targets: Array.from(connectedTargets.values()),
      activeTargetId: Array.from(connectedTargets.values())[0]?.targetId,
    }),
    openUrl: async (url: string, activate = true): Promise<OpenUrlResult> => {
      const ws = extensionWs
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('Chrome extension not connected')
      }

      const id = nextExtensionId++
      const payload = {
        id,
        method: 'openAndAttach',
        params: { url, activate },
      }

      ws.send(JSON.stringify(payload))

      return await new Promise<OpenUrlResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingExtension.delete(id)
          reject(new Error('openAndAttach request timeout'))
        }, 60_000) // 60초 타임아웃 (페이지 로드 대기)

        pendingExtension.set(id, {
          resolve: (value) => resolve(value as OpenUrlResult),
          reject,
          timer,
        })
      })
    },
    stop: async () => {
      relayServerInstance = null
      try {
        extensionWs?.close(1001, 'server stopping')
      } catch {
        // ignore
      }
      for (const ws of cdpClients) {
        try {
          ws.close(1001, 'server stopping')
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      wssExtension.close()
      wssCdp.close()
      console.log('[relay] Browser relay server stopped')
    },
  }

  relayServerInstance = relay
  return relay
}

export function getRelayServer(): RelayServer | null {
  return relayServerInstance
}

export async function stopRelayServer(): Promise<boolean> {
  if (!relayServerInstance) return false
  await relayServerInstance.stop()
  return true
}
