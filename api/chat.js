/**
 * Vercel Serverless Function — /api/chat
 * SAP AI Core · Memory · RAG · Hybrid Web Search (Tavily → Exa → SearXNG → DDG)
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

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

const MODELS = {
  'claude-46-sonnet':     { sap: 'anthropic--claude-4.6-sonnet',       display: 'Claude Sonnet 4.6',     version: '1'  },
  'claude-46-opus':       { sap: 'anthropic--claude-4.6-opus',         display: 'Claude Opus 4.6',       version: '1'  },
  'claude-45-haiku':      { sap: 'anthropic--claude-4.5-haiku',        display: 'Claude Haiku 4.5',      version: '1'  },
  'claude-45-sonnet':     { sap: 'anthropic--claude-4.5-sonnet',       display: 'Claude Sonnet 4.5',     version: '1'  },
  'claude-45-opus':       { sap: 'anthropic--claude-4.5-opus',         display: 'Claude Opus 4.5',       version: '1'  },
  // Claude 3.x — deprecated
  //'claude-37-sonnet':   { sap: 'anthropic--claude-3.7-sonnet',       display: 'Claude Sonnet 3.7',     version: '1'  },
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

async function callSAP(sapModelName, version, noTemp, messages, system) {
  const apiUrl        = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'
  const deploymentId  = process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID
  const token         = await getSapToken()

  const history   = messages.slice(0, -1).map(m => ({
    role:    m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
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
            { role: 'user',   content: '{{?user_input}}' }
          ]
        },
        llm_module_config: {
          model_name: sapModelName,
          ...(version ? { model_version: version } : {}),
          model_params: {
            max_tokens: 4096,
            ...(noTemp ? {} : { temperature: 0.7 }),
          }
        }
      }
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
  if (!resp.ok) throw new Error(`SAP error ${resp.status}: ${rawText.slice(0, 400)}`)
  let result
  try { result = JSON.parse(rawText) } catch { throw new Error(`SAP returned invalid JSON: ${rawText.slice(0, 200)}`) }
  return (
    result.orchestration_result?.choices?.[0]?.message?.content ||
    result.module_results?.llm?.choices?.[0]?.message?.content  ||
    'No response received.'
  )
}

// ─── RAG: Search stored document chunks ──────────────────────────────────────

async function searchChunks(conversationId, query) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return null

  try {
    const terms = query
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 2)

    if (!terms.length) return null

    // Full-text search — OR matching for broader results
    const searchQuery = terms.join(' | ')
    const ftsUrl = `${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversationId}&search_vector=fts(english).${encodeURIComponent(searchQuery)}&order=chunk_index.asc&limit=6`
    const ftsResp = await fetch(ftsUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    })

    if (!ftsResp.ok) return null
    const chunks = await ftsResp.json()

    // Only return results if FTS actually found relevant chunks — NO fallback
    // This prevents irrelevant document content being injected into unrelated queries
    if (!chunks?.length) return null

    const byFile = {}
    for (const chunk of chunks) {
      if (!byFile[chunk.file_name]) byFile[chunk.file_name] = []
      byFile[chunk.file_name].push(chunk.content)
    }

    return Object.entries(byFile).map(([file, contents]) =>
      `[From ${file}]:\n${contents.join('\n---\n')}`
    ).join('\n\n')

  } catch {
    return null
  }
}

async function hasStoredChunks(conversationId) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return false
  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversationId}&limit=1`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    )
    if (!resp.ok) return false
    const data = await resp.json()
    return data?.length > 0
  } catch {
    return false
  }
}

// ─── Web Search: Tavily → Exa → SearXNG → DuckDuckGo ────────────────────────

async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        apiKey,
        query,
        search_depth:   'basic',
        max_results:    5,
        include_answer: true,
      })
    })
    if (!resp.ok) return null
    const data = await resp.json()

    const results = []
    if (data.answer) results.push(`Summary: ${data.answer}`)
    if (data.results?.length) {
      const items = data.results.slice(0, 4).map(r =>
        `- **${r.title}**: ${r.content?.slice(0, 200)}...\n  Source: ${r.url}`
      )
      results.push(items.join('\n'))
    }
    return results.length ? { text: results.join('\n\n'), source: 'Tavily' } : null
  } catch {
    return null
  }
}

async function searchExa(query) {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) return null
  try {
    const resp = await fetch('https://api.exa.ai/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query,
        num_results:     5,
        use_autoprompt:  true,
        contents:        { text: { max_characters: 500 } }
      })
    })
    if (!resp.ok) return null
    const data = await resp.json()

    if (!data.results?.length) return null
    const items = data.results.slice(0, 4).map(r =>
      `- **${r.title}**: ${r.text?.slice(0, 200)}...\n  Source: ${r.url}`
    )
    return { text: items.join('\n'), source: 'Exa' }
  } catch {
    return null
  }
}

async function searchSearXNG(query) {
  const baseUrl = process.env.SEARXNG_URL
  if (!baseUrl) return null
  try {
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo`
    const resp = await fetch(url, { headers: { 'User-Agent': 'AI-Chatbot/1.0' } })
    if (!resp.ok) return null
    const data = await resp.json()

    if (!data.results?.length) return null
    const items = data.results.slice(0, 4).map(r =>
      `- **${r.title}**: ${r.content?.slice(0, 200)}...\n  Source: ${r.url}`
    )
    return { text: items.join('\n'), source: 'SearXNG' }
  } catch {
    return null
  }
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 AI-Chatbot/1.0' } })
    if (!resp.ok) return null
    const data = await resp.json()

    const results = []
    if (data.Answer)       results.push(`Direct answer: ${data.Answer}`)
    if (data.AbstractText) results.push(`${data.AbstractSource}: ${data.AbstractText}`)
    if (data.RelatedTopics?.length) {
      const topics = data.RelatedTopics.filter(t => t.Text).slice(0, 3).map(t => `- ${t.Text}`)
      if (topics.length) results.push('Related:\n' + topics.join('\n'))
    }
    return results.length ? { text: results.join('\n\n'), source: 'DuckDuckGo' } : null
  } catch {
    return null
  }
}

async function webSearch(query) {
  // Cascade: Tavily → Exa → SearXNG → DuckDuckGo
  return (
    await searchTavily(query)    ||
    await searchExa(query)       ||
    await searchSearXNG(query)   ||
    await searchDuckDuckGo(query)
  )
}

// ─── Search decision (keyword fast-path + Haiku fallback) ────────────────────

async function shouldSearch(userMessage, callSAPFn) {
  const msg = userMessage.toLowerCase()

  const searchPatterns = [
    /today|tonight|right now|current(ly)?|latest|recent|now/,
    /what('s| is) the (date|time|day|weather|price|score|news)/,
    /what happened|what's happening|is .* (happening|still|dead|alive|open|closed)/,
    /news|breaking|update|attack|war|election|crisis|disaster/,
    /stock|price|rate|cost|value|worth|market/,
    /who (is|won|leads|rules)/,
    /when (is|was|did|does|will)/,
    /score|match|game result|fixture/,
    /weather|forecast|temperature/,
    /release|launch|announce/,
  ]
  if (searchPatterns.some(p => p.test(msg))) return true

  const noSearchPatterns = [
    /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye)/,
    /how do (i|you|we) (code|write|fix|debug|build|create|make)/,
    /what is (a |an )?(function|variable|class|array|loop|algorithm)/,
    /explain|summarize|translate|rewrite|improve|fix (my|this|the)/,
  ]
  if (noSearchPatterns.some(p => p.test(msg))) return false

  // Ambiguous — ask Haiku
  const system = `You decide if a message needs a real-time web search. Reply ONLY "yes" or "no". Be generous — when in doubt say yes.
YES: current events, time-sensitive info, real people's current status, live data, recent releases.
NO: coding, math, concepts, file analysis, creative writing, stable historical facts.`
  try {
    const result = await callSAPFn(
      'anthropic--claude-4.5-haiku', '1', false,
      [{ role: 'user', content: `Search needed? "${userMessage}"` }],
      system
    )
    return result.trim().toLowerCase().startsWith('yes')
  } catch {
    return false
  }
}

// ─── Memory ──────────────────────────────────────────────────────────────────

async function updateMemory(existingMemory, userMessage, assistantReply, fileNames, mode) {
  const fileNote = fileNames?.length ? `\nFiles in this exchange: ${fileNames.join(', ')}` : ''

  const summarySystem = `You maintain a concise rolling summary of a conversation.
Update the summary to capture: main topics, key facts, files shared and what they contained, questions asked and answered, any ongoing tasks.
Be brief — aim for 200-400 words. Return ONLY the updated summary.
Current summary: ${existingMemory || '(none yet)'}`

  const fullSystem = `You maintain a detailed memory of a conversation.
Update it to include ALL important information: topics discussed, files shared with summaries, questions and full answers, code/analysis done, user context and goals, unresolved topics.
Be thorough — this replaces needing the full history. Return ONLY the updated memory.
Current memory: ${existingMemory || '(none yet)'}`

  const system = mode === 'full' ? fullSystem : summarySystem
  const messages = [{
    role: 'user',
    content: `Exchange to add:\nUSER: ${typeof userMessage === 'string' ? userMessage : '[files/content]'}${fileNote}\nASSISTANT: ${assistantReply}\n\nUpdate the memory.`
  }]

  try {
    return await callSAP('anthropic--claude-4.5-haiku', '1', false, messages, system)
  } catch {
    return existingMemory || ''
  }
}

// ─── System prompt ───────────────────────────────────────────────────────────

const buildSystem = (displayName, maker, memory, memoryMode, hasRag, webSearchEngine) => {
  const base = `You are ${displayName}, an AI assistant made by ${maker}, running via SAP AI Core.

CAPABILITIES YOU HAVE IN THIS DEPLOYMENT:
- Web search: ENABLED (${webSearchEngine || 'DuckDuckGo fallback'}). When you see "WEB SEARCH RESULTS" in your context, that information came from a live web search. Tell the user when you are using web search results.
- Document knowledge base (RAG): ${hasRag ? 'ENABLED. When you see "KNOWLEDGE BASE" in your context, that content was retrieved from documents the user uploaded. Tell the user when you are drawing from their uploaded documents.' : 'No documents have been uploaded to this conversation yet.'}
- Conversation memory: ENABLED. Your memory of this conversation is maintained across messages.

If a user asks whether you have internet access, RAG, or memory — answer YES and explain how each works.

You specialize in:
1. General Q&A — answer questions clearly and concisely
2. Coding help — explain code in plain English, debug issues, write snippets step by step

When helping with code:
- Explain WHAT the code does and WHY, not just HOW
- Use simple language
- Break complex problems into small numbered steps
- Add comments explaining each important line

Keep responses clear, friendly, and thorough.`

  if (!memory || memoryMode === 'off') return base

  return `${base}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION MEMORY (${memoryMode === 'full' ? 'Detailed' : 'Summary'})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memory}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override, memory, memory_mode, attached_file_names, web_search_enabled, conversation_id } = req.body || {}
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' })

  const modelInfo    = MODELS[model] || MODELS[DEFAULT_MODEL_ID]
  const sapModelName = modelInfo.sap
  const displayName  = modelInfo.display
  const modelVersion = modelInfo.version
  const noTemp       = modelInfo.noTemp || false
  const memoryMode   = memory_mode || 'summary'

  const maker = sapModelName.startsWith('anthropic--') ? 'Anthropic' :
    (sapModelName.startsWith('gpt') || sapModelName.startsWith('o')) ? 'OpenAI' :
    sapModelName.startsWith('gemini') ? 'Google' :
    sapModelName.startsWith('mistralai') ? 'Mistral AI' :
    sapModelName.startsWith('amazon') ? 'Amazon' :
    sapModelName.startsWith('meta') ? 'Meta' : 'an AI provider'

  if (!process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID) {
    return res.status(500).json({ error: 'SAP_ORCHESTRATION_DEPLOYMENT_ID not set.' })
  }

  const HISTORY_LIMIT = memoryMode === 'off' ? 20 : 5
  const recentMessages = messages.slice(-HISTORY_LIMIT)

  try {
    // ── Web search ────────────────────────────────────────────────────────────
    let webResult   = null
    let searchQuery = null
    const webSearchOn = web_search_enabled !== false

    if (webSearchOn) {
      const lastUserMsg = messages[messages.length - 1]
      const userText = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : JSON.stringify(lastUserMsg?.content)

      const needsSearch = await shouldSearch(userText, callSAP)
      if (needsSearch) {
        searchQuery = userText
        webResult   = await webSearch(userText)
      }
    }

    // ── RAG ───────────────────────────────────────────────────────────────────
    let ragContext = null
    let hasRag     = false
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (conversation_id && serviceKey) {
        hasRag = await hasStoredChunks(conversation_id)
        if (hasRag) {
          const lastUserMsg = messages[messages.length - 1]
          const userText = typeof lastUserMsg?.content === 'string'
            ? lastUserMsg.content
            : JSON.stringify(lastUserMsg?.content || '')
          ragContext = await searchChunks(conversation_id, userText)
        }
      }
    } catch (ragErr) {
      console.error('RAG error (non-fatal):', ragErr.message)
    }

    // ── Build system prompt ───────────────────────────────────────────────────
    const webEngine = webResult?.source || (webSearchOn ? 'enabled' : 'disabled')
    let system = system_override || buildSystem(displayName, maker, memory, memoryMode, hasRag, webEngine)

    if (ragContext) {
      const MAX_RAG = 6000
      const capped = ragContext.length > MAX_RAG ? ragContext.slice(0, MAX_RAG) + '\n[truncated]' : ragContext
      system += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNOWLEDGE BASE (from uploaded files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${capped}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    }

    if (webResult) {
      system += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEB SEARCH RESULTS (${webResult.source}) — Query: "${searchQuery}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${webResult.text}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use these results. Always mention the source and include the URLs when referencing specific results.`
    }

    const reply = await callSAP(sapModelName, modelVersion, noTemp, recentMessages, system)

    let newMemory = memory || null
    if (memoryMode !== 'off') {
      const lastUserMsg = messages[messages.length - 1]
      newMemory = await updateMemory(memory || '', lastUserMsg?.content, reply, attached_file_names || [], memoryMode)
    }

    return res.status(200).json({
      reply,
      model_used:   sapModelName,
      new_memory:   newMemory,
      web_searched: !!webResult,
      web_source:   webResult?.source || null,
      rag_used:     !!ragContext,
    })

  } catch (err) {
    console.error('Chat error:', err.message, err.stack?.slice(0, 300))
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}