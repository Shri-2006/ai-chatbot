import { useEffect, useRef } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

function formatContent(text) {
  if (!text) return ''
  // Convert plain URLs to clickable links (but not ones already in href)
  text = text.replace(/(?<!['"=])(https?:\/\/[^\s<>)"']+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;word-break:break-all">$1</a>')
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'code-' + Math.random().toString(36).slice(2, 8)
    let highlighted
    try { highlighted = lang && hljs.getLanguage(lang) ? hljs.highlight(code.trim(),{language:lang}).value : hljs.highlightAuto(code.trim()).value }
    catch { highlighted = code.trim() }
    return `<div class="code-block"><div class="code-header"><span class="code-lang">${lang||'code'}</span><button class="copy-btn" data-code="${encodeURIComponent(code.trim())}">Copy</button></div><pre><code class="hljs">${highlighted}</code></pre></div>`
  })
  text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>')
  text = text.replace(/^### (.+)$/gm, '<h3 class="msg-h3">$1</h3>')
  text = text.replace(/^## (.+)$/gm,  '<h2 class="msg-h2">$1</h2>')
  text = text.replace(/^# (.+)$/gm,   '<h1 class="msg-h1">$1</h1>')
  text = text.replace(/^[-*] (.+)$/gm, '<li>$1</li>')
  text = text.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
  text = text.replace(/\n(?!<)/g, '<br/>')
  return text
}

export default function MessageBubble({ message }) {
  const bubbleRef = useRef(null)
  const isUser = message.role === 'user'
  const fileRefs = message.file_refs || []

  useEffect(() => {
    if (!bubbleRef.current) return
    bubbleRef.current.querySelectorAll('.copy-btn').forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code)).then(() => {
          btn.textContent = 'Copied!'; btn.style.color = '#86efac'
          setTimeout(()=>{ btn.textContent='Copy'; btn.style.color='' }, 2000)
        })
      }
    })
  })

  return (
    <div style={{ display:'flex', flexDirection:isUser?'row-reverse':'row', gap:10, padding:'6px 0', maxWidth:780, margin:'0 auto', width:'100%', animation:'fadeUp .2s ease' }}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .msg-bubble{font-size:14px;line-height:1.7;max-width:calc(100% - 46px);}
        .msg-bubble ul{padding-left:20px;margin:6px 0;}
        .msg-bubble li{margin:3px 0;}
        .msg-bubble .msg-h1{font-size:18px;font-weight:700;margin:12px 0 6px;}
        .msg-bubble .msg-h2{font-size:16px;font-weight:600;margin:10px 0 5px;}
        .msg-bubble .msg-h3{font-size:14px;font-weight:600;margin:8px 0 4px;}
        .msg-bubble strong{font-weight:600;}
        .inline-code{font-family:var(--mono);font-size:12.5px;background:rgba(255,255,255,0.07);border:1px solid var(--border);padding:1px 5px;border-radius:4px;color:#f9a8d4;}
        .code-block{border:1px solid #1e293b;border-radius:10px;overflow:hidden;margin:10px 0;}
        .code-header{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;background:#1a2035;border-bottom:1px solid #1e293b;}
        .code-lang{font-family:var(--mono);font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}
        .copy-btn{background:#253050;border:1px solid #2e3a55;color:#94a3b8;font-size:11.5px;padding:3px 10px;border-radius:5px;cursor:pointer;font-family:var(--font);transition:all .12s;}
        .copy-btn:hover{background:#2e3a55;color:#e2e8f0;}
        .code-block pre{margin:0;padding:14px;background:#0d1117;overflow-x:auto;}
        .code-block pre code{font-family:var(--mono);font-size:13px;line-height:1.6;}
      `}</style>

      <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, background:isUser?'var(--surface2)':'linear-gradient(135deg,var(--accent),var(--accent2))', border:isUser?'1px solid var(--border)':'none', display:'flex', alignItems:'center', justifyContent:'center', fontSize:isUser?13:14, marginTop:2, color:isUser?'var(--text2)':'#fff' }}>
        {isUser ? '👤' : '✦'}
      </div>

      <div className="msg-bubble" style={{ background:isUser?'var(--user-bubble)':'var(--surface)', border:`1px solid ${isUser?'rgba(78,127,255,0.15)':'var(--border)'}`, borderRadius:14, borderTopRightRadius:isUser?4:14, borderTopLeftRadius:isUser?14:4, padding:'10px 14px', color:'var(--text)' }}>
        {fileRefs.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
            {fileRefs.map((f,i)=>(
              <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:5, background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)', borderRadius:6, padding:'2px 8px', fontSize:12, color:'var(--text2)' }}>
                {f.icon} {f.name}
              </span>
            ))}
          </div>
        )}
        {!isUser && (message.web_searched || message.rag_used) && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, fontSize:11.5, color:'var(--text2)', borderBottom:'1px solid var(--border)', paddingBottom:8 }}>
            {message.web_searched && (
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                🔍 Searched the web {message.web_source ? `via ${message.web_source}` : ''}
              </span>
            )}
            {message.rag_used && <span style={{ display:'flex', alignItems:'center', gap:4 }}>📚 Used knowledge base</span>}
          </div>
        )}
        {isUser
          ? <div style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{message.content}</div>
          : <div ref={bubbleRef} dangerouslySetInnerHTML={{ __html:formatContent(message.content) }}/>
        }
      </div>
    </div>
  )
}