import { useMemo, useState } from 'react'
import './MarkdownContent.css'

interface MarkdownContentProps {
  content: string
}

type ParsedElement =
  | { type: 'text'; content: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'inlineCode'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'heading'; level: number; content: string }
  | { type: 'listItem'; content: string }
  | { type: 'lineBreak' }

function parseMarkdown(text: string): ParsedElement[] {
  const elements: ParsedElement[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 코드 블록 (```)
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push({ type: 'code', language, content: codeLines.join('\n') })
      i++
      continue
    }

    // 헤딩 (#, ##, ###, etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      elements.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      })
      i++
      continue
    }

    // 리스트 아이템 (-, *, 숫자.)
    const listMatch = line.match(/^[\s]*[-*]\s+(.+)$/) || line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (listMatch) {
      elements.push({ type: 'listItem', content: listMatch[1] })
      i++
      continue
    }

    // 빈 줄
    if (line.trim() === '') {
      elements.push({ type: 'lineBreak' })
      i++
      continue
    }

    // 인라인 요소 파싱
    const inlineElements = parseInlineElements(line)
    elements.push(...inlineElements)
    elements.push({ type: 'lineBreak' })
    i++
  }

  return elements
}

function parseInlineElements(text: string): ParsedElement[] {
  const elements: ParsedElement[] = []
  let remaining = text

  while (remaining.length > 0) {
    // 이미지 ![alt](src)
    const imageMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (imageMatch) {
      elements.push({ type: 'image', alt: imageMatch[1], src: imageMatch[2] })
      remaining = remaining.slice(imageMatch[0].length)
      continue
    }

    // 링크 [text](href)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      elements.push({ type: 'link', text: linkMatch[1], href: linkMatch[2] })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // 인라인 코드 `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      elements.push({ type: 'inlineCode', content: codeMatch[1] })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // 볼드 **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      elements.push({ type: 'bold', content: boldMatch[1] })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // 일반 텍스트 (다음 특수 문자까지)
    const nextSpecial = remaining.search(/[!\[\]`*]/)
    if (nextSpecial === -1) {
      elements.push({ type: 'text', content: remaining })
      break
    } else if (nextSpecial === 0) {
      // 특수 문자가 매치되지 않은 경우 한 글자 추가
      elements.push({ type: 'text', content: remaining[0] })
      remaining = remaining.slice(1)
    } else {
      elements.push({ type: 'text', content: remaining.slice(0, nextSpecial) })
      remaining = remaining.slice(nextSpecial)
    }
  }

  return elements
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const elements = useMemo(() => parseMarkdown(content), [content])
  const [modalImage, setModalImage] = useState<string | null>(null)

  return (
    <div className="markdown-content">
      {/* 이미지 모달 */}
      {modalImage && (
        <div className="image-modal-overlay" onClick={() => setModalImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setModalImage(null)}>×</button>
            <img src={modalImage} alt="확대 이미지" className="image-modal-img" />
            <a href={modalImage} target="_blank" rel="noopener noreferrer" className="image-modal-open">
              새 탭에서 열기 ↗
            </a>
          </div>
        </div>
      )}

      {elements.map((el, idx) => {
        switch (el.type) {
          case 'text':
            return <span key={idx}>{el.content}</span>

          case 'image':
            return (
              <div key={idx} className="markdown-image-container">
                <img
                  src={el.src}
                  alt={el.alt}
                  className="markdown-image"
                  onClick={() => setModalImage(el.src)}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    target.parentElement?.insertAdjacentHTML(
                      'beforeend',
                      `<span class="image-error">이미지를 불러올 수 없습니다: ${el.alt || el.src}</span>`
                    )
                  }}
                />
                {el.alt && <span className="image-caption">{el.alt}</span>}
              </div>
            )

          case 'link':
            return (
              <a key={idx} href={el.href} target="_blank" rel="noopener noreferrer" className="markdown-link">
                {el.text}
              </a>
            )

          case 'code':
            return (
              <pre key={idx} className="markdown-code-block">
                {el.language && <span className="code-language">{el.language}</span>}
                <code>{el.content}</code>
              </pre>
            )

          case 'inlineCode':
            return (
              <code key={idx} className="markdown-inline-code">
                {el.content}
              </code>
            )

          case 'bold':
            return <strong key={idx}>{el.content}</strong>

          case 'heading':
            if (el.level === 1) return <h1 key={idx} className="markdown-heading">{el.content}</h1>
            if (el.level === 2) return <h2 key={idx} className="markdown-heading">{el.content}</h2>
            if (el.level === 3) return <h3 key={idx} className="markdown-heading">{el.content}</h3>
            if (el.level === 4) return <h4 key={idx} className="markdown-heading">{el.content}</h4>
            if (el.level === 5) return <h5 key={idx} className="markdown-heading">{el.content}</h5>
            return <h6 key={idx} className="markdown-heading">{el.content}</h6>

          case 'listItem':
            return (
              <div key={idx} className="markdown-list-item">
                • {el.content}
              </div>
            )

          case 'lineBreak':
            return <br key={idx} />

          default:
            return null
        }
      })}
    </div>
  )
}
