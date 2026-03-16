import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import MessageBubble from './MessageBubble'

// API is now a Vercel serverless function — same domain, no CORS issues
const API_URL = '/api/chat'

const MODELS = [
  // Claude 4.6
  { id:'claude-46-sonnet',      label:'Sonnet 4.6',          desc:'Latest · Balanced',        color:'#4e7fff', group:'Claude 4.6'   },
  { id:'claude-46-opus',        label:'Opus 4.6',            desc:'Latest · Most powerful',   color:'#a855f7', group:'Claude 4.6'   },
  // Claude 4.5
  { id:'claude-45-haiku',       label:'Haiku 4.5',           desc:'Fast & cheap',             color:'#22c55e', group:'Claude 4.5'   },
  { id:'claude-45-sonnet',      label:'Sonnet 4.5',          desc:'Balanced',                 color:'#60a5fa', group:'Claude 4.5'   },
  { id:'claude-45-opus',        label:'Opus 4.5',            desc:'Most powerful',            color:'#c084fc', group:'Claude 4.5'   },
  // Claude 3.x-deprecated
  //{ id:'claude-37-sonnet',     label:'Sonnet 3.7',          desc:'Extended thinking',        color:'#f59e0b', group:'Claude 3' },
  // OpenAI
  { id:'gpt-5',                label:'GPT-5',               desc:'Latest OpenAI',            color:'#10b981', group:'OpenAI'   },
  { id:'gpt-5-mini',           label:'GPT-5 Mini',          desc:'Fast GPT-5',               color:'#34d399', group:'OpenAI'   },
  { id:'gpt-4o',               label:'GPT-4o',              desc:'Multimodal',               color:'#6ee7b7', group:'OpenAI'   },
  { id:'gpt-4o-mini',          label:'GPT-4o Mini',         desc:'Fast & affordable',        color:'#a7f3d0', group:'OpenAI'   },
  { id:'gpt-41',               label:'GPT-4.1',             desc:'Latest GPT-4',             color:'#059669', group:'OpenAI'   },
  { id:'gpt-41-mini',          label:'GPT-4.1 Mini',        desc:'Efficient',                color:'#047857', group:'OpenAI'   },
  { id:'gpt-41-nano',          label:'GPT-4.1 Nano',        desc:'Cheapest OpenAI',          color:'#065f46', group:'OpenAI'   },
  // Gemini
  { id:'gemini-25-pro',        label:'Gemini 2.5 Pro',      desc:'Best Gemini',              color:'#f43f5e', group:'Google'   },
  { id:'gemini-25-flash',      label:'Gemini 2.5 Flash',    desc:'Fast & smart',             color:'#fb7185', group:'Google'   },
  { id:'gemini-25-flash-lite', label:'2.5 Flash Lite',      desc:'Cheapest Gemini',          color:'#fda4af', group:'Google'   },
  { id:'gemini-20-flash',      label:'Gemini 2.0 Flash',    desc:'Reliable',                 color:'#fecdd3', group:'Google'   },
  { id:'gemini-20-flash-lite', label:'2.0 Flash Lite',      desc:'Budget option',            color:'#ffe4e6', group:'Google'   },
]

const FILE_ICONS = {
  'image/jpeg':'🖼️','image/png':'🖼️',
  'application/pdf':'📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'📝',
  'text/plain':'📃',
}

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Read failed'))
    r.readAsDataURL(file)
  })
}

async function extractPdfText(file) {
  // Use pdf.js via CDN to extract text from PDF
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    pages.push(textContent.items.map(item => item.str).join(' '))
  }
  return pages.join('\n\n')
}

async function processFile(file) {
  const icon = FILE_ICONS[file.type] || '📎'

  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    const base64 = await toBase64(file)
    return { name:file.name, icon, fileType:'image', contentBlock:{ type:'image', source:{ type:'base64', media_type:file.type, data:base64 } } }
  }
  if (file.type === 'application/pdf') {
    // Extract text from PDF — SAP orchestration doesn't support raw PDF binary
    const text = await extractPdfText(file)
    if (!text.trim()) throw new Error('Could not extract text from PDF. It may be a scanned image-based PDF.')
    // Truncate to 8000 chars per file to avoid SAP payload limits
    // 5 files × 8000 chars = 40000 chars which SAP can handle
    const MAX_CHARS = 4000
    const truncated = text.trim().slice(0, MAX_CHARS)
    const wasTruncated = text.trim().length > MAX_CHARS
    const note = wasTruncated ? `\n\n[Note: This PDF was truncated to ${MAX_CHARS} characters. For full content, ask about specific sections.]` : ''
    return {
      name: file.name, icon, fileType: 'pdf',
      contentBlock: { type: 'text', text: `[Contents of ${file.name}]:\n${truncated}${note}` }
    }
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { name:file.name, icon, fileType:'docx', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${result.value.trim()}` } }
  }
  if (file.type === 'text/plain') {
    return { name:file.name, icon, fileType:'txt', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${await file.text()}` } }
  }
  throw new Error('Unsupported file type')
}

export default function ChatWindow({ conversation, session, profile, sidebarOpen, onToggleSidebar, onUpdateConversation, onNewConversation, onSetActiveId }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [model, setModel] = useState('claude-46-sonnet')
  const [modelOpen, setModelOpen] = useState(false)
  const [memoryMode, setMemoryMode] = useState('summary')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    // Reset UI state when switching conversations
    setInput('')
    setPendingFiles([])
    setLoading(false)

    if (!conversation) { setMessages([]); return }
    setLoadingHistory(true)
    supabase.from('messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending:true })
      .then(({ data }) => { if (data) setMessages(data); setLoadingHistory(false) })
    setModel(conversation.model || 'claude-46-sonnet')
    setMemoryMode(conversation.memory_mode || 'summary')
    setConversationMemory(conversation.memory || '')
    setMemoryMode(conversation.memory_mode || 'summary')
  }, [conversation?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages])
  useEffect(() => { const close = () => setModelOpen(false); if (modelOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [modelOpen])
  useEffect(() => { const close = () => setMemoryOpen(false); if (memoryOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [memoryOpen])
  useEffect(() => { const close = () => setMemoryMenuOpen(false); if (memoryMenuOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [memoryMenuOpen])

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files); e.target.value = ''
    if (pendingFiles.filter(Boolean).length + files.length > 5) {
      alert('Maximum 5 files at a time. This keeps the request small enough for the AI to process reliably.')
      return
    }
    for (const file of files) {
      if (file.size > 20*1024*1024) { alert(`${file.name} is too large (max 20MB per file)`); continue }
      try { setPendingFiles(prev => [...prev, null]); const p = await processFile(file); setPendingFiles(prev => [...prev.slice(0,-1), p]) }
      catch(err) { setPendingFiles(prev => prev.slice(0,-1)); alert(`Could not read ${file.name}: ${err.message}`) }
    }
  }

  async function sendMessage() {
    const text = input.trim()
    const files = [...pendingFiles].filter(Boolean)
    if (!text && files.length === 0) return

    let convId = conversation?.id
    if (!convId) {
      // Create conversation and set it active — don't return, keep going
      const newConvo = await onNewConversation(model)
      if (!newConvo) return
      convId = newConvo.id
      onSetActiveId(convId) // update sidebar without remounting ChatWindow
    }

    setInput(''); setPendingFiles([]); setLoading(true)

    const displayContent = text || `[${files.map(f=>f.name).join(', ')}]`
    const fileRefs = files.map(f => ({ name:f.name, type:f.fileType, icon:f.icon }))

    const optimistic = { id:'temp-user', role:'user', content:displayContent, file_refs:fileRefs, created_at:new Date().toISOString() }
    setMessages(prev => [...prev, optimistic])

    const { data:savedUser } = await supabase.from('messages').insert({ conversation_id:convId, role:'user', content:displayContent, file_refs:fileRefs }).select().single()
    if (savedUser) setMessages(prev => prev.map(m => m.id==='temp-user' ? savedUser : m))

    // Auto-title on first message
    if (messages.length === 0 && text) {
      fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ messages:[{role:'user',content:text}], model:'claude-haiku-4-5-20251001',
          system_override:'Generate a very short title (3-5 words max) for this conversation. Reply with ONLY the title, no quotes.' })
      }).then(r=>r.json()).then(d => { if(d.reply) onUpdateConversation(convId,{title:d.reply.slice(0,60),model}) })
    }

    // Build API message history — only keep last 20 messages to avoid huge payloads
    // Full history is still saved in Supabase, just not sent to the AI every time
    const MAX_HISTORY = 20
    const recentMessages = messages.filter(m=>m.id!=='temp-user').slice(-MAX_HISTORY)

    const apiMessages = recentMessages.map(m => {
      // For messages that had file attachments, just reference the filenames
      // (the actual content was in the original message and is now in history)
      if (m.file_refs?.length > 0 && m.role === 'user') {
        return { role: m.role, content: `[Previously attached: ${m.file_refs.map(f=>f.name).join(', ')}]\n${m.content}` }
      }
      return { role: m.role, content: m.content }
    })
    apiMessages.push({ role:'user', content: files.length>0 ? [...files.map(f=>f.contentBlock), ...(text?[{type:'text',text}]:[])] : text })

    try {
      const res = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        messages: apiMessages,
        model,
        memory: conversationMemory,
        memory_mode: memoryMode,
        attached_file_names: files.map(f => f.name),
      }) })

      // Safely parse response — SAP sometimes returns plain text errors instead of JSON
      const rawText = await res.text()
      let data
      try {
        data = JSON.parse(rawText)
      } catch {
        // Not JSON — show the raw SAP error message
        const reply = `⚠️ Server error: ${rawText.slice(0, 300)}`
        setMessages(prev => [...prev, { id:Date.now(), role:'assistant', content:reply, file_refs:[] }])
        setLoading(false)
        return
      }

      const reply = data.reply || data.error || 'Something went wrong.'
      const { data:saved } = await supabase.from('messages').insert({ conversation_id:convId, role:'assistant', content:reply, file_refs:[] }).select().single()
      setMessages(prev => [...prev, saved || { id:Date.now(), role:'assistant', content:reply, file_refs:[] }])

      // Save updated memory to Supabase and local state
      if (data.new_memory && memoryMode !== 'off') {
        setConversationMemory(data.new_memory)
        await supabase.from('conversations').update({ memory: data.new_memory, memory_mode: memoryMode }).eq('id', convId)
      }
    } catch (err) {
      const msg = err?.message?.includes('Failed to fetch')
        ? '⚠️ Could not reach the server. Check your internet connection or try again.'
        : `⚠️ Error: ${err?.message || 'Something went wrong.'}`
      setMessages(prev => [...prev, { id:Date.now(), role:'assistant', content:msg, file_refs:[] }])
    }

    setLoading(false); inputRef.current?.focus()
  }

  const activeModel = MODELS.find(m=>m.id===model) || MODELS[0]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', height:'100vh', background:'var(--main-bg)', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'rgba(17,19,24,0.9)', backdropFilter:'blur(12px)', flexShrink:0, zIndex:10 }}>
        <button onClick={onToggleSidebar} style={{ background:'none', border:'none', color:'var(--text2)', padding:6, borderRadius:8, display:'flex', transition:'color .15s' }}
          onMouseEnter={e=>e.currentTarget.style.color='var(--text)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text2)'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div style={{ flex:1, fontSize:14, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {conversation?.title || 'AI Assistant'}
        </div>


        {/* Memory mode toggle */}
        <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setMemoryOpen(o=>!o)} style={{
            display:'flex', alignItems:'center', gap:6,
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:9, padding:'6px 10px', color:'var(--text)', fontSize:12, fontWeight:500,
            transition:'border-color .15s',
          }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <span style={{ fontSize:13 }}>
              {memoryMode === 'off' ? '🧠' : memoryMode === 'summary' ? '📝' : '💡'}
            </span>
            <span style={{ color:'var(--text2)', fontSize:11.5 }}>
              {memoryMode === 'off' ? 'No Memory' : memoryMode === 'summary' ? 'Summary' : 'Full Memory'}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)' }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {memoryOpen && (
            <div style={{
              position:'fixed', right:8, top:'auto',
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:12, padding:6, minWidth:220, zIndex:1000,
              boxShadow:'0 8px 30px rgba(0,0,0,0.4)',
            }}>
              {[
                { id:'off',     icon:'🧠', label:'No Memory',   desc:'Send last 20 messages each time' },
                { id:'summary', icon:'📝', label:'Summary',     desc:'Rolling summary (default, fast)' },
                { id:'full',    icon:'💡', label:'Full Memory',  desc:'Detailed memory of everything' },
              ].map(m => (
                <button key={m.id} onClick={async () => {
                  setMemoryMode(m.id)
                  setMemoryOpen(false)
                  // Save preference to conversation
                  if (conversation?.id) {
                    await supabase.from('conversations').update({ memory_mode: m.id }).eq('id', conversation.id)
                  }
                }} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10,
                  padding:'9px 12px', borderRadius:8, border:'none', textAlign:'left',
                  background: memoryMode===m.id ? 'var(--surface2)' : 'transparent',
                  transition:'background .12s',
                }}
                  onMouseEnter={e=>{ if(memoryMode!==m.id) e.currentTarget.style.background='rgba(255,255,255,0.04)' }}
                  onMouseLeave={e=>{ if(memoryMode!==m.id) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:16 }}>{m.icon}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{m.label}</div>
                    <div style={{ fontSize:11.5, color:'var(--text2)' }}>{m.desc}</div>
                  </div>
                  {memoryMode===m.id && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ marginLeft:'auto' }}><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Model selector */}
        <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setModelOpen(o=>!o)} style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:'6px 10px', color:'var(--text)', fontSize:13, fontWeight:500, transition:'border-color .15s' }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:activeModel.color, flexShrink:0 }}/>
            {activeModel.label}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)' }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {modelOpen && (
            <div style={{ position:'absolute', right:0, top:'calc(100% + 6px)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:6, minWidth:220, zIndex:100, boxShadow:'0 8px 30px rgba(0,0,0,0.4)' }}>
              {(() => {
                const groups = [...new Set(MODELS.map(m => m.group))]
                return groups.map(group => (
                  <div key={group}>
                    <div style={{ padding:'6px 12px 2px', fontSize:10.5, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em' }}>{group}</div>
                    {MODELS.filter(m => m.group === group).map(m => (
                      <button key={m.id} onClick={()=>{ setModel(m.id); setModelOpen(false) }}
                        style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, border:'none', textAlign:'left', background:model===m.id?'var(--surface2)':'transparent', transition:'background .12s' }}
                        onMouseEnter={e=>{ if(model!==m.id)e.currentTarget.style.background='rgba(255,255,255,0.04)' }}
                        onMouseLeave={e=>{ if(model!==m.id)e.currentTarget.style.background='transparent' }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:m.color, flexShrink:0 }}/>
                        <div>
                          <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{m.label}</div>
                          <div style={{ fontSize:11.5, color:'var(--text2)' }}>{m.desc}</div>
                        </div>
                        {model===m.id && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ marginLeft:'auto' }}><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    ))}
                  </div>
                ))
              })()}
            </div>
          )}
        </div>

        {/* Memory mode toggle */}
        <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setMemoryMenuOpen(o=>!o)} style={{
            display:'flex', alignItems:'center', gap:6,
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:9, padding:'6px 10px', fontSize:12, fontWeight:500,
            color: memoryMode === 'off' ? 'var(--text2)' : memoryMode === 'full' ? '#a855f7' : '#22c55e',
            transition:'border-color .15s',
          }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            {memoryMode === 'off' ? '🧠 Off' : memoryMode === 'summary' ? '🧠 Summary' : '🧠 Full'}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)' }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {memoryMenuOpen && (
            <div style={{ position:'fixed', right:8, top:'auto', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:6, minWidth:220, zIndex:1000, boxShadow:'0 8px 30px rgba(0,0,0,0.4)' }}>
              <div style={{ padding:'6px 12px 4px', fontSize:10.5, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em' }}>Memory Mode</div>
              {[
                { id:'off',     label:'Off',          desc:'No memory — send last 20 messages',      color:'var(--text2)' },
                { id:'summary', label:'Summary',       desc:'Brief rolling summary (default, fast)',  color:'#22c55e'     },
                { id:'full',    label:'Full Memory',   desc:'Detailed record of everything discussed', color:'#a855f7'     },
              ].map(m => (
                <button key={m.id} onClick={async () => {
                  setMemoryMode(m.id)
                  setMemoryMenuOpen(false)
                  if (conversation?.id) {
                    await supabase.from('conversations').update({ memory_mode: m.id }).eq('id', conversation.id)
                  }
                }} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10,
                  padding:'9px 12px', borderRadius:8, border:'none', textAlign:'left',
                  background: memoryMode===m.id ? 'var(--surface2)' : 'transparent', transition:'background .12s',
                }}
                  onMouseEnter={e=>{ if(memoryMode!==m.id) e.currentTarget.style.background='rgba(255,255,255,0.04)' }}
                  onMouseLeave={e=>{ if(memoryMode!==m.id) e.currentTarget.style.background='transparent' }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:m.color, flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{m.label}</div>
                    <div style={{ fontSize:11.5, color:'var(--text2)' }}>{m.desc}</div>
                  </div>
                  {memoryMode===m.id && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ marginLeft:'auto' }}><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px 16px', display:'flex', flexDirection:'column', gap:0 }}>
        {!conversation && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, color:'var(--text2)', textAlign:'center' }}>
            <div style={{ width:56, height:56, borderRadius:16, background:'linear-gradient(135deg,var(--accent),var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, marginBottom:4 }}>✦</div>
            <div style={{ fontSize:20, fontWeight:700, color:'var(--text)', letterSpacing:'-0.02em' }}>How can I help?</div>
            <div style={{ fontSize:14, maxWidth:340, lineHeight:1.6 }}>Start a new chat or pick one from the sidebar. You can attach images, PDFs, Word docs, and text files.</div>
          </div>
        )}
        {loadingHistory && (
          <div style={{ display:'flex', justifyContent:'center', padding:20 }}>
            <div style={{ width:20, height:20, border:'2px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
        {messages.map((msg,i) => <MessageBubble key={msg.id||i} message={msg} />)}
        {loading && (
          <div style={{ display:'flex', gap:10, padding:'8px 0', maxWidth:780, margin:'0 auto', width:'100%' }}>
            <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, background:'linear-gradient(135deg,var(--accent),var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✦</div>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, borderTopLeftRadius:4, padding:'12px 16px', display:'flex', gap:5, alignItems:'center' }}>
              {[0,0.2,0.4].map((d,i)=><span key={i} style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent)', animation:`bounce 1.2s ${d}s infinite`, display:'inline-block' }}/>)}
              <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ padding:'10px 16px 20px', flexShrink:0 }}>
        {pendingFiles.filter(Boolean).length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8, maxWidth:780, margin:'0 auto 8px' }}>
            {pendingFiles.filter(Boolean).map((f,i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'4px 8px 4px 10px', fontSize:12.5, color:'var(--text)' }}>
                <span>{f.icon}</span>
                <span style={{ maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                <button onClick={()=>setPendingFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:'var(--text3)', fontSize:14, lineHeight:1, padding:'0 2px', transition:'color .12s' }} onMouseEnter={e=>e.currentTarget.style.color='#fca5a5'} onMouseLeave={e=>e.currentTarget.style.color='var(--text3)'}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ maxWidth:780, margin:'0 auto', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'10px 10px 10px 14px', display:'flex', alignItems:'flex-end', gap:8, transition:'border-color .2s, box-shadow .2s' }}
          onFocusCapture={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.boxShadow='0 0 0 3px var(--accent-glow)'}}
          onBlurCapture={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='none'}}>
          <button onClick={()=>fileInputRef.current?.click()} title="Attach file"
            style={{ width:32, height:32, borderRadius:8, background:'none', border:'1px solid var(--border)', color:'var(--text2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2, transition:'all .15s' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)'}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,.txt" style={{ display:'none' }} onChange={handleFileSelect}/>
          <textarea ref={inputRef} value={input}
            onChange={e=>{setInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}}
            placeholder="Message AI Assistant…  (Shift+Enter for new line)" rows={1}
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontSize:14, resize:'none', maxHeight:160, lineHeight:1.5, fontFamily:'var(--font)' }}/>
          <button onClick={sendMessage} disabled={loading||(!input.trim()&&pendingFiles.filter(Boolean).length===0)}
            style={{ width:34, height:34, borderRadius:10, flexShrink:0, background:loading||(!input.trim()&&pendingFiles.filter(Boolean).length===0)?'var(--border)':'linear-gradient(135deg,var(--accent),var(--accent2))', border:'none', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div style={{ textAlign:'center', fontSize:11.5, color:'var(--text3)', marginTop:8 }}>Supports JPG, PNG, PDF, DOCX, TXT · AI can make mistakes</div>
      </div>
    </div>
  )
}
