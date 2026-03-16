/**
 * Vercel Serverless Function — /api/chat
 * Calls Claude via SAP AI Core Orchestration Service
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

// Maps frontend model ID → SAP model name + display name
const MODELS = {
  // Claude 4.6
  'claude-46-sonnet':       { sap: 'anthropic--claude-4.6-sonnet',          display: 'Claude Sonnet 4.6'        },
  'claude-46-opus':         { sap: 'anthropic--claude-4.6-opus',            display: 'Claude Opus 4.6'          },
  // Claude 4.5
  'claude-45-haiku':        { sap: 'anthropic--claude-4.5-haiku',           display: 'Claude Haiku 4.5'         },
  'claude-45-sonnet':       { sap: 'anthropic--claude-4.5-sonnet',          display: 'Claude Sonnet 4.5'        },
  'claude-45-opus':         { sap: 'anthropic--claude-4.5-opus',            display: 'Claude Opus 4.5'          },
  // Claude 3.x
  'claude-37-sonnet':       { sap: 'anthropic--claude-3.7-sonnet',          display: 'Claude Sonnet 3.7'        },
  'claude-35-sonnet':       { sap: 'anthropic--claude-3.5-sonnet',          display: 'Claude Sonnet 3.5'        },
  'claude-3-haiku':         { sap: 'anthropic--claude-3-haiku',             display: 'Claude Haiku 3'           },
  // GPT
  'gpt-5':                  { sap: 'gpt-5',                                 display: 'GPT-5'                    },
  'gpt-5-mini':             { sap: 'gpt-5-mini',                            display: 'GPT-5 Mini'               },
  'gpt-4o':                 { sap: 'gpt-4o',                                display: 'GPT-4o'                   },
  'gpt-4o-mini':            { sap: 'gpt-4o-mini',                           display: 'GPT-4o Mini'              },
  'gpt-41':                 { sap: 'gpt-4.1',                               display: 'GPT-4.1'                  },
  'gpt-41-mini':            { sap: 'gpt-4.1-mini',                          display: 'GPT-4.1 Mini'             },
  'gpt-41-nano':            { sap: 'gpt-4.1-nano',                          display: 'GPT-4.1 Nano'             },
  'o3':                     { sap: 'o3',                                     display: 'o3'                       },
  'o3-mini':                { sap: 'o3-mini',                               display: 'o3 Mini'                  },
  'o4-mini':                { sap: 'o4-mini',                               display: 'o4 Mini'                  },
  // Gemini
  'gemini-25-pro':          { sap: 'gemini-2.5-pro',                        display: 'Gemini 2.5 Pro'           },
  'gemini-25-flash':        { sap: 'gemini-2.5-flash',                      display: 'Gemini 2.5 Flash'         },
  'gemini-25-flash-lite':   { sap: 'gemini-2.5-flash-lite',                 display: 'Gemini 2.5 Flash Lite'    },
  'gemini-20-flash':        { sap: 'gemini-2.0-flash',                      display: 'Gemini 2.0 Flash'         },
  'gemini-20-flash-lite':   { sap: 'gemini-2.0-flash-lite',                 display: 'Gemini 2.0 Flash Lite'    },
  // Mistral
  'mistral-large':          { sap: 'mistralai--mistral-large-instruct',     display: 'Mistral Large'            },
  'mistral-medium':         { sap: 'mistralai--mistral-medium-instruct',    display: 'Mistral Medium'           },
  'mistral-small':          { sap: 'mistralai--mistral-small-instruct',     display: 'Mistral Small'            },
  // Amazon Nova
  'nova-pro':               { sap: 'amazon--nova-pro',                      display: 'Amazon Nova Pro'          },
  'nova-lite':              { sap: 'amazon--nova-lite',                     display: 'Amazon Nova Lite'         },
  'nova-micro':             { sap: 'amazon--nova-micro',                    display: 'Amazon Nova Micro'        },
  // Meta
  'llama3-70b':             { sap: 'meta--llama3-70b-instruct',             display: 'Llama 3 70B'             },
}

const DEFAULT_MODEL_ID = 'claude-46-sonnet'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { messages, model, system_override } = req.body || {}
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' })

  const modelInfo     = MODELS[model] || MODELS[DEFAULT_MODEL_ID]
  const sapModelName  = modelInfo.sap
  const displayName   = modelInfo.display
  const apiUrl        = process.env.SAP_AI_API_URL
  const resourceGroup = process.env.RESOURCE_GROUP || 'default'
  const deploymentId  = process.env.SAP_ORCHESTRATION_DEPLOYMENT_ID

  if (!deploymentId) {
    return res.status(500).json({ error: 'SAP_ORCHESTRATION_DEPLOYMENT_ID not set.' })
  }

  const isAnthropic = sapModelName.startsWith('anthropic--')
  const maker = isAnthropic ? 'Anthropic' :
    sapModelName.startsWith('gpt') || sapModelName.startsWith('o3') || sapModelName.startsWith('o4') ? 'OpenAI' :
    sapModelName.startsWith('gemini') ? 'Google' :
    sapModelName.startsWith('mistralai') ? 'Mistral AI' :
    sapModelName.startsWith('amazon') ? 'Amazon' :
    sapModelName.startsWith('meta') ? 'Meta' : 'an AI provider'

  const system = system_override ||
    `You are ${displayName}, an AI assistant made by ${maker}, running via SAP AI Core.

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

  try {
    const token = await getSapToken()

    const history = messages.slice(0, -1).map(m => ({
      role:    m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }))

    const lastMessage = messages[messages.length - 1]
    const userInput   = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

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
            model_name:    sapModelName,
            model_version: sapModelName.startsWith('anthropic--') ? "1" : "latest",
            model_params: {
              max_tokens:  4096,
              temperature: 0.7,
            }
          }
        }
      },
      input_params:     { user_input: userInput },
      messages_history: history,
    }

    const aiResp = await fetch(
      `${apiUrl}/v2/inference/deployments/${deploymentId}/completion`,
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
      return res.status(502).json({ error: `SAP error ${aiResp.status}: ${text.slice(0, 400)}` })
    }

    const result = await aiResp.json()
    const reply  =
      result.orchestration_result?.choices?.[0]?.message?.content ||
      result.module_results?.llm?.choices?.[0]?.message?.content  ||
      'No response received.'

    return res.status(200).json({ reply, model_used: sapModelName })

  } catch (err) {
    console.error('Chat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
