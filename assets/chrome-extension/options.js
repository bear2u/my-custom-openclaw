const DEFAULT_PORT = 18792

function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_PORT
  if (n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function updateRelayUrl(port) {
  const el = document.getElementById('relay-url')
  if (!el) return
  el.textContent = `http://127.0.0.1:${port}/`
}

function setStatus(kind, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

async function checkRelayReachable(port) {
  const url = `http://127.0.0.1:${port}/`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setStatus('ok', `Relay reachable at ${url}`)
  } catch {
    setStatus(
      'error',
      `Relay not reachable at ${url}. Start OpenClaw’s browser relay on this machine, then click the toolbar button again.`,
    )
  } finally {
    clearTimeout(t)
  }
}

async function load() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const port = clampPort(stored.relayPort)
  document.getElementById('port').value = String(port)
  updateRelayUrl(port)
  await checkRelayReachable(port)
}

async function save() {
  const input = document.getElementById('port')
  const port = clampPort(input.value)
  await chrome.storage.local.set({ relayPort: port })
  input.value = String(port)
  updateRelayUrl(port)
  await checkRelayReachable(port)
}

function setAttachStatus(kind, message) {
  const status = document.getElementById('attach-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

async function attachAllTabs() {
  setAttachStatus('', 'Attaching to all tabs...')
  try {
    // background.js에 메시지 전송
    const response = await chrome.runtime.sendMessage({ action: 'attachAllTabs' })
    if (response.success) {
      setAttachStatus('ok', `Attached to ${response.count} tabs`)
    } else {
      setAttachStatus('error', response.error || 'Failed to attach')
    }
  } catch (err) {
    setAttachStatus('error', err.message)
  }
}

async function detachAllTabs() {
  setAttachStatus('', 'Detaching from all tabs...')
  try {
    const response = await chrome.runtime.sendMessage({ action: 'detachAllTabs' })
    if (response.success) {
      setAttachStatus('ok', `Detached from ${response.count} tabs`)
    } else {
      setAttachStatus('error', response.error || 'Failed to detach')
    }
  } catch (err) {
    setAttachStatus('error', err.message)
  }
}

document.getElementById('save').addEventListener('click', () => void save())
document.getElementById('attach-all').addEventListener('click', () => void attachAllTabs())
document.getElementById('detach-all').addEventListener('click', () => void detachAllTabs())
void load()
