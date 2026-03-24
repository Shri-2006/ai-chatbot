/**
 * Vercel Serverless Function — /api/ingest
 * Chunks documents, generates embeddings via HuggingFace, stores in Supabase
 */

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
}

const HF_MODEL      = 'sentence-transformers/all-MiniLM-L6-v2'
const CHUNK_TARGET  = 600  // target chunk size in characters
const CHUNK_OVERLAP = 2    // sentences of overlap between chunks

// ─── Sentence splitting ───────────────────────────────────────────────────────
// Splits on .!? followed by whitespace + capital letter/quote/bracket.
// Avoids false splits on common abbreviations since they rarely precede a capital.
// Very long "sentences" (e.g. minified lines) are further split on semicolons.
function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .flatMap(s => s.length > 800 ? s.split(/(?<=;)\s+/) : [s])
    .filter(s => s.trim().length > 5)
}

// ─── Sentence → chunk grouper ─────────────────────────────────────────────────
// Groups sentences until CHUNK_TARGET chars is reached, then starts a new chunk
// overlapping by CHUNK_OVERLAP sentences so context isn't lost at boundaries.
function groupSentences(sentences, fileName, chunkIndexStart = 0) {
  const chunks = []
  let chunkIndex = chunkIndexStart
  let start = 0

  while (start < sentences.length) {
    let end = start
    let size = 0
    while (end < sentences.length && size < CHUNK_TARGET) {
      size += sentences[end].length + 1
      end++
    }
    if (end === start) end = start + 1  // always advance at least one sentence

    const content = sentences.slice(start, end).join(' ').trim()
    if (content.length > 50) chunks.push({ content, chunk_index: chunkIndex++, file_name: fileName })

    // Next chunk starts CHUNK_OVERLAP sentences before the current end
    start = Math.max(start + 1, end - CHUNK_OVERLAP)
  }
  return chunks
}

// ─── Prose chunker (PDF, DOCX, TXT) ──────────────────────────────────────────
function chunkProse(text, fileName) {
  return groupSentences(splitSentences(text), fileName)
}

// ─── Markdown chunker ─────────────────────────────────────────────────────────
// Splits by headers first so each section stays together, then sentence-groups
// within each section. Falls back to prose if there are no headers.
function chunkMarkdown(text, fileName) {
  const sections = text.split(/(?=^#{1,4}\s)/m).filter(s => s.trim().length > 30)
  if (sections.length <= 1) return chunkProse(text, fileName)

  const chunks = []
  for (const section of sections) {
    const sectionChunks = groupSentences(splitSentences(section), fileName, chunks.length)
    chunks.push(...sectionChunks)
  }
  // Re-number chunk_index sequentially after merging sections
  return chunks.map((c, i) => ({ ...c, chunk_index: i }))
}

// ─── Code chunker (JS, TS, Python, Java, etc.) ───────────────────────────────
// Splits at top-level function/class/export/def boundaries so each logical
// block stays in one chunk. Falls back to a hard split if a block is huge.
function chunkCode(text, fileName) {
  const lines = text.split('\n')
  const chunks = []
  let current = []
  let currentSize = 0
  let chunkIndex = 0

  const isBoundary = line => /^(function |const |let |var |class |def |async function |export |module\.exports\s*=|public |private |protected |@\w)/.test(line.trim())

  function flush(overlap = 3) {
    const content = current.join('\n').trim()
    if (content.length > 50) chunks.push({ content, chunk_index: chunkIndex++, file_name: fileName })
    current = current.slice(-overlap)
    currentSize = current.join('\n').length
  }

  for (const line of lines) {
    if (isBoundary(line) && currentSize > 200) flush()
    current.push(line)
    currentSize += line.length + 1
    if (currentSize > CHUNK_TARGET * 2) flush()  // hard cap for minified/dense files
  }
  flush(0)  // final flush, no overlap needed
  return chunks
}

// ─── CSV chunker ──────────────────────────────────────────────────────────────
// Keeps the header row in every chunk so the model always has column context.
function chunkCsv(text, fileName) {
  const lines = text.split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const header = lines[0]
  const rows = lines.slice(1)
  const ROWS_PER_CHUNK = 50
  return rows
    .reduce((chunks, _, i) => {
      if (i % ROWS_PER_CHUNK !== 0) return chunks
      const batch = rows.slice(i, i + ROWS_PER_CHUNK)
      const content = [header, ...batch].join('\n').trim()
      if (content.length > 50) chunks.push({ content, chunk_index: chunks.length, file_name: fileName })
      return chunks
    }, [])
}

// ─── Router ───────────────────────────────────────────────────────────────────
const CODE_EXTS = new Set(['js','ts','jsx','tsx','py','java','cpp','c','cs','go','rs','rb','php','swift','kt','r','sql','sh','html','css','json','xml','yaml','yml'])
const MD_EXTS   = new Set(['md','mdx'])

function chunkText(text, fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (MD_EXTS.has(ext))   return chunkMarkdown(text, fileName)
  if (ext === 'csv')       return chunkCsv(text, fileName)
  if (CODE_EXTS.has(ext)) return chunkCode(text, fileName)
  return chunkProse(text, fileName)  // PDF, DOCX, TXT and everything else
}

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
      signal:  AbortSignal.timeout(15000),  // 15s — allow for cold starts during ingest
    }
  )
  if (!resp.ok) throw new Error(`HF embedding failed: ${resp.status} ${await resp.text()}`)
  const data = await resp.json()
  return Array.isArray(data[0]) ? data[0] : data
}

// ─── Batch embeddings (avoid rate limits on free tier) ───────────────────────
async function getEmbeddingsBatch(texts) {
  const results = []
  for (const text of texts) {
    try {
      results.push(await getEmbedding(text))
      await new Promise(r => setTimeout(r, 100))  // small delay to avoid rate limiting
    } catch {
      results.push(null)
    }
  }
  return results
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
