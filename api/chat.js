/**
 * Vercel Serverless Function — /api/chat
 * Full pipeline: Style → Memory (vector) → RAG (vector) → Search → Response
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

// ─── Token cache ──────────────────────────────────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 }

async function getSapToken() {
  const now = Date.now() / 1000
  if (tokenCache.token && now < tokenCache.expiresAt - 60) return tokenCache.token
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.SAP_CLIENT_ID,
    client_secret: process.env.SAP_CLIENT_SECRET,
  })
  const resp = await fetch(`${process.env.SAP_AUTH_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!resp.ok) throw new Error(`SAP auth failed: ${resp.status}`)
  const data = await resp.json()
  tokenCache.token     = data.access_token
  tokenCache.expiresAt = now + (data.expires_in || 3600)
  return tokenCache.token
}

// ─── Model registry ───────────────────────────────────────────────────────────
const MODELS = {
  'claude-46-sonnet':     { sap: 'anthropic--claude-4.6-sonnet',       display: 'Claude Sonnet 4.6',     version: '1'  },
  'claude-46-opus':       { sap: 'anthropic--claude-4.6-opus',         display: 'Claude Opus 4.6',       version: '1'  },
  'claude-45-haiku':      { sap: 'anthropic--claude-4.5-haiku',        display: 'Claude Haiku 4.5',      version: '1'  },
  'claude-45-sonnet':     { sap: 'anthropic--claude-4.5-sonnet',       display: 'Claude Sonnet 4.5',     version: '1'  },
  'claude-45-opus':       { sap: 'anthropic--claude-4.5-opus',         display: 'Claude Opus 4.5',       version: '1'  },
  'o1':                   { sap: 'o1',                                 display: 'o1',                    version: null, noTemp: true },
  'o3':                   { sap: 'o3',                                 display: 'o3',                    version: null, noTemp: true },
  'o3-mini':              { sap: 'o3-mini',                            display: 'o3 Mini',               version: null, noTemp: true },
  'o4-mini':              { sap: 'o4-mini',                            display: 'o4 Mini',               version: null, noTemp: true },
  'gpt-5':                { sap: 'gpt-5',                              display: 'GPT-5',                 version: null, noTemp: true },
  'gpt-5-mini':           { sap: 'gpt-5-mini',                        display: 'GPT-5 Mini',            version: null, noTemp: true },
  'gpt-4o':               { sap: 'gpt-4o',                            display: 'GPT-4o',                version: null },
  'gpt-4o-mini':          { sap: 'gpt-4o-mini',                       display: 'GPT-4o Mini',           version: null },
  'gpt-41':               { sap: 'gpt-4.1',                           display: 'GPT-4.1',               version: null },
  'gpt-41-mini':          { sap: 'gpt-4.1-mini',                      display: 'GPT-4.1 Mini',          version: null },
  'gpt-41-nano':          { sap: 'gpt-4.1-nano',                      display: 'GPT-4.1 Nano',          version: null },
  'gemini-25-pro':        { sap: 'gemini-2.5-pro',                    display: 'Gemini 2.5 Pro',        version: null },
  'gemini-25-flash':      { sap: 'gemini-2.5-flash',                  display: 'Gemini 2.5 Flash',      version: null },
  'gemini-25-flash-lite': { sap: 'gemini-2.5-flash-lite',             display: 'Gemini 2.5 Flash Lite', version: null },
  'gemini-20-flash':      { sap: 'gemini-2.0-flash',                  display: 'Gemini 2.0 Flash',      version: null },
  'gemini-20-flash-lite': { sap: 'gemini-2.0-flash-lite',             display: 'Gemini 2.0 Flash Lite', version: null },
}
const DEFAULT_MODEL_ID = 'claude-46-sonnet'
const HAIKU            = 'anthropic--claude-4.5-haiku'
const FAST_MODEL       = 'gemini-2.5-flash-lite'  // For memory compression

// ─── Response style templates (Phase 4) ──────────────────────────────────────
const STYLES = {
  default:     '',
  eli5:        'Explain everything as if talking to a 10-year-old. Use simple words, short sentences, and fun analogies.',
  technical:   'Respond in a highly technical, precise manner. Use correct terminology, assume expert-level knowledge, include implementation details.',
  concise:     'Be extremely concise. Use bullet points. No filler words. Maximum 5 sentences per answer.',
  tutor:       'Act as a patient tutor. Break concepts into steps, check understanding, give examples, encourage questions.',
  creative:    'Be creative, expressive, and engaging. Use vivid language, metaphors, and storytelling where appropriate.',
  business:    'Use professional business language. Be formal, structured, and results-oriented.',
  debug:       'You are a debugging assistant. Identify root causes, explain what went wrong, provide step-by-step fixes with code examples.',
}

// ─── Core SAP call ────────────────────────────────────────────────────────────
async function callSAP(sapModelName, version, noTemp, messages, system) {
  const apiUrl        = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'
  const deploymentId  = process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID
  const token         = await getSapToken()

  const history   = messages.slice(0, -1).map(m => ({
    role:    m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }))
  const lastMsg   = messages[messages.length - 1]
  const userInput = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

  const payload = {
    orchestration_config: {
      module_configurations: {
        templating_module_config: {
          template: [
            { role: 'system', content: system },
            { role: 'user',   content: '{{?user_input}}' },
          ],
        },
        llm_module_config: {
          model_name: sapModelName,
          ...(version ? { model_version: version } : {}),
          model_params: { max_tokens: 4096, ...(noTemp ? {} : { temperature: 0.7 }) },
        },
      },
    },
    input_params:     { user_input: userInput },
    messages_history: history,
  }

  const resp    = await fetch(`${apiUrl}/v2/inference/deployments/${deploymentId}/completion`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'AI-Resource-Group': resourceGroup, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  const rawText = await resp.text()
  if (!resp.ok) throw new Error(`SAP error ${resp.status}: ${rawText.slice(0, 2000)}`)
  let result
  try { result = JSON.parse(rawText) } catch { throw new Error(`SAP returned invalid JSON: ${rawText.slice(0, 200)}`) }
  return (
    result.orchestration_result?.choices?.[0]?.message?.content ||
    result.module_results?.llm?.choices?.[0]?.message?.content  ||
    'No response received.'
  )
}

// ─── HuggingFace embeddings ───────────────────────────────────────────────────
async function getEmbedding(text) {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  if (!apiKey) return null
  try {
    const resp = await fetch(
      'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs: text.slice(0, 512), options: { wait_for_model: true } }),
      }
    )
    if (!resp.ok) return null
    const data = await resp.json()
    return Array.isArray(data[0]) ? data[0] : data
  } catch { return null }
}

// ─── Supabase helper ──────────────────────────────────────────────────────────
function sbHeaders(key) {
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// ─── Vector RAG search (Phase 7) ─────────────────────────────────────────────
async function searchChunksVector(conversationId, query) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return null

  try {
    const embedding = await getEmbedding(query)
    if (!embedding) {
      // Fallback to keyword search if embedding fails
      return await searchChunksKeyword(conversationId, query)
    }

    const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/match_document_chunks`, {
      method:  'POST',
      headers: sbHeaders(supabaseKey),
      body:    JSON.stringify({
        query_embedding:       embedding,
        match_conversation_id: conversationId,
        match_count:           6,
        match_threshold:       0.25,
      }),
    })
    if (!resp.ok) return await searchChunksKeyword(conversationId, query)
    const chunks = await resp.json()
    if (!chunks?.length) return await searchChunksKeyword(conversationId, query)

    const byFile = {}
    for (const chunk of chunks) {
      if (!byFile[chunk.file_name]) byFile[chunk.file_name] = []
      byFile[chunk.file_name].push(`${chunk.content} (relevance: ${Math.round((chunk.similarity || 0) * 100)}%)`)
    }
    return Object.entries(byFile).map(([file, contents]) =>
      `[From ${file}]:\n${contents.join('\n---\n')}`
    ).join('\n\n')
  } catch { return null }
}

// Keyword fallback
async function searchChunksKeyword(conversationId, query) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return null
  try {
    const terms = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2)
    if (!terms.length) return null
    const searchQuery = terms.join(' | ')
    const url = `${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversationId}&search_vector=fts(english).${encodeURIComponent(searchQuery)}&order=chunk_index.asc&limit=6`
    const resp = await fetch(url, { headers: sbHeaders(supabaseKey) })
    if (!resp.ok) return null
    const chunks = await resp.json()
    if (!chunks?.length) return null
    const byFile = {}
    for (const chunk of chunks) {
      if (!byFile[chunk.file_name]) byFile[chunk.file_name] = []
      byFile[chunk.file_name].push(chunk.content)
    }
    return Object.entries(byFile).map(([file, contents]) =>
      `[From ${file}]:\n${contents.join('\n---\n')}`
    ).join('\n\n')
  } catch { return null }
}

async function hasStoredChunks(conversationId) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return false
  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversationId}&limit=1`,
      { headers: sbHeaders(supabaseKey) }
    )
    if (!resp.ok) return false
    const data = await resp.json()
    return data?.length > 0
  } catch { return false }
}

// ─── Vector memory (Phase 9) ──────────────────────────────────────────────────
async function searchMemoryVector(conversationId, query) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return null
  try {
    const embedding = await getEmbedding(query)
    if (!embedding) return null
    const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/match_memory_entries`, {
      method:  'POST',
      headers: sbHeaders(supabaseKey),
      body:    JSON.stringify({
        query_embedding:       embedding,
        match_conversation_id: conversationId,
        match_count:           5,
        match_threshold:       0.25,
      }),
    })
    if (!resp.ok) return null
    const entries = await resp.json()
    if (!entries?.length) return null
    return entries.map(e => e.content).join('\n\n')
  } catch { return null }
}

async function storeMemoryEntry(conversationId, userId, content, importance = 5) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return
  try {
    const embedding = await getEmbedding(content)
    await fetch(`${supabaseUrl}/rest/v1/memory_entries`, {
      method:  'POST',
      headers: { ...sbHeaders(supabaseKey), Prefer: 'return=minimal' },
      body:    JSON.stringify({ conversation_id: conversationId, user_id: userId, content, importance, embedding }),
    })
  } catch {}
}

async function getMemoryCount(conversationId) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return 0
  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/memory_entries?conversation_id=eq.${conversationId}&select=id`,
      { headers: { ...sbHeaders(supabaseKey), Prefer: 'count=exact' } }
    )
    const count = parseInt(resp.headers.get('content-range')?.split('/')[1] || '0')
    return count
  } catch { return 0 }
}

// ─── Memory compression (Phase 10) ───────────────────────────────────────────
async function compressMemoryIfNeeded(conversationId, userId) {
  try {
    const count = await getMemoryCount(conversationId)
    if (count < 20) return  // Only compress when there are many entries

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Get oldest entries
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/memory_entries?conversation_id=eq.${conversationId}&order=created_at.asc&limit=10`,
      { headers: sbHeaders(supabaseKey) }
    )
    if (!resp.ok) return
    const oldEntries = await resp.json()
    if (!oldEntries?.length) return

    // Compress using fast model
    const combined = oldEntries.map(e => e.content).join('\n')
    const compressed = await callSAP(
      FAST_MODEL, null, false,
      [{ role: 'user', content: `Compress these memory entries into 2-3 concise sentences preserving all important facts:\n\n${combined}` }],
      'You compress conversation memories. Return only the compressed summary, nothing else.'
    )

    // Delete old entries and store compressed version
    const ids = oldEntries.map(e => `id=eq.${e.id}`).join(',')
    for (const entry of oldEntries) {
      await fetch(
        `${supabaseUrl}/rest/v1/memory_entries?id=eq.${entry.id}`,
        { method: 'DELETE', headers: sbHeaders(supabaseKey) }
      )
    }
    await storeMemoryEntry(conversationId, userId, `[Compressed] ${compressed}`, 7)
  } catch {}
}

// ─── Web search ───────────────────────────────────────────────────────────────
async function searxngSearch(query) {
  const searxngUrl = process.env.SEARXNG_URL
  if (!searxngUrl) return await duckDuckGoSearch(query)
  try {
    const isNewsQuery  = /news|today|latest|breaking|current|happening/i.test(query)
    const isPriceQuery = /price|cost|worth|value|trading|bitcoin|btc|eth|stock|crypto|market/i.test(query)
    const categories   = isNewsQuery ? 'news,general' : 'general'
    const timeParam    = (isNewsQuery || isPriceQuery) ? '&time_range=day' : ''
    const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=${categories}&language=en${timeParam}`
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    if (!resp.ok) throw new Error(`SearXNG ${resp.status}`)
    const data = await resp.json()
    const results = (data.results || []).slice(0, 6)
    if (!results.length) return await duckDuckGoSearch(query)
    const formatted = results.map((r, i) => {
      const snippet = r.content?.trim() || '(no snippet)'
      const date    = r.publishedDate ? ` — ${r.publishedDate}` : ''
      return `[${i + 1}] **${r.title}**${date}\n${snippet}\nURL: ${r.url}`
    }).join('\n\n')
    return `${formatted}\n\nFull results: ${searxngUrl}/search?q=${encodeURIComponent(query)}`
  } catch { return await duckDuckGoSearch(query) }
}

async function duckDuckGoSearch(query) {
  try {
    const url  = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 AI-Chatbot/1.0' } })
    if (!resp.ok) return null
    const data = await resp.json()
    const results = []
    if (data.Answer)       results.push(`Direct answer: ${data.Answer}`)
    if (data.AbstractText) results.push(`${data.AbstractSource}: ${data.AbstractText}\nSource: ${data.AbstractURL || ''}`)
    if (data.Definition)   results.push(`Definition (${data.DefinitionSource}): ${data.Definition}`)
    const searchLink = `Search link: https://duckduckgo.com/?q=${encodeURIComponent(query)}`
    results.push(searchLink)
    return results.length > 1 ? results.join('\n\n') : null
  } catch { return null }
}

async function shouldSearch(userMessage, callSAPFn) {
  const msg = userMessage.toLowerCase()
  const searchPatterns = [
    /today|tonight|right now|current(ly)?|latest|recent|now/,
    /what('s| is) the (date|time|day|weather|price|score|news)/,
    /what happened|what's happening|is .* (happening|still|dead|alive|open|closed)/,
    /news|breaking|update|attack|war|election|crisis|disaster/,
    /stock|price|rate|cost|value|worth|market/,
    /who (is|won|leads|rules)/,
    /score|match|game result|fixture/,
    /weather|forecast|temperature/,
    /release|launch|announce/,
  ]
  if (searchPatterns.some(p => p.test(msg))) return true
  const noSearchPatterns = [
    /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye)/,
    /how do (i|you|we) (code|write|fix|debug|build|create|make)/,
    /what is (a |an )?(function|variable|class|array|loop|algorithm|recursion)/,
    /explain|summarize|translate|rewrite|improve/,
  ]
  if (noSearchPatterns.some(p => p.test(msg))) return false
  // Haiku fallback for ambiguous
  try {
    const result = await callSAPFn(
      HAIKU, '1', false,
      [{ role: 'user', content: `Does this need a web search to answer accurately? "${userMessage}" Reply only "yes" or "no".` }],
      'You decide if a query needs real-time web search. Respond ONLY with "yes" or "no". Be generous — when in doubt, say yes.'
    )
    return result.trim().toLowerCase().startsWith('yes')
  } catch { return false }
}

// ─── Memory update (rolling summary) ─────────────────────────────────────────
async function updateMemory(existingMemory, userMessage, assistantReply, fileNames, mode) {
  const fileNote = fileNames?.length ? `\nFiles: ${fileNames.join(', ')}` : ''
  const summarySystem = `Maintain a concise rolling summary (200-400 words max). Capture: topics, facts, files, Q&A, tasks. Return ONLY the updated summary.\nCurrent: ${existingMemory || '(none)'}`
  const fullSystem    = `Maintain a detailed memory. Include all topics, files, Q&A, code, user context, unresolved items. Return ONLY the updated memory.\nCurrent: ${existingMemory || '(none)'}`
  const messages = [{ role: 'user', content: `USER: ${typeof userMessage === 'string' ? userMessage : '[files]'}${fileNote}\nASSISTANT: ${assistantReply}\n\nUpdate memory.` }]
  try { return await callSAP(HAIKU, '1', false, messages, mode === 'full' ? fullSystem : summarySystem) }
  catch { return existingMemory || '' }
}

// ─── Identity block ───────────────────────────────────────────────────────────
function buildIdentityBlock(displayName, sapModelName, maker) {
  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are ${displayName}, made by ${maker}, running via SAP AI Core.
Today: ${dateStr} | Time: ${timeStr}
Model ID: ${sapModelName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystem({ displayName, sapModelName, maker, memory, memoryMode, style, ragContext, webContext, webQuery, memoryContext }) {
  const identity = buildIdentityBlock(displayName, sapModelName, maker)
  const styleBlock = style && STYLES[style] ? `\nRESPONSE STYLE: ${STYLES[style]}\n` : ''

  const base = `${identity}${styleBlock}
You specialize in general Q&A, coding help, document analysis, and creative tasks.
When using code: explain WHAT, WHY, and HOW. Break into steps. Add comments.
Keep responses clear, friendly, and thorough.

Capabilities active in this session:
• Web search (SearXNG + DuckDuckGo fallback) — activates automatically for current info
• RAG knowledge base — documents you upload are chunked and searched with vector similarity
• Conversation memory — key facts are stored and retrieved across your session`

  const memoryBlock = memoryContext ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RELEVANT MEMORY (vector retrieved)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memoryContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : (memory && memoryMode !== 'off') ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION MEMORY (${memoryMode === 'full' ? 'Detailed' : 'Summary'})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memory}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''

  const ragBlock = ragContext ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNOWLEDGE BASE (vector search results)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ragContext.slice(0, 6000)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''

  const webBlock = webContext ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEB SEARCH RESULTS
Query: "${webQuery}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${webContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cite sources and include URLs in your response.` : ''

  return `${base}${memoryBlock}${ragBlock}${webBlock}`
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const {
    messages, model, system_override,
    memory, memory_mode, attached_file_names,
    web_search_enabled, conversation_id, user_id,
    style,
  } = req.body || {}

  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' })

  const modelInfo    = MODELS[model] || MODELS[DEFAULT_MODEL_ID]
  const sapModelName = modelInfo.sap
  const displayName  = modelInfo.display
  const modelVersion = modelInfo.version
  const noTemp       = modelInfo.noTemp || false
  const memoryMode   = memory_mode || 'summary'

  const maker = sapModelName.startsWith('anthropic--') ? 'Anthropic' :
    (sapModelName.startsWith('gpt') || sapModelName.startsWith('o')) ? 'OpenAI' :
    sapModelName.startsWith('gemini') ? 'Google' : 'an AI provider'

  if (!process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID) {
    return res.status(500).json({ error: 'SAP_ORCHESTRATION_DEPLOYMENT_ID not set.' })
  }

  const HISTORY_LIMIT  = memoryMode === 'off' ? 20 : 5
  const recentMessages = messages.slice(-HISTORY_LIMIT)
  const lastUserMsg    = messages[messages.length - 1]
  const userText       = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''

  // ── PIPELINE ORDER: Memory → RAG → Search → Response ─────────────────────

  // 1. Vector memory retrieval
  let memoryContext = null
  if (conversation_id && memoryMode !== 'off') {
    try { memoryContext = await searchMemoryVector(conversation_id, userText) } catch {}
  }

  // 2. RAG vector search
  let ragContext = null
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (conversation_id && serviceKey) {
      const hasChunks = await hasStoredChunks(conversation_id)
      if (hasChunks) ragContext = await searchChunksVector(conversation_id, userText)
    }
  } catch (err) { console.error('RAG error:', err.message) }

  // 3. Web search
  let webContext  = null
  let webQuery    = null
  const webSearchOn = web_search_enabled !== false
  if (webSearchOn && userText) {
    try {
      const needsSearch = await shouldSearch(userText, callSAP)
      if (needsSearch) { webQuery = userText; webContext = await searxngSearch(userText) }
    } catch {}
  }

  // 4. Build system prompt
  const system = system_override || buildSystem({
    displayName, sapModelName, maker,
    memory, memoryMode, style: style || 'default',
    ragContext, webContext, webQuery, memoryContext,
  })

  try {
    const reply = await callSAP(sapModelName, modelVersion, noTemp, recentMessages, system)

    // Update rolling memory
    let newMemory = memory || null
    if (memoryMode !== 'off') {
      const rawMsg = messages[messages.length - 1]
      newMemory = await updateMemory(memory || '', rawMsg?.content, reply, attached_file_names || [], memoryMode)
    }

    // Store memory entry for vector retrieval (async, non-blocking)
    if (conversation_id && user_id && userText && memoryMode !== 'off') {
      storeMemoryEntry(conversation_id, user_id, `Q: ${userText.slice(0, 200)}\nA: ${reply.slice(0, 400)}`)
        .then(() => compressMemoryIfNeeded(conversation_id, user_id))
        .catch(() => {})
    }

    return res.status(200).json({
      reply,
      model_used:   sapModelName,
      new_memory:   newMemory,
      web_searched: !!webContext,
      rag_used:     !!ragContext,
      memory_used:  !!memoryContext,
      style_used:   style || 'default',
    })

  } catch (err) {
    console.error('Chat error:', err.message)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}