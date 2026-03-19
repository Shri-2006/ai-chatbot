import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { supabase } from '../lib/supabase'
import MessageBubble from './MessageBubble'

const API_URL = '/api/chat'

const MODELS = [
  // Claude 4.6
  { id:'claude-46-sonnet',      label:'Sonnet 4.6',          desc:'Latest · Balanced',        color:'#4e7fff', group:'Claude 4.6'   },
  { id:'claude-46-opus',        label:'Opus 4.6',            desc:'Latest · Most powerful',   color:'#a855f7', group:'Claude 4.6'   },
  // Claude 4.5
  { id:'claude-45-haiku',       label:'Haiku 4.5',           desc:'Fast & cheap',             color:'#22c55e', group:'Claude 4.5'   },
  { id:'claude-45-sonnet',      label:'Sonnet 4.5',          desc:'Balanced',                 color:'#60a5fa', group:'Claude 4.5'   },
  { id:'claude-45-opus',        label:'Opus 4.5',            desc:'Most powerful',            color:'#c084fc', group:'Claude 4.5'   },
  // Claude 3.x — deprecated
  //{ id:'claude-37-sonnet',     label:'Sonnet 3.7',          desc:'Extended thinking',        color:'#f59e0b', group:'Claude 3' },
  // OpenAI — o-series reasoning
  { id:'o1',                   label:'o1',                  desc:'Advanced reasoning',       color:'#0ea5e9', group:'OpenAI'   },
  { id:'o3',                   label:'o3',                  desc:'Most powerful reasoning',  color:'#38bdf8', group:'OpenAI'   },
  { id:'o3-mini',              label:'o3 Mini',             desc:'Efficient reasoning',      color:'#7dd3fc', group:'OpenAI'   },
  { id:'o4-mini',              label:'o4 Mini',             desc:'Latest reasoning',         color:'#bae6fd', group:'OpenAI'   },
  // OpenAI — GPT
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
  'image/jpeg':'🖼️', 'image/png':'🖼️',
  'application/pdf':'📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'📝',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'📊',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':'📑',
  'text/plain':'📃', 'text/markdown':'📃', 'text/html':'🌐', 'text/csv':'📊',
  'text/x-python':'🐍', 'text/javascript':'📜', 'text/typescript':'📜',
  'text/x-java':'☕', 'text/x-c':'⚙️', 'text/x-cpp':'⚙️',
}

function getFileIcon(file) {
  if (FILE_ICONS[file.type]) return FILE_ICONS[file.type]
  const ext = file.name.split('.').pop()?.toLowerCase()
  const extIcons = { py:'🐍', js:'📜', ts:'📜', jsx:'📜', tsx:'📜', java:'☕', cpp:'⚙️', c:'⚙️', cs:'⚙️', go:'🔵', rs:'🦀', rb:'💎', php:'🐘', swift:'🍎', kt:'🎯', r:'📊', sql:'🗄️', sh:'💻', md:'📃', html:'🌐', css:'🎨', json:'📋', xml:'📋', yaml:'📋', csv:'📊' }
  return extIcons[ext] || '📎'
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
  const icon = getFileIcon(file)
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    const base64 = await toBase64(file)
    return { name:file.name, icon, fileType:'image', contentBlock:{ type:'image', source:{ type:'base64', media_type:file.type, data:base64 } } }
  }
  if (file.type === 'application/pdf') {
    const text = await extractPdfText(file)
    if (!text.trim()) throw new Error('Could not extract text from PDF. It may be a scanned image-based PDF.')
    // No truncation — full text is stored in RAG (Supabase chunks)
    // Only send a summary/preview inline to avoid payload limits
    const fullText = text.trim()
    const INLINE_PREVIEW = 2000
    const preview = fullText.length > INLINE_PREVIEW
      ? fullText.slice(0, INLINE_PREVIEW) + `\n\n[Document continues — ${fullText.length.toLocaleString()} total chars stored in knowledge base for retrieval]`
      : fullText
    return { name:file.name, icon, fileType:'pdf', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${preview}` }, fullText }
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { name:file.name, icon, fileType:'docx', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${result.value.trim()}` } }
  }
  // CSV
  if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
    const text = await file.text()
    return { name:file.name, icon, fileType:'csv', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${text.trim()}` } }
  }
  // XLSX — use SheetJS from package
  if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.endsWith('.xlsx')) {
    const XLSX = await import('xlsx')
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const sheets = wb.SheetNames.map(name => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
      return `[Sheet: ${name}]\n${csv}`
    }).join('\n\n')
    return { name:file.name, icon, fileType:'xlsx', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${sheets.trim()}` } }
  }
  // PPTX — not supported without jszip package
  if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || file.name.endsWith('.pptx')) {
    throw new Error('PPTX files are not currently supported. Please convert to PDF or TXT first.')
  }
  if (file.type === 'text/plain' || file.type === 'text/markdown' || file.type === 'text/html' ||
      file.type === 'text/csv' || file.type.startsWith('text/')) {
    return { name:file.name, icon, fileType:'txt', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${await file.text()}` } }
  }
  // Code files and other text-based files by extension
  const codeExts = ['py','js','ts','jsx','tsx','java','cpp','c','cs','go','rs','rb','php','swift','kt','r','sql','sh','json','xml','yaml','yml','css','md','html']
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (codeExts.includes(ext)) {
    return { name:file.name, icon, fileType:'code', contentBlock:{ type:'text', text:`[Contents of ${file.name}]:\n${await file.text()}` } }
  }
  throw new Error('Unsupported file type')
}


// Separate memoized component so typing doesn't re-render the message list
const InputBar = memo(function InputBar({ onSend, disabled }) {
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files); e.target.value = ''
    if (pendingFiles.filter(Boolean).length + files.length > 5) {
      alert('Maximum 5 files at a time.')
      return
    }
    for (const file of files) {
      if (file.size > 20*1024*1024) { alert(`${file.name} is too large (max 20MB)`); continue }
      try { setPendingFiles(prev => [...prev, null]); const p = await processFile(file); setPendingFiles(prev => [...prev.slice(0,-1), p]) }
      catch(err) { setPendingFiles(prev => prev.slice(0,-1)); alert(`Could not read ${file.name}: ${err.message}`) }
    }
  }

  function handleSend() {
    const text = input.trim()
    const files = [...pendingFiles].filter(Boolean)
    if (!text && files.length === 0) return
    onSend(text, files)
    setInput('')
    setPendingFiles([])
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div style={{ padding:'8px 10px 16px', flexShrink:0 }}>
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
      <div style={{ maxWidth:780, margin:'0 auto', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'8px 8px 8px 12px', display:'flex', alignItems:'flex-end', gap:6, transition:'border-color .2s, box-shadow .2s' }}
        onFocusCapture={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.boxShadow='0 0 0 3px var(--accent-glow)'}}
        onBlurCapture={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='none'}}>
        <button onClick={()=>fileInputRef.current?.click()} title="Attach file"
          style={{ width:32, height:32, borderRadius:8, background:'none', border:'1px solid var(--border)', color:'var(--text2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2, transition:'all .15s' }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.html,.py,.js,.ts,.jsx,.tsx,.java,.cpp,.c,.cs,.go,.rs,.rb,.php,.swift,.kt,.r,.sql,.sh,.json,.xml,.yaml,.yml,.css" style={{ display:'none' }} onChange={handleFileSelect}/>
        <textarea ref={inputRef} value={input}
          onChange={e=>{setInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'}}
          onKeyDown={handleKeyDown}
          placeholder="Message AI Assistant…  (Shift+Enter for new line)" rows={1}
          style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontSize:14, resize:'none', maxHeight:160, lineHeight:1.5, fontFamily:'var(--font)' }}/>
        <button onClick={handleSend} disabled={disabled}
          style={{ width:34, height:34, borderRadius:10, flexShrink:0, background:disabled?'var(--border)':'linear-gradient(135deg,var(--accent),var(--accent2))', border:'none', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div style={{ textAlign:'center', fontSize:11, color:'var(--text3)', marginTop:6 }}>JPG · PNG · PDF · DOCX · TXT · MD · CSV · XLSX · PPTX · HTML · Code files · AI can make mistakes</div>
    </div>
  )
})

export default function ChatWindow({ conversation, session, profile, sidebarOpen, onToggleSidebar, onUpdateConversation, onNewConversation, onSetActiveId }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [model, setModel] = useState('claude-46-sonnet')
  const [modelOpen, setModelOpen] = useState(false)
  const [memoryMode, setMemoryMode] = useState('summary')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [style, setStyle] = useState('default')
  const [styleOpen, setStyleOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const bottomRef = useRef(null)

  useEffect(() => {
    setLoading(false)
    if (!conversation) { setMessages([]); return }
    setLoadingHistory(true)
    supabase.from('messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending:true })
      .then(({ data }) => { if (data) setMessages(data); setLoadingHistory(false) })
    setModel(conversation.model || 'claude-46-sonnet')
    setMemoryMode(conversation.memory_mode || 'summary')
    setStyle(conversation.style || 'default')
  }, [conversation?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages])
  useEffect(() => { const close = () => setModelOpen(false); if (modelOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [modelOpen])
  useEffect(() => { const close = () => setMemoryOpen(false); if (memoryOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [memoryOpen])
  useEffect(() => { const close = () => setStyleOpen(false); if (styleOpen) window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [styleOpen])

  const sendMessage = useCallback(async function sendMessage(text, files) {
    if (!text && files.length === 0) return

    let convId = conversation?.id
    let isNewConversation = false
    if (!convId) {
      const newConvo = await onNewConversation(model)
      if (!newConvo) return
      convId = newConvo.id
      isNewConversation = true
    }

    setLoading(true)

    const displayContent = text || `[${files.map(f=>f.name).join(', ')}]`
    const fileRefs = files.map(f => ({ name:f.name, type:f.fileType, icon:f.icon }))

    const optimistic = { id:'temp-user', role:'user', content:displayContent, file_refs:fileRefs, created_at:new Date().toISOString() }
    setMessages(prev => [...prev, optimistic])

    const { data:savedUser } = await supabase.from('messages').insert({ conversation_id:convId, role:'user', content:displayContent, file_refs:fileRefs }).select().single()
    if (savedUser) setMessages(prev => prev.map(m => m.id==='temp-user' ? savedUser : m))

    // Auto-title on first message
    if (messages.length === 0 && text) {
      fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ messages:[{role:'user',content:text}], model:'claude-45-haiku',
          system_override:'Generate a very short title (3-5 words max) for this conversation. Reply with ONLY the title, no quotes.' })
      }).then(r=>r.text()).then(t=>{ try { const d=JSON.parse(t); if(d.reply) onUpdateConversation(convId,{title:d.reply.slice(0,60),model}) } catch{} })
    }

    // Only send last 5 messages when memory is on, 20 when off
    const HISTORY_LIMIT = memoryMode === 'off' ? 20 : 5
    const recentMessages = messages.filter(m=>m.id!=='temp-user').slice(-HISTORY_LIMIT)

    const apiMessages = recentMessages.map(m => {
      if (m.file_refs?.length > 0 && m.role === 'user') {
        return { role: m.role, content: `[Previously attached: ${m.file_refs.map(f=>f.name).join(', ')}]\n${m.content}` }
      }
      return { role: m.role, content: m.content }
    })
    apiMessages.push({ role:'user', content: files.length>0 ? [...files.map(f=>f.contentBlock), ...(text?[{type:'text',text}]:[])] : text })

    // ── RAG: ingest text-based files BEFORE calling chat so chunks exist ──
    const textFiles = files.filter(f => f.fileType !== 'image')
    if (textFiles.length > 0 && convId && session?.user?.id) {
      try {
        const ingestResp = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: convId,
            user_id: session.user.id,
            files: textFiles.map(f => ({
              name: f.name,
              text: f.contentBlock?.text || '',
            }))
          })
        })
        await ingestResp.json()
      } catch(err) {} // silent — don't block main chat
    }

    try {
      // Fetch current memory from Supabase
      let currentMemory = null
      if (memoryMode !== 'off' && convId) {
        const { data: convData } = await supabase.from('conversations').select('memory').eq('id', convId).single()
        currentMemory = convData?.memory || null
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages:            apiMessages,
          model,
          memory:              currentMemory,
          memory_mode:         memoryMode,
          attached_file_names: files.map(f => f.name),
          web_search_enabled:  webSearch,
          conversation_id:     convId,
          user_id:             session?.user?.id,
          style,
        })
      })

      const rawText = await res.text()
      let data
      try { data = JSON.parse(rawText) } catch {
        const reply = `⚠️ Server error: ${rawText.slice(0, 300)}`
        setMessages(prev => [...prev, { id:Date.now(), role:'assistant', content:reply, file_refs:[] }])
        setLoading(false)
        return
      }

      const reply = data.reply || data.error || 'Something went wrong.'
      const webSearched = data.web_searched || false
      const ragUsed     = data.rag_used     || false
      const memoryUsed  = data.memory_used  || false
      const styleUsed   = data.style_used   || 'default'
      const filesUsedInline = textFiles.length > 0
      const { data:saved } = await supabase.from('messages').insert({ conversation_id:convId, role:'assistant', content:reply, file_refs:[] }).select().single()
      const msgToAdd = saved || { id:Date.now(), role:'assistant', content:reply, file_refs:[] }
      if (webSearched)              msgToAdd.web_searched = true
      if (ragUsed || filesUsedInline) msgToAdd.rag_used  = true
      if (memoryUsed)               msgToAdd.memory_used = true
      if (styleUsed !== 'default')  msgToAdd.style_used  = styleUsed
      setMessages(prev => [...prev, msgToAdd])

      // Save updated memory back to Supabase
      if (data.new_memory && memoryMode !== 'off' && convId) {
        await supabase.from('conversations').update({ memory: data.new_memory, memory_mode: memoryMode }).eq('id', convId)
      }

      // Now safe to switch active conversation — response is complete
      if (isNewConversation) onSetActiveId(convId)

    } catch (err) {
      const msg = err?.message?.includes('Failed to fetch')
        ? '⚠️ Could not reach the server. Check your internet connection or try again.'
        : `⚠️ Error: ${err?.message || 'Something went wrong.'}`
      setMessages(prev => [...prev, { id:Date.now(), role:'assistant', content:msg, file_refs:[] }])
    }

    setLoading(false)
  }, [conversation, model, memoryMode, messages, onNewConversation, onSetActiveId, onUpdateConversation])

  const activeModel = MODELS.find(m=>m.id===model) || MODELS[0]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', height:'100vh', background:'var(--main-bg)', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'rgba(17,19,24,0.9)', backdropFilter:'blur(12px)', flexShrink:0, zIndex:10, flexWrap:'wrap', minHeight:56 }}>
        <button onClick={onToggleSidebar} style={{ background:'none', border:'none', color:'var(--text2)', padding:6, borderRadius:8, display:'flex', transition:'color .15s' }}
          onMouseEnter={e=>e.currentTarget.style.color='var(--text)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text2)'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>

        <div style={{ flex:1, fontSize:14, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>
          {conversation?.title || 'AI Assistant'}
        </div>

        {/* Web search toggle */}
        <button onClick={()=>setWebSearch(o=>!o)} title={webSearch ? 'Web search on' : 'Web search off'} style={{
          display:'flex', alignItems:'center', gap:5,
          background:'var(--surface)', border:`1px solid ${webSearch ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius:9, padding:'6px 10px', fontSize:12, fontWeight:500,
          color: webSearch ? 'var(--accent)' : 'var(--text2)',
          transition:'all .15s',
        }}
          onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
          onMouseLeave={e=>e.currentTarget.style.borderColor=webSearch?'var(--accent)':'var(--border)'}>
          🌐
          <span className="memory-label-text">{webSearch ? 'Search On' : 'Search Off'}</span>
        </button>


        {/* Style selector */}
        <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setStyleOpen(o=>!o)} style={{
            display:'flex', alignItems:'center', gap:6,
            background:'var(--surface)', border:`1px solid ${style!=='default'?'var(--accent)':'var(--border)'}`,
            borderRadius:9, padding:'6px 10px', color: style!=='default'?'var(--accent)':'var(--text)', fontSize:12, fontWeight:500,
            transition:'all .15s',
          }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor=style!=='default'?'var(--accent)':'var(--border)'}>
            <span style={{ fontSize:13 }}>🎨</span>
            <span className="memory-label-text">{{ default:'Default', eli5:'ELI5', technical:'Technical', concise:'Concise', tutor:'Tutor', creative:'Creative', business:'Business', debug:'Debug' }[style]}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)' }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {styleOpen && (
            <div style={{ position:'fixed', right:8, top:'auto', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:6, minWidth:220, zIndex:1000, boxShadow:'0 8px 30px rgba(0,0,0,0.4)' }}>
              {[
                { id:'default',   icon:'💬', label:'Default',   desc:'Standard responses' },
                { id:'eli5',      icon:'🧒', label:'ELI5',      desc:"Explain like I'm 5" },
                { id:'technical', icon:'🔬', label:'Technical', desc:'Expert-level detail' },
                { id:'concise',   icon:'⚡', label:'Concise',   desc:'Short and to the point' },
                { id:'tutor',     icon:'📚', label:'Tutor',     desc:'Step-by-step teaching' },
                { id:'creative',  icon:'🎨', label:'Creative',  desc:'Expressive and engaging' },
                { id:'business',  icon:'💼', label:'Business',  desc:'Professional and formal' },
                { id:'debug',     icon:'🐛', label:'Debug',     desc:'Code debugging focus' },
              ].map(s => (
                <button key={s.id} onClick={()=>{ setStyle(s.id); setStyleOpen(false) }} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10,
                  padding:'9px 12px', borderRadius:8, border:'none', textAlign:'left',
                  background: style===s.id ? 'var(--surface2)' : 'transparent', transition:'background .12s',
                }}
                  onMouseEnter={e=>{ if(style!==s.id) e.currentTarget.style.background='rgba(255,255,255,0.04)' }}
                  onMouseLeave={e=>{ if(style!==s.id) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:15 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.label}</div>
                    <div style={{ fontSize:11.5, color:'var(--text2)' }}>{s.desc}</div>
                  </div>
                  {style===s.id && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ marginLeft:'auto' }}><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              ))}
            </div>
          )}
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
            <span style={{ color:'var(--text2)', fontSize:11.5, display:'var(--label-display, inline)' }} className="memory-label">
              {memoryMode === 'off' ? 'No Memory' : memoryMode === 'summary' ? 'Summary' : 'Full Memory'}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)' }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {memoryOpen && (
            <div style={{
              position:'fixed', right:8, top:64,
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:12, padding:6, minWidth:220, maxWidth:'calc(100vw - 16px)', zIndex:1000,
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
          <button onClick={()=>setModelOpen(o=>!o)} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:'6px 10px', color:'var(--text)', fontSize:13, fontWeight:500, transition:'border-color .15s', whiteSpace:'nowrap' }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:activeModel.color, flexShrink:0 }}/>
            <span className="model-label-text">{activeModel.label}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--text2)', flexShrink:0 }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {modelOpen && (
            <div style={{ position:'fixed', right:8, top:64, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:6, minWidth:220, maxWidth:'calc(100vw - 16px)', zIndex:1000, boxShadow:'0 8px 30px rgba(0,0,0,0.5)', maxHeight:'70vh', overflowY:'auto' }}>
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
          <div style={{ display:'flex', gap:10, maxWidth:780, margin:'0 auto', width:'100%', padding:'0 4px' }}>
            <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, background:'linear-gradient(135deg,var(--accent),var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✦</div>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, borderTopLeftRadius:4, padding:'12px 16px', display:'flex', gap:5, alignItems:'center' }}>
              {[0,0.2,0.4].map((d,i)=><span key={i} style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent)', animation:`bounce 1.2s ${d}s infinite`, display:'inline-block' }}/>)}
              <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <InputBar onSend={sendMessage} disabled={loading} />
    </div>
  )
}
