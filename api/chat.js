/**
 * Vercel Serverless Function — /api/chat
 * Calls Claude via SAP AI Core Orchestration Service
 * Supports three memory modes: off | summary | full
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
  'claude-37-sonnet':     { sap: 'anthropic--claude-3.7-sonnet',       display: 'Claude Sonnet 3.7',     version: '1'  },
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


// ─── Web Search (DuckDuckGo) ──────────────────────────────────────────────────

async function duckDuckGoSearch(query) {
  try {
    // DuckDuckGo instant answer API — no key needed
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
    const resp = await fetch(url, { headers: { 'User-Agent': 'AI-Chatbot/1.0' } })
    if (!resp.ok) return null
    const data = await resp.json()

    const results = []

    // Abstract (main answer)
    if (data.AbstractText) {
      results.push(`**${data.AbstractSource}**: ${data.AbstractText}`)
    }

    // Answer (direct fact)
    if (data.Answer) {
      results.push(`**Direct answer**: ${data.Answer}`)
    }

    // Related topics
    if (data.RelatedTopics?.length) {
      const topics = data.RelatedTopics
        .filter(t => t.Text)
        .slice(0, 4)
        .map(t => `- ${t.Text}`)
      if (topics.length) results.push(`**Related:**\n${topics.join('\n')}`)
    }

    // Infobox
    if (data.Infobox?.content?.length) {
      const facts = data.Infobox.content
        .filter(f => f.label && f.value)
        .slice(0, 5)
        .map(f => `- ${f.label}: ${f.value}`)
      if (facts.length) results.push(`**Facts:**\n${facts.join('\n')}`)
    }

    if (!results.length) return null
    return results.join('\n\n')
  } catch {
    return null
  }
}

async function shouldSearch(userMessage, callSAP) {
  // Use Haiku to quickly decide if a web search would help
  const system = `You decide if a user message requires a real-time web search to answer accurately.
Respond with ONLY "yes" or "no".
Search is needed for: current events, news, prices, sports scores, weather, recent releases, 
"what is X trading at", "latest news on X", "who won X", "is X still Y", anything time-sensitive.
Search is NOT needed for: coding help, math, explanations of concepts, file analysis, 
historical facts, general knowledge that doesn't change, personal questions.`

  try {
    const result = await callSAP(
      'anthropic--claude-4.5-haiku', '1', false,
      [{ role: 'user', content: `Does this message need a web search? "${userMessage}"` }],
      system
    )
    return result.trim().toLowerCase().startsWith('yes')
  } catch {
    return false
  }
}

async function updateMemory(existingMemory, userMessage, assistantReply, fileNames, mode) {
  const fileNote = fileNames?.length ? `\nFiles in this exchange: ${fileNames.join(', ')}` : ''

  const summarySystem = `You maintain a concise rolling summary of a conversation.
Update the summary to capture: main topics, key facts learned, files shared and what they contained, questions asked and answered, any ongoing tasks.
Be brief — aim for 200-400 words max. Return ONLY the updated summary, no preamble.
Current summary: ${existingMemory || '(none yet)'}`

  const fullSystem = `You maintain a detailed memory of a conversation.
Update it to include ALL important information:
- Topics discussed and concepts explained in detail
- Files/documents shared with content summaries
- Questions asked and full answers given
- Code, analysis, or tasks completed
- User context, preferences, goals
- Unresolved questions or ongoing topics
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

const buildSystem = (displayName, maker, memory, memoryMode) => {
  const base = `You are ${displayName}, an AI assistant made by ${maker}, running via SAP AI Core.

You specialize in:
1. General Q&A — answer questions clearly and concisely on any topic
2. Coding help — explain code in plain English, debug issues, write snippets step by step

When helping with code:
- Always explain WHAT the code does and WHY, not just HOW
- Use simple language — assume the user may not be an expert
- Break complex problems into small numbered steps
- Add comments explaining each important line

When analyzing files: describe what you see clearly and extract key information.
Keep responses clear, friendly, and thorough.`

  if (!memory || memoryMode === 'off') return base

  return `${base}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION MEMORY (${memoryMode === 'full' ? 'Detailed' : 'Summary'})
Use this to answer follow-up questions without needing the full history.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memory}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override, memory, memory_mode, attached_file_names, web_search_enabled } = req.body || {}
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

  // How many recent messages to send depends on memory mode
  const HISTORY_LIMIT = memoryMode === 'off' ? 20 : 5
  const recentMessages = messages.slice(-HISTORY_LIMIT)

  const system = system_override || buildSystem(displayName, maker, memory, memoryMode)

  try {
    // ── Web search (hybrid — only when needed) ────────────────────────────────
    let webContext = null
    let searchQuery = null
    const webSearchOn = web_search_enabled !== false // default on

    if (webSearchOn) {
      const lastUserMsg = messages[messages.length - 1]
      const userText = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : JSON.stringify(lastUserMsg?.content)

      const needsSearch = await shouldSearch(userText, callSAP)
      if (needsSearch) {
        searchQuery = userText
        webContext = await duckDuckGoSearch(userText)
      }
    }

    // Inject web results into system prompt if available
    let finalSystem = system
    if (webContext) {
      finalSystem = `${system}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEB SEARCH RESULTS (DuckDuckGo)
Query: "${searchQuery}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${webContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use these results to inform your answer. Mention when information comes from a web search.`
    }

    const reply = await callSAP(sapModelName, modelVersion, noTemp, recentMessages, finalSystem)

    // Update memory if mode is not 'off'
    let newMemory = memory || null
    if (memoryMode !== 'off') {
      const lastUserMsg = messages[messages.length - 1]
      newMemory = await updateMemory(memory || '', lastUserMsg?.content, reply, attached_file_names || [], memoryMode)
    }

    return res.status(200).json({ reply, model_used: sapModelName, new_memory: newMemory, web_searched: !!webContext })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
