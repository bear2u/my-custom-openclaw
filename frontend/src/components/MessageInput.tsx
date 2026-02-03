import { useState, type KeyboardEvent } from 'react'
import './MessageInput.css'

interface MessageInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input)
      setInput('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 조합 중이면 무시 (한글 등)
    if (e.nativeEvent.isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="message-input-container">
      <textarea
        className="message-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
        disabled={disabled}
        rows={1}
      />
      <button
        className="send-button"
        onClick={handleSend}
        disabled={!input.trim() || disabled}
      >
        전송
      </button>
    </div>
  )
}
