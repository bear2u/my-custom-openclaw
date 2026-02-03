import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SettingsPage } from './pages/SettingsPage'
import { KanbanPage } from './pages/KanbanPage'
import { TestPage } from './pages/TestPage'
import type { KanbanTask } from './types'
import './App.css'

// WebSocket URL - use /ws path in production (nginx proxy), direct connection in dev
const getWsUrl = () => {
  if (import.meta.env.PROD) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return 'ws://localhost:4900'
}

const WS_URL = getWsUrl()

function ChatPage({
  ws,
  attachedTask,
  onClearAttachedTask,
}: {
  ws: ReturnType<typeof useWebSocket>
  attachedTask: KanbanTask | null
  onClearAttachedTask: () => void
}) {
  return (
    <div className="app">
      <Sidebar
        projects={ws.projects}
        selectedProjectId={ws.projectId}
        onProjectSelect={ws.setProjectId}
        onProjectAdd={ws.addProject}
        onProjectRemove={ws.removeProject}
        sessions={ws.sessions}
        currentSessionId={ws.sessionId}
        onSessionSelect={ws.loadHistory}
        onSessionDelete={ws.deleteSession}
        onNewChat={ws.clearMessages}
      />
      <ChatWindow
        messages={ws.messages}
        status={ws.status}
        sessionId={ws.sessionId}
        projectId={ws.projectId}
        projects={ws.projects}
        onSend={ws.sendMessage}
        onClear={ws.clearMessages}
        attachedTask={attachedTask}
        onClearAttachedTask={onClearAttachedTask}
      />
    </div>
  )
}

function App() {
  const ws = useWebSocket(WS_URL)
  const [attachedTask, setAttachedTask] = useState<KanbanTask | null>(null)

  const handleAttachTask = (task: KanbanTask) => {
    setAttachedTask(task)
  }

  const handleClearAttachedTask = () => {
    setAttachedTask(null)
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <ChatPage
            ws={ws}
            attachedTask={attachedTask}
            onClearAttachedTask={handleClearAttachedTask}
          />
        }
      />
      <Route
        path="/settings/:projectId"
        element={<SettingsPage projects={ws.projects} sendRpc={ws.sendRpc} />}
      />
      <Route
        path="/kanban/:projectId"
        element={
          <KanbanPage
            projects={ws.projects}
            sendRpc={ws.sendRpc}
            onAttachTask={handleAttachTask}
          />
        }
      />
      <Route
        path="/test/:projectId"
        element={
          <TestPage
            projects={ws.projects}
            sendRpc={ws.sendRpc}
            subscribeToEvent={ws.subscribeToEvent}
          />
        }
      />
    </Routes>
  )
}

export default App
