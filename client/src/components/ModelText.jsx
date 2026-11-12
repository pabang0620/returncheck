// Renders the model's reply as text: paragraphs, "- " lists, **bold** and `code`. No HTML is parsed, so the
// model's words are shown as written without raw markdown marks.
function inline(text, keyBase) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${keyBase}-${i}`}>{part.slice(1, -1)}</code>
    return part
  })
}

export function ModelText({ text }) {
  const blocks = String(text || '').trim().split(/\n\s*\n/)
  return (
    <div className="model-text">
      {blocks.map((block, b) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
        if (lines.length && lines.every((l) => /^([-*]|\d+\.)\s+/.test(l))) {
          return <ul key={b}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^([-*]|\d+\.)\s+/, ''), `${b}-${i}`)}</li>)}</ul>
        }
        return <p key={b}>{lines.map((l, i) => <span key={i}>{i > 0 && <br />}{inline(l.replace(/^#+\s+/, ''), `${b}-${i}`)}</span>)}</p>
      })}
    </div>
  )
}
