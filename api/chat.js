/**
 * Vercel Serverless Function — /api/chat
 *
 * NEW in this version:
 *  1. RAG relevance filtering  — memory is filtered to only chunks relevant
 *     to the current query before being injected (keyword overlap scoring)
 *  2. Web search + source links — uses Brave Search API when the query
 *     looks like it needs live info; model cites sources inline as [1][2]
 *     and a `sources` array is returned to the frontend
 *  3. AI self-awareness — system prompt tells the model exactly who it is,
 *     what stack it runs on, today's date, and its own capabilities
 *
 * New env var to add (optional but recommended):
 *   BRAVE_SEARCH_API_KEY  — free tier at https://api.search.brave.com
 *                           2,000 searches/month, no credit card needed
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

// ─────────────────────────────────────────────────────────
// SAP OAuth token (cached)
// ─────────────────────────────────────────────────────────
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
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  if (!resp.ok) throw new Error(`SAP auth failed: ${resp.status}`)
  const data = await resp.json()
  tokenCache.token     = data.access_token
  tokenCache.expiresAt = now + (data.expires_in || 3600)
  return tokenCache.token
}

// ─────────────────────────────────────────────────────────
// Model registry  (added maker + caps fields for self-awareness)
// ─────────────────────────────────────────────────────────
const MODELS = {
  'claude-46-sonnet':     { sap:'anthropic--claude-4.6-sonnet',     display:'Claude Sonnet 4.6',     version:'1',  maker:'Anthropic', noTemp:false, caps:'Latest balanced model — strong at reasoning, coding, and analysis.' },
  'claude-46-opus':       { sap:'anthropic--claude-4.6-opus',       display:'Claude Opus 4.6',       version:'1',  maker:'Anthropic', noTemp:false, caps:'Most powerful Claude model. Excels at complex research and multi-step tasks.' },
  'claude-45-haiku':      { sap:'anthropic--claude-4.5-haiku',      display:'Claude Haiku 4.5',      version:'1',  maker:'Anthropic', noTemp:false, caps:'Fastest Claude model. Best for quick answers and simple tasks.' },
  'claude-45-sonnet':     { sap:'anthropic--claude-4.5-sonnet',     display:'Claude Sonnet 4.5',     version:'1',  maker:'Anthropic', noTemp:false, caps:'Balanced speed and intelligence.' },
  'claude-45-opus':       { sap:'anthropic--claude-4.5-opus',       display:'Claude Opus 4.5',       version:'1',  maker:'Anthropic', noTemp:false, caps:'Highly capable for complex tasks.' },
  'claude-37-sonnet':     { sap:'anthropic--claude-3.7-sonnet',     display:'Claude Sonnet 3.7',     version:'1',  maker:'Anthropic', noTemp:false, caps:'Extended thinking capable.' },
  'gpt-5':                { sap:'gpt-5',                            display:'GPT-5',                 version:null, maker:'OpenAI',    noTemp:true,  caps:'OpenAI flagship model.' },
  'gpt-5-mini':           { sap:'gpt-5-mini',                      display:'GPT-5 Mini',            version:null, maker:'OpenAI',    noTemp:true,  caps:'Fast and efficient GPT-5 variant.' },
  'gpt-4o':               { sap:'gpt-4o',                          display:'GPT-4o',                version:null, maker:'OpenAI',    noTemp:false, caps:'Multimodal GPT-4 optimized model.' },
  'gpt-4o-mini':          { sap:'gpt-4o-mini',                     display:'GPT-4o Mini',           version:null, maker:'OpenAI',    noTemp:false, caps:'Fast and affordable.' },
  'gpt-41':               { sap:'gpt-4.1',                         display:'GPT-4.1',               version:null, maker:'OpenAI',    noTemp:false, caps:'Latest GPT-4 generation.' },
  'gpt-41-mini':          { sap:'gpt-4.1-mini',                    display:'GPT-4.1 Mini',          version:null, maker:'OpenAI',    noTemp:false, caps:'Efficient GPT-4.1 variant.' },
  'gpt-41-nano':          { sap:'gpt-4.1-nano',                    display:'GPT-4.1 Nano',          version:null, maker:'OpenAI',    noTemp:false, caps:'Most affordable OpenAI option.' },
  'gemini-25-pro':        { sap:'gemini-2.5-pro',                  display:'Gemini 2.5 Pro',        version:null, maker:'Google',    noTemp:false, caps:'Most powerful Gemini model.' },
  'gemini-25-flash':      { sap:'gemini-2.5-flash',                display:'Gemini 2.5 Flash',      version:null, maker:'Google',    noTemp:false, caps:'Fast and intelligent.' },
  'gemini-25-flash-lite': { sap:'gemini-2.5-flash-lite',           display:'Gemini 2.5 Flash Lite', version:null, maker:'Google',    noTemp:false, caps:'Lightweight and affordable.' },
  'gemini-20-flash':      { sap:'gemini-2.0-flash',                display:'Gemini 2.0 Flash',      version:null, maker:'Google',    noTemp:false, caps:'Reliable and fast.' },
  'gemini-20-flash-lite': { sap:'gemini-2.0-flash-lite',           display:'Gemini 2.0 Flash Lite', version:null, maker:'Google',    noTemp:false, caps:'Budget-friendly option.' },
}
const DEFAULT_MODEL_ID = 'claude-46-sonnet'

// ─────────────────────────────────────────────────────────
// FEATURE 1 — RAG RELEVANCE FILTERING
//
// Problem: the rolling memory can grow to include info from
// earlier topics that is completely unrelated to what the
// user is asking right now. Injecting all of it wastes
// context tokens and can confuse the model.
//
// Solution: split the memory into paragraph-level chunks,
// score each chunk against the current query using keyword
// overlap (TF-IDF-lite), and only inject chunks that
// score above a threshold.
// ─────────────────────────────────────────────────────────

// Common English words that carry no semantic meaning
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'shall','can','need','to','of','in','for','on','with','at','by','from',
  'up','about','into','through','before','after','above','below','between',
  'out','off','over','then','once','here','there','when','where','why',
  'how','all','both','each','few','more','most','other','some','such',
  'no','not','only','own','same','so','than','too','very','just','but',
  'if','or','because','as','until','while','and','i','you','he','she',
  'it','we','they','what','which','who','this','that','these','those',
  'said','also','back','use','get','make','like','know','good','new',
  'work','want','way','look','think','time','your','our','my','his','her',
])

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return new Set()
  return new Set(
    text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  )
}

function scoreChunkRelevance(chunk, queryKeywords) {
  if (!queryKeywords.size) return 0
  const chunkKeywords = extractKeywords(chunk)
  let hits = 0
  queryKeywords.forEach(k => { if (chunkKeywords.has(k)) hits++ })
  return hits / queryKeywords.size
}

/**
 * filterRelevantMemory
 * Returns only the memory paragraphs relevant to the current query.
 * Falls back to full memory if the query is too short to score against,
 * or if filtering would leave less than 2 chunks (avoids empty context).
 *
 * @param {string} memory      - Full rolling memory string
 * @param {string} currentQuery - Latest user message
 * @param {number} threshold   - Min relevance score (0–1, default 0.12)
 */
