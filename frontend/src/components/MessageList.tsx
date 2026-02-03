import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import { MarkdownContent } from './MarkdownContent'
import './MessageList.css'

interface MessageListProps {
  messages: Message[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          <span className="emoji">💬</span>
          <p>Claude에게 메시지를 보내보세요!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`message ${message.role}`}
        >
          <div className="message-avatar">
            {message.role === 'user' ? '👤' : '🤖'}
          </div>
          <div className="message-content">
            <div className="message-role">
              {message.role === 'user' ? 'You' : 'Claude'}
            </div>
            <div className="message-text">
              {message.content ? (
                <MarkdownContent content={message.content} />
              ) : (
                message.isStreaming && '...'
              )}
              {message.isStreaming && <span className="typing-indicator">●</span>}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
