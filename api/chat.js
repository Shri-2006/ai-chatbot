/**
 * Vercel Serverless Function — /api/chat
 * Calls Claude via SAP AI Core Orchestration Service
 * Uses the existing orchestration deployment — no new deployment needed
 */

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

// SAP model name mapping — format is anthropic--model-name
const MODEL_MAP = {
  'claude-haiku-4-5-20251001': 'anthropic--claude-4-5-haiku',
  'claude-sonnet-4-6':         'anthropic--claude-4-6-sonnet',
  'claude-opus-4-6':           'anthropic--claude-4-6-opus',
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
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override } = req.body || {}
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' })

  const system        = system_override || DEFAULT_SYSTEM
  const sapModelName  = MODEL_MAP[model] || 'anthropic--claude-4-6-sonnet'
  const apiUrl        = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'
  const deploymentId  = process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID

  if (!deploymentId) {
    return res.status(500).json({ error: 'SAP_ORCHESTRATION_DEPLOYMENT_ID not set. Add it to Vercel environment variables.' })
  }

  try {
    const token = await getSapToken()

    const payload = {
      model:      sapModelName,
      messages:   [{ role: 'system', content: system }, ...messages],
      max_tokens: 4096,
    }

    const aiResp = await fetch(
      `${apiUrl}/v2/inference/deployments/${deploymentId}/v1/chat/completions`,
      {
        method:  'POST',
        headers: {
          Authorization:       `Bearer ${token}`,
          'AI-Resource-Group': resourceGroup,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!aiResp.ok) {
      const text = await aiResp.text()
      return res.status(502).json({ error: `SAP error ${aiResp.status}: ${text.slice(0, 300)}` })
    }

    const result = await aiResp.json()
    const reply  = result.choices?.[0]?.message?.content || 'No response received.'
    return res.status(200).json({ reply, model_used: sapModelName })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