function filterRelevantMemory(memory, currentQuery, threshold = 0.12) {
  if (!memory || !currentQuery) return memory || ''

  const queryKeywords = extractKeywords(currentQuery)

  // Query too vague — skip filtering
  if (queryKeywords.size < 2) return memory

  // Split on blank lines (paragraph-level chunks)
  const chunks = memory.split(/\n{2,}/).map(c => c.trim()).filter(c => c.length > 20)

  // Memory is tiny — no point filtering
  if (chunks.length <= 2) return memory

  const scored = chunks
    .map(chunk => ({ chunk, score: scoreChunkRelevance(chunk, queryKeywords) }))
    .filter(s => s.score >= threshold)

  // Always keep at least 2 top chunks so context is never fully empty
  if (scored.length < 2) {
    return chunks
      .map(chunk => ({ chunk, score: scoreChunkRelevance(chunk, queryKeywords) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(s => s.chunk)
      .join('\n\n')
  }

  return scored.map(s => s.chunk).join('\n\n')
}

// ─────────────────────────────────────────────────────────
// FEATURE 2 — WEB SEARCH + SOURCE LINKS
//
// Uses Brave Search API (add BRAVE_SEARCH_API_KEY to env).
// Triggers automatically when the query matches patterns
// that suggest the user needs live / recent information.
// The model is instructed to cite results inline as [1][2]
// and a structured `sources` array is returned to the
// frontend alongside the reply so you can render link pills.
// ─────────────────────────────────────────────────────────

// Patterns that suggest a live-data query
const SEARCH_TRIGGERS = [
  /\b(latest|recent|current|today|right now|this week|this year|breaking|live)\b/i,
  /\b(news|update|release|announce|launch|happen)\b/i,
  /\b(price|cost|stock|rate|score|weather|forecast)\b/i,
  /\b(2024|2025|2026)\b/,
  /\b(who is|what is|when did|where is|how much|how many)\b/i,
]

function shouldSearch(query) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return false
  if (!query || typeof query !== 'string' || query.length < 8) return false
  return SEARCH_TRIGGERS.some(p => p.test(query))
}

/**
 * searchWeb — calls Brave Search API
 * Returns up to `maxResults` objects: { index, title, url, snippet }
 */
async function searchWeb(query, maxResults = 5) {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return []
  try {
    const url = `https://api.search.brave.com/res/v1/web/search` +
      `?q=${encodeURIComponent(query)}&count=${maxResults}&text_decorations=false&search_lang=en`
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.web?.results || []).slice(0, maxResults).map((r, i) => ({
      index:   i + 1,
      title:   r.title   || 'Untitled',
      url:     r.url     || '',
      snippet: r.description || '',
    }))
  } catch (err) {
    console.error('Web search failed:', err.message)
    return []
  }
}

/**
 * formatSearchContext — formats search results into the system prompt.
 * The model is told to cite by number and include a Sources block at the end.
 */
function formatSearchContext(results) {
  if (!results.length) return ''
  const lines = results.map(r =>
    `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
  ).join('\n\n')
  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEB SEARCH RESULTS (retrieved live for this query)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CITATION RULES:
- Cite search results inline using [1], [2], etc. immediately after the claim.
- At the very end of your response, add a "**Sources:**" section listing every
  source you cited, formatted exactly like:
    [1] Page Title — https://example.com
- Do NOT cite sources you did not actually use.
- If a result is outdated or irrelevant, ignore it and say so if asked.`
}

// ─────────────────────────────────────────────────────────
// FEATURE 3 — AI SELF-AWARENESS
//
// The model is given a detailed description of itself:
//  • Its own model name and maker
//  • Today's date (so it doesn't hallucinate the year)
//  • The tech stack it's running on
//  • Memory mode currently active
//  • Whether web search is available
//  • Its knowledge cutoff
// ─────────────────────────────────────────────────────────

function buildSystem(modelInfo, memory, memoryMode, searchContext = '') {
  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const timeStr = now.toUTCString().slice(17, 22) + ' UTC'
  const webStatus = process.env.BRAVE_SEARCH_API_KEY
    ? 'ACTIVE — cite results inline using [1][2] and add a Sources block at the end'
    : 'NOT configured in this deployment (add BRAVE_SEARCH_API_KEY to enable)'

  const selfAwareness = `
╔══════════════════════════════════════════════════════╗
║                  WHO YOU ARE                         ║
╚══════════════════════════════════════════════════════╝
Model:    ${modelInfo.display}
Maker:    ${modelInfo.maker}
About:    ${modelInfo.caps}

You are deployed inside a custom AI Assistant app with the following stack:
  • Frontend  : React + Vite, hosted on Vercel
  • Backend   : Vercel Serverless Function (/api/chat.js)
  • AI router : SAP AI Core Orchestration Service (proxies to ${modelInfo.maker})
  • Database  : Supabase (PostgreSQL) — stores auth, conversations, messages
  • Memory    : Rolling ${memoryMode === 'full' ? 'detailed' : 'summary'} memory, persisted per conversation

Today's date : ${dateStr}
Current time : ${timeStr}
Knowledge cutoff: early 2025 — for anything more recent, rely on the web search
                  results injected below (if present), or tell the user to verify.

Your capabilities in this app:
  ✓ Multi-turn chat with persistent cross-session memory
  ✓ File analysis — images (JPG/PNG), PDFs, DOCX, TXT (up to 20 MB)
  ✓ Code explanation, debugging, generation, with step-by-step comments
  ✓ Switching between ${Object.keys(MODELS).length} AI models mid-conversation
  ✓ Web search: ${webStatus}
  ✗ Cannot browse arbitrary URLs or execute code at runtime
  ✗ Cannot send emails, make calls, or take actions outside this chat

If a user asks "what model are you?", "who made you?", "what can you do?",
"what's today's date?", or similar — answer from the facts above, not from
generic training data. Be honest if something is outside your capabilities.
`.trim()

  let system = `${selfAwareness}

╔══════════════════════════════════════════════════════╗
║               ASSISTANT GUIDELINES                   ║
╚══════════════════════════════════════════════════════╝
1. General Q&A — answer clearly and concisely on any topic.
2. Coding help — always explain WHAT the code does and WHY, not just HOW.
   Break complex problems into numbered steps. Add inline comments.
3. File analysis — describe contents clearly; extract key information.
4. Source citation — when web search results are provided above, cite them
   using [n] inline and add a Sources block at the end of your reply.
5. Honesty — if information may be outdated or you're unsure, say so and
   direct the user to verify. Never invent URLs or citations.
6. Tone — clear, friendly, thorough. Assume the user may be a non-expert
   unless they demonstrate otherwise.`

  // Inject relevant memory (already filtered by filterRelevantMemory)
  if (memory && memoryMode !== 'off') {
    system += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION MEMORY (${memoryMode === 'full' ? 'Detailed' : 'Summary'} · filtered for relevance)
Use this to answer follow-up questions without needing the full history.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memory}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  }

  // Append web search context if present
  if (searchContext) system += searchContext

  return system
}

// ─────────────────────────────────────────────────────────
// SAP AI Core call (unchanged from original)
// ─────────────────────────────────────────────────────────
async function callSAP(sapModelName, version, noTemp, messages, system) {
  const apiUrl        = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'
  const deploymentId  = process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID
  const token         = await getSapToken()

  const history  = messages.slice(0, -1).map(m => ({
    role:    m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }))
  const lastMsg   = messages[messages.length - 1]
  const userInput = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : JSON.stringify(lastMsg.content)

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
          model_name:    sapModelName,
          ...(version ? { model_version: version } : {}),
          model_params: {
            max_tokens: 4096,
            ...(noTemp ? {} : { temperature: 0.7 }),
          },
        },
      },
    },
    input_params:     { user_input: userInput },
    messages_history: history,
  }

  const resp    = await fetch(`${apiUrl}/v2/inference/deployments/${deploymentId}/completion`, {
    method:  'POST',
    headers: {
      Authorization:     `Bearer ${token}`,
      'AI-Resource-Group': resourceGroup,
      'Content-Type':    'application/json',
    },
    body: JSON.stringify(payload),
  })
  const rawText = await resp.text()
  if (!resp.ok) throw new Error(`SAP error ${resp.status}: ${rawText.slice(0, 400)}`)
  let result
  try { result = JSON.parse(rawText) } catch { throw new Error(`SAP returned invalid JSON: ${rawText.slice(0, 200)}`) }
  return (
    result.orchestration_result?.choices?.[0]?.message?.content ||
    result.module_results?.llm?.choices?.[0]?.message?.content  ||
    'No response received.'
  )
}

// ─────────────────────────────────────────────────────────
// Memory update (unchanged from original)
// ─────────────────────────────────────────────────────────
async function updateMemory(existingMemory, userMessage, assistantReply, fileNames, mode) {
  const fileNote = fileNames?.length ? `\nFiles in this exchange: ${fileNames.join(', ')}` : ''

  const summarySystem = `You maintain a concise rolling summary of a conversation.
Update to capture: main topics, key facts, files and what they contained, Q&A, ongoing tasks.
Aim for 200-400 words max. Return ONLY the updated summary, no preamble.
Current summary: ${existingMemory || '(none yet)'}`

  const fullSystem = `You maintain a detailed memory of a conversation.
Include: topics, files, Q&A, code/analysis, user context, preferences, goals, unresolved items.
Be thorough. Return ONLY the updated memory.
Current memory: ${existingMemory || '(none yet)'}`

  const messages = [{
    role: 'user',
    content: `Exchange to add:\nUSER: ${typeof userMessage === 'string' ? userMessage : '[files/content]'}${fileNote}\nASSISTANT: ${assistantReply}\n\nUpdate the memory.`,
  }]
  try {
    return await callSAP('anthropic--claude-4.5-haiku', '1', false, messages, mode === 'full' ? fullSystem : summarySystem)
  } catch {
    return existingMemory || ''
  }
}

