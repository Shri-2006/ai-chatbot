/**
 * Vercel Serverless Function — /api/ingest
 * Receives extracted text from the frontend, chunks it, and stores in Supabase
 * Uses Supabase service role key to bypass RLS for server-side inserts
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

const CHUNK_SIZE   = 800  // characters per chunk
const CHUNK_OVERLAP = 100 // overlap between chunks to preserve context

function chunkText(text, fileName) {
  const chunks = []
  let index = 0
  let chunkIndex = 0

  while (index < text.length) {
    let end = index + CHUNK_SIZE

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', '! ', '? ', '; ']
      for (const bp of breakPoints) {
        const lastBreak = text.lastIndexOf(bp, end)
        if (lastBreak > index + CHUNK_SIZE * 0.5) {
          end = lastBreak + bp.length
          break
        }
      }
    }

    const chunk = text.slice(index, end).trim()
    if (chunk.length > 50) { // skip tiny chunks
      chunks.push({ content: chunk, chunk_index: chunkIndex, file_name: fileName })
      chunkIndex++
    }

    index = end - CHUNK_OVERLAP
    if (index >= text.length) break
  }

  return chunks
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { conversation_id, user_id, files } = req.body || {}

  if (!conversation_id || !user_id || !files?.length) {
    return res.status(400).json({ error: 'Missing conversation_id, user_id, or files' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel env vars.' })
  }

  try {
    let totalChunks = 0

    for (const file of files) {
      const { name, text } = file
      if (!text?.trim()) continue

      const chunks = chunkText(text, name)

      // Delete existing chunks for this file in this conversation (re-upload)
      await fetch(`${supabaseUrl}/rest/v1/document_chunks?conversation_id=eq.${conversation_id}&file_name=eq.${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        }
      })

      // Insert all chunks
      const rows = chunks.map(c => ({
        conversation_id,
        user_id,
        file_name:   c.file_name,
        chunk_index: c.chunk_index,
        content:     c.content,
      }))

      if (rows.length > 0) {
        const insertResp = await fetch(`${supabaseUrl}/rest/v1/document_chunks`, {
          method: 'POST',
          headers: {
            'apikey':        supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(rows),
        })

        if (!insertResp.ok) {
          const err = await insertResp.text()
          console.error('Insert failed:', err)
          return res.status(500).json({ error: `Failed to store chunks: ${err.slice(0, 200)}` })
        }

        totalChunks += rows.length
      }
    }

    return res.status(200).json({ success: true, chunks_stored: totalChunks })

  } catch (err) {
    console.error('Ingest error:', err)
    return res.status(500).json({ error: err.message })
  }
}
