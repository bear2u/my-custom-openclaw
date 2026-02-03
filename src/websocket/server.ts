import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { createHandlers, type RpcRequest, type RpcResponse, type EventMessage } from './handlers.js'
import type { SessionManager } from '../session/manager.js'
import type { Config } from '../config.js'

export interface WebSocketClient {
  id: string
  ws: WebSocket
  sessionId?: string
}

export interface GatewayServer {
  wss: WebSocketServer
  clients: Map<string, WebSocketClient>
  broadcast: (event: string, data: unknown) => void
  sendToClient: (clientId: string, message: RpcResponse | EventMessage) => void
  start: () => void
  stop: () => void
}

export function createGatewayServer(
  port: number,
  config: Config,
  sessions: SessionManager
): GatewayServer {
  const wss = new WebSocketServer({ port })
  const clients = new Map<string, WebSocketClient>()
  const handlers = createHandlers(config, sessions)

  const sendToClient = (clientId: string, message: RpcResponse | EventMessage) => {
    const client = clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message))
    }
  }

  const broadcast = (event: string, data: unknown) => {
    const message: EventMessage = { event, data }
    const payload = JSON.stringify(message)
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload)
      }
    }
  }

  const handleMessage = async (client: WebSocketClient, raw: string) => {
    let request: RpcRequest
    try {
      request = JSON.parse(raw) as RpcRequest
    } catch {
      sendToClient(client.id, {
        id: '',
        ok: false,
        error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      })
      return
    }

    const { id, method, params } = request
    const handler = handlers[method]

    if (!handler) {
      sendToClient(client.id, {
        id,
        ok: false,
        error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${method}` },
      })
      return
    }

    try {
      const result = await handler(params, client, {
        sendEvent: (event, data) => sendToClient(client.id, { event, data }),
        broadcast,
      })
      sendToClient(client.id, { id, ok: true, result })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      sendToClient(client.id, {
        id,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: error.message },
      })
    }
  }

  wss.on('connection', (ws) => {
    const clientId = randomUUID()
    const client: WebSocketClient = { id: clientId, ws }
    clients.set(clientId, client)

    console.log(`[WS] Client connected: ${clientId}`)

    sendToClient(clientId, {
      event: 'connected',
      data: { clientId },
    })

    ws.on('message', (data) => {
      handleMessage(client, String(data))
    })

    ws.on('close', () => {
      clients.delete(clientId)
      console.log(`[WS] Client disconnected: ${clientId}`)
    })

    ws.on('error', (err) => {
      console.error(`[WS] Client error (${clientId}):`, err)
    })
  })

  return {
    wss,
    clients,
    broadcast,
    sendToClient,
    start: () => {
      console.log(`[WS] Gateway server listening on port ${port}`)
    },
    stop: () => {
      for (const client of clients.values()) {
        client.ws.close()
      }
      wss.close()
    },
  }
}