// ─────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override, memory, memory_mode, attached_file_names } = req.body || {}
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' })

  const modelInfo  = MODELS[model] || MODELS[DEFAULT_MODEL_ID]
  const memoryMode = memory_mode || 'summary'

  if (!process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID) {
    return res.status(500).json({ error: 'SAP_ORCHESTRATION_DEPLOYMENT_ID not set.' })
  }

  // Trim history based on memory mode
  const HISTORY_LIMIT  = memoryMode === 'off' ? 20 : 5
  const recentMessages = messages.slice(-HISTORY_LIMIT)

  // Extract the latest user text for relevance scoring and search detection
  const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'user')
  const userQuery   = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''

  // ── Step 1: Filter memory to relevant chunks only ──────
  const filteredMemory = (memoryMode !== 'off' && memory)
    ? filterRelevantMemory(memory, userQuery)
    : (memory || null)

  // ── Step 2: Web search (if triggered) ─────────────────
  let searchResults = []
  let searchContext = ''
  if (!system_override && shouldSearch(userQuery)) {
    searchResults = await searchWeb(userQuery)
    searchContext  = formatSearchContext(searchResults)
  }

  // ── Step 3: Build system prompt with self-awareness ────
  const system = system_override || buildSystem(modelInfo, filteredMemory, memoryMode, searchContext)

  try {
    const reply = await callSAP(
      modelInfo.sap,
      modelInfo.version,
      modelInfo.noTemp,
      recentMessages,
      system,
    )

    // ── Step 4: Update memory (async, non-blocking for perf) ──
    let newMemory = memory || null
    if (memoryMode !== 'off') {
      newMemory = await updateMemory(
        memory || '',
        lastUserMsg?.content,
        reply,
        attached_file_names || [],
        memoryMode,
      )
    }

    return res.status(200).json({
      reply,
      model_used:   modelInfo.sap,
      new_memory:   newMemory,
      // ↓ These two are NEW — use them in the frontend to show source pills
      sources:      searchResults,   // [{ index, title, url, snippet }]
      web_searched: searchResults.length > 0,
    })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
