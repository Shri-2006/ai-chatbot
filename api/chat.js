/**
 * Vercel Serverless Function — /api/chat
 * Calls Claude via SAP AI Core Orchestration Service
 *
 * NEW:
 *   1. AI self-awareness  — model knows its name, today's date, version, and abilities
 *   2. RAG relevance gate — file chunks scored by Haiku before reaching the main model;
 *                           irrelevant chunks dropped (score < RELEVANCE_THRESHOLD)
 *   3. Source citations   — model instructed to tag every factual claim with [Source: …]
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

// ─── ① AI SELF-AWARENESS ─────────────────────────────────────────────────────
// Returns a rich identity block injected at the top of every system prompt.
// The model knows exactly who it is, what date it is, and what it can do.
function buildIdentityBlock(displayName, sapModelName, maker) {
  const now       = new Date()
  const dateStr   = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const timeStr   = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZoneName:'short' })

  const isAnthropic = sapModelName.startsWith('anthropic--')
  const isOpenAI    = sapModelName.startsWith('gpt') || sapModelName.startsWith('o')
  const isGoogle    = sapModelName.startsWith('gemini')

  const capabilities = [
    'General Q&A on any topic',
    'Code explanation, debugging, and generation',
    'Document analysis (PDF, DOCX, images, plain text)',
    'Math and logical reasoning',
    'Creative writing and editing',
    'Summarisation and translation',
    ...(isAnthropic ? ['Extended multi-turn reasoning', 'Vision (image understanding)'] : []),
    ...(isOpenAI    ? ['Vision (image understanding)', 'Function/tool calling']          : []),
    ...(isGoogle    ? ['Long-context documents (up to 1M tokens)', 'Vision']             : []),
  ]

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY & CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are ${displayName}, an AI assistant made by ${maker}.
You are running via SAP AI Core (SAP Orchestration Service).
Internal model ID: ${sapModelName}

Today's date : ${dateStr}
Current time : ${timeStr}

Your capabilities in this deployment:
${capabilities.map(c => `  • ${c}`).join('\n')}

Limitations you must acknowledge honestly when relevant:
  • Your training data has a knowledge cutoff; you may not know very recent events.
  • You cannot browse the internet in real time unless a web-search tool is provided.
  • You cannot execute code unless a code-execution tool is provided.
  • You do not retain memory between separate conversations unless memory context is injected.

When a user asks "who are you", "what can you do", "what model is this", or similar,
answer using the information above. Be direct and accurate.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ─── ② RAG RELEVANCE GATE ────────────────────────────────────────────────────
// Scores each file chunk against the user's query using Haiku (fast + cheap).
// Chunks with score < RELEVANCE_THRESHOLD are silently dropped from the context.
// Kept chunks are annotated with their source filename for citation.
const RELEVANCE_THRESHOLD = 0.30   // 0–1; tune up to reduce noise, down to be more inclusive
const MAX_CHUNK_CHARS     = 3000   // truncate each file block before scoring

// Parse [Contents of filename]: ... blocks from the message content string
function extractFileChunks(content) {
  if (typeof content !== 'string') return []
  const chunks = []
  const re = /\[Contents of ([^\]]+)\]:\n([\s\S]*?)(?=\n\[Contents of |\s*$)/g
  let match
  while ((match = re.exec(content)) !== null) {
    chunks.push({ filename: match[1].trim(), text: match[2].trim().slice(0, MAX_CHUNK_CHARS) })
  }
  return chunks
}

async function scoreRelevance(query, chunk) {
  // Returns a float 0–1 for how relevant `chunk.text` is to `query`
  const system = `You are a relevance scoring engine.
Given a user query and a document excerpt, output ONLY a JSON object like:
{"score": 0.85, "reason": "one short sentence"}
Score 0.0 = completely unrelated. Score 1.0 = directly answers the query.
Be strict: generic text that merely mentions the topic scores ≤ 0.4.
Only return the JSON object — no markdown fences, no extra text.`

  const prompt = `QUERY: ${query.slice(0, 300)}

DOCUMENT EXCERPT (from "${chunk.filename}"):
${chunk.text.slice(0, 1500)}

Score the relevance of this excerpt to the query.`

  try {
    const raw = await callSAP(
      'anthropic--claude-4.5-haiku', '1', false,
      [{ role: 'user', content: prompt }],
      system,
    )
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return { score: Math.max(0, Math.min(1, parsed.score || 0)), reason: parsed.reason || '' }
  } catch {
    return { score: 0.5, reason: 'scoring failed — included by default' }
  }
}

// Main RAG filter: takes the last user message (array or string), scores each
// [Contents of …] block, drops irrelevant ones, tags the rest with [Source: …].
async function filterAndTagFileContext(messages, userQuery) {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg.role !== 'user') return { messages, droppedSources: [], keptSources: [] }

  const contentStr = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : JSON.stringify(lastMsg.content)  // images / multipart — leave untouched

  const chunks = extractFileChunks(contentStr)
  if (chunks.length === 0) return { messages, droppedSources: [], keptSources: [] }

  // Score all chunks in parallel
  const scored = await Promise.all(
    chunks.map(async chunk => {
      const { score, reason } = await scoreRelevance(userQuery, chunk)
      return { ...chunk, score, reason }
    })
  )

  const kept    = scored.filter(c => c.score >= RELEVANCE_THRESHOLD)
  const dropped = scored.filter(c => c.score <  RELEVANCE_THRESHOLD)

  // Rebuild the user message: drop irrelevant blocks, tag kept ones with [Source:]
  let newContent = contentStr

  // Remove dropped chunks entirely
  for (const chunk of dropped) {
    const escapedName = chunk.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `\\[Contents of ${escapedName}\\]:[\\s\\S]*?(?=\\n\\[Contents of |$)`, 'g'
    )
    newContent = newContent.replace(pattern, '')
  }

  // Wrap kept chunks with source tags so the model can cite them
  for (const chunk of kept) {
    const escapedName = chunk.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(\\[Contents of ${escapedName}\\]:[\\s\\S]*?)(?=\\n\\[Contents of |$)`, 'g'
    )
    newContent = newContent.replace(
      pattern,
      `[SOURCE_START:${chunk.filename}]\n$1\n[SOURCE_END:${chunk.filename}]`
    )
  }

  // Replace last message with filtered version
  const updatedMessages = [
    ...messages.slice(0, -1),
    { ...lastMsg, content: newContent.trim() },
  ]

  return {
    messages:       updatedMessages,
    keptSources:    kept.map(c => ({ name: c.filename, score: c.score, reason: c.reason })),
    droppedSources: dropped.map(c => ({ name: c.filename, score: c.score, reason: c.reason })),
  }
}

// ─── ③ SOURCE CITATIONS ───────────────────────────────────────────────────────
// Instruction block appended to the system prompt whenever files are present.
// Tells the model to add [Source: filename] markers inline.
function buildCitationInstructions(keptSources) {
  if (!keptSources || keptSources.length === 0) return ''

  const sourceList = keptSources.map(s => `  • ${s.name} (relevance: ${Math.round(s.score * 100)}%)`).join('\n')

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOURCE CITATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The following documents are available as context for this query:
${sourceList}

Citation requirements — apply to every response that uses document content:
  1. After each sentence or claim that draws on a document, append:  [Source: filename.ext]
  2. At the end of your response, add a "## Sources used" section listing every
     file you cited, like:
       ## Sources used
       - filename.ext — one-sentence summary of what you used it for
  3. If you answer from your own knowledge (not from the documents), write:
       [Source: general knowledge]
  4. If you are unsure whether a document supports a claim, do NOT cite it —
     only cite sources you actually used.
  5. Never fabricate content and attribute it to a document.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ─── Memory helpers ───────────────────────────────────────────────────────────
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
    content: `Exchange to add:\nUSER: ${typeof userMessage === 'string' ? userMessage : '[files/content]'}${fileNote}\nASSISTANT: ${assistantReply}\n\nUpdate the memory.`,
  }]

  try {
    return await callSAP('anthropic--claude-4.5-haiku', '1', false, messages, system)
  } catch {
    return existingMemory || ''
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystem(displayName, sapModelName, maker, memory, memoryMode, keptSources) {
  const identity = buildIdentityBlock(displayName, sapModelName, maker)

  const base = `${identity}

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

  const memoryBlock = (!memory || memoryMode === 'off') ? '' : `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION MEMORY (${memoryMode === 'full' ? 'Detailed' : 'Summary'})
Use this to answer follow-up questions without needing the full history.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memory}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  const citationBlock = buildCitationInstructions(keptSources)

  return `${base}${memoryBlock}${citationBlock}`
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override, memory, memory_mode, attached_file_names } = req.body || {}
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
  let recentMessages = messages.slice(-HISTORY_LIMIT)

  // ② RAG: extract the user query for relevance scoring
  const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'user')
  const userQueryText = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content.replace(/\[Contents of [^\]]+\][\s\S]*?(?=\[Contents of |$)/g, '').trim()
    : ''

  let keptSources    = []
  let droppedSources = []

  // Only run RAG filter when files are attached
  const hasFiles = attached_file_names?.length > 0
  if (hasFiles && userQueryText) {
    try {
      const filtered = await filterAndTagFileContext(recentMessages, userQueryText)
      recentMessages = filtered.messages
      keptSources    = filtered.keptSources
      droppedSources = filtered.droppedSources
    } catch (err) {
      console.warn('RAG filter failed, proceeding without it:', err.message)
    }
  }

  // ①③ Build system prompt with self-awareness + citation instructions
  const system = system_override || buildSystem(displayName, sapModelName, maker, memory, memoryMode, keptSources)

  try {
    const reply = await callSAP(sapModelName, modelVersion, noTemp, recentMessages, system)

    // Memory update
    let newMemory = memory || null
    if (memoryMode !== 'off') {
      const rawUserMsg = messages[messages.length - 1]
      newMemory = await updateMemory(memory || '', rawUserMsg?.content, reply, attached_file_names || [], memoryMode)
    }

    return res.status(200).json({
      reply,
      model_used:      sapModelName,
      new_memory:      newMemory,
      // Optional debug info — remove in production if you want clean responses
      rag_debug: {
        kept:    keptSources.map(s => `${s.name} (${Math.round(s.score * 100)}%)`),
        dropped: droppedSources.map(s => `${s.name} (${Math.round(s.score * 100)}%) — ${s.reason}`),
      },
    })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
