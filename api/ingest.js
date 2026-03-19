/**
 * Vercel Serverless Function — /api/ingest
 * Chunks documents, generates embeddings via HuggingFace, stores in Supabase
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

const CHUNK_SIZE    = 800
const CHUNK_OVERLAP = 100
const HF_MODEL      = 'sentence-transformers/all-MiniLM-L6-v2'

// ─── Embedding via HuggingFace ────────────────────────────────────────────────
async function getEmbedding(text) {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not set')

  const resp = await fetch(
    `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inputs: text.slice(0, 512), options: { wait_for_model: true } }),
    }
  )
  if (!resp.ok) throw new Error(`HF embedding failed: ${resp.status} ${await resp.text()}`)
  const data = await resp.json()
  // HF returns nested array for batched or flat array for single
  return Array.isArray(data[0]) ? data[0] : data
}

// ─── Batch embeddings (avoid rate limits) ────────────────────────────────────
async function getEmbeddingsBatch(texts) {
  const results = []
  for (const text of texts) {
    try {
      results.push(await getEmbedding(text))
      // Small delay to avoid rate limiting on free tier
      await new Promise(r => setTimeout(r, 100))
    } catch {
      results.push(null)
    }
  }
  return results
}

// ─── Text chunking ────────────────────────────────────────────────────────────
function chunkText(text, fileName) {
  const chunks = []
  let index = 0
  let chunkIndex = 0

  while (index < text.length) {
    let end = index + CHUNK_SIZE
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', '! ', '? ', '; ']
      for (const bp of breakPoints) {
        const lastBreak = text.lastIndexOf(bp, end)
        if (lastBreak > index + CHUNK_SIZE * 0.5) { end = lastBreak + bp.length; break }
      }
    }
    const chunk = text.slice(index, end).trim()
    if (chunk.length > 50) chunks.push({ content: chunk, chunk_index: chunkIndex++, file_name: fileName })
    index = end - CHUNK_OVERLAP
    if (index >= text.length) break
  }
  return chunks
}

// ─── Supabase helper ──────────────────────────────────────────────────────────
function supabaseHeaders(key) {
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { conversation_id, user_id, files } = req.body || {}
  if (!conversation_id || !user_id || !files?.length) {
    return res.status(400).json({ error: 'Missing conversation_id, user_id, or files' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials not configured' })
  }

  try {
    let totalChunks = 0
    const headers = supabaseHeaders(supabaseKey)

    for (const file of files) {
      const { name, text } = file
      if (!text?.trim()) continue

      const chunks = chunkText(text, name)
      if (!chunks.length) continue

      // Delete existing chunks for this file in this conversation
      await fetch(
        `${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversation_id}&file_name=eq.${encodeURIComponent(name)}`,
        { method: 'DELETE', headers }
      )

      // Generate embeddings for all chunks
      const embeddings = await getEmbeddingsBatch(chunks.map(c => c.content))

      // Build rows with embeddings
      const rows = chunks.map((c, i) => ({
        conversation_id,
        user_id,
        file_name:   c.file_name,
        chunk_index: c.chunk_index,
        content:     c.content,
        embedding:   embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      }))

      const insertResp = await fetch(`${supabaseUrl}/rest/v1/document_chunks`, {
        method:  'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body:    JSON.stringify(rows),
      })

      if (!insertResp.ok) {
        const err = await insertResp.text()
        console.error('Insert failed:', err)
        return res.status(500).json({ error: `Failed to store chunks: ${err.slice(0, 200)}` })
      }

      totalChunks += rows.length
    }

    return res.status(200).json({ success: true, chunks_stored: totalChunks })

  } catch (err) {
    console.error('Ingest error:', err)
    return res.status(500).json({ error: err.message })
  }
}