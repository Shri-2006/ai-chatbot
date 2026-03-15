/**
 * Vercel Serverless Function — /api/chat
 * Handles all AI requests: gets SAP auth token, calls Claude, returns response
 * Environment variables are set in Vercel dashboard — never in code
 */

// Token cache — persists for the lifetime of this serverless instance
let tokenCache = { token: null, expiresAt: 0 }

async function getSapToken() {
  const now = Date.now() / 1000
  if (tokenCache.token && now < tokenCache.expiresAt - 60) {
    return tokenCache.token
  }

  const authUrl = process.env.SAP_AUTH_URL
  const clientId = process.env.SAP_CLIENT_ID
  const clientSecret = process.env.SAP_CLIENT_SECRET

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const resp = await fetch(`${authUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`SAP auth failed: ${resp.status} — ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  tokenCache.token = data.access_token
  tokenCache.expiresAt = now + (data.expires_in || 3600)
  return tokenCache.token
}

// Cache of model → deploymentId
let deploymentCache = null

async function getDeployments(token) {
  if (deploymentCache) return deploymentCache

  const apiUrl = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'

  const resp = await fetch(
    `${apiUrl}/v2/lm/deployments?scenarioId=foundation-models`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'AI-Resource-Group': resourceGroup,
      },
    }
  )

  if (!resp.ok) {
    throw new Error(`Failed to fetch deployments: ${resp.status}`)
  }

  const data = await resp.json()
  const deployments = data.resources || []
  const map = {}

  for (const d of deployments) {
    if (d.status !== 'RUNNING') continue
    const id = d.id
    const name = (d.configurationName || d.executableId || '').toLowerCase()

    if (name.includes('claude')) {
      if (name.includes('haiku') && name.includes('4-5')) map['claude-haiku-4-5'] = id
      else if (name.includes('sonnet') && name.includes('4-6')) map['claude-sonnet-4-6'] = id
      else if (name.includes('opus') && name.includes('4-6')) map['claude-opus-4-6'] = id
      else if (name.includes('haiku') && name.includes('4-6')) map['claude-haiku-4-6'] = id
      else if (name.includes('sonnet') && name.includes('4-5')) map['claude-sonnet-4-5'] = id
      else if (name.includes('opus') && name.includes('4-5')) map['claude-opus-4-5'] = id
    }
  }

  deploymentCache = map
  return map
}

const MODEL_MAP = {
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  'claude-sonnet-4-6':         'claude-sonnet-4-6',
  'claude-opus-4-6':           'claude-opus-4-6',
}

const DEFAULT_SYSTEM = `You are a helpful AI assistant integrated with SAP AI Core.

You specialize in:
1. General Q&A — answer questions clearly and concisely on any topic
2. Coding help — explain code in plain English, debug issues, write snippets step by step

When helping with code:
- Always explain WHAT the code does and WHY, not just HOW
- Use simple language — assume the user may not be an expert
- Break complex problems into small numbered steps
- Add comments explaining each important line
- When showing fixes, explain what was wrong and what changed

When analyzing files (images, PDFs, documents):
- Describe what you see or read clearly
- Extract key information the user is likely asking about

Keep responses clear, friendly, and thorough.`

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override } = req.body || {}

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' })
  }

  const system = system_override || DEFAULT_SYSTEM
  const sapModelKey = MODEL_MAP[model] || 'claude-sonnet-4-6'
  const apiUrl = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'

  try {
    const token = await getSapToken()
    const deployments = await getDeployments(token)

    // Pick the requested model, fall back to sonnet, then any available
    const deploymentId =
      deployments[sapModelKey] ||
      deployments['claude-sonnet-4-6'] ||
      deployments['claude-sonnet-4-5'] ||
      Object.values(deployments)[0]

    if (!deploymentId) {
      return res.status(503).json({
        error: 'No Claude deployment found in SAP AI Core. Check foundation-models scenario.',
      })
    }

    // SAP uses OpenAI-compatible chat completions format
    const payload = {
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 4096,
    }

    const aiResp = await fetch(
      `${apiUrl}/v2/inference/deployments/${deploymentId}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'AI-Resource-Group': resourceGroup,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!aiResp.ok) {
      const text = await aiResp.text()
      return res.status(502).json({ error: `SAP AI error: ${aiResp.status} — ${text.slice(0, 300)}` })
    }

    const result = await aiResp.json()
    const reply = result.choices?.[0]?.message?.content || 'No response received.'

    return res.status(200).json({ reply, model_used: sapModelKey })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
