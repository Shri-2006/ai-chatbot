# AI Knowledge System

**Live Demo:** https://ai-chatbot-eight-pi-10.vercel.app/

**SearXNG Keep-Alive Repo:** https://github.com/Shri-2006/searxng-ping

A full-stack AI chatbot with hybrid retrieval (vector memory + document RAG + live web search), built on SAP AI Core.

---

## Features

- **48 AI models across 10 providers** — Claude, GPT, Gemini, DeepSeek, Qwen, Amazon Nova, Mistral, Meta, Cohere, and Perplexity Sonar; grouped by provider in a scrollable dropdown
- **Persistent chat history** — conversations saved to Supabase and synced across all devices and browsers
- **Multi-user authentication** — sign up and log in with email and password
- **Conversation memory** — three modes per conversation:
  - Off — sends last 20 messages each time (no memory)
  - Summary — rolling summary updated after each reply (default)
  - Full Memory — detailed record of everything discussed
- **Vector memory retrieval** — past Q&A pairs are stored as embeddings and retrieved by semantic similarity per message
- **RAG (Retrieval Augmented Generation)** — uploaded documents are chunked with structure-aware splitting, embedded, and stored in Supabase; relevant sections are retrieved via vector search and injected into the prompt
- **Hybrid web search (SearXNG)** — integrates a self-hosted SearXNG instance for real-time results; falls back to DuckDuckGo if unavailable
- **Response style selector** — 8 modes: Default, ELI5, Technical, Concise, Tutor, Creative, Business, Debug
- **File attachments** — JPG, PNG, PDF, DOCX, TXT, CSV, Markdown, HTML, and 20+ code extensions (up to 20 files, 20 MB each); PDFs extracted client-side via pdf.js
- **Auto-generated conversation titles** — generated from the first message using Haiku
- **Account management** — change password and delete account from the sidebar
- **Mobile friendly** — responsive layout, works as a PWA (Add to Home Screen on Android/iOS)
- **Conversations grouped by date** — Today, Yesterday, This Week, This Month, Older

---

## Supported Models

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Haiku 3, Sonnet 3.5, Sonnet 3.7, Sonnet 4, Opus 4, Haiku 4.5, Sonnet 4.5, Opus 4.5, Sonnet 4.6, Opus 4.6 |
| **OpenAI (Reasoning)** | o1, o3, o3 Mini, o4 Mini |
| **OpenAI (GPT)** | GPT-5.2, GPT-5, GPT-5 Mini, GPT-5 Nano, GPT-4o, GPT-4o Mini, GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano |
| **Google** | Gemini 3 Pro, Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash Lite, 2.0 Flash, 2.0 Flash Lite |
| **Amazon** | Nova Micro, Nova Lite, Nova Pro, Nova Premier |
| **DeepSeek** | DeepSeek V3, DeepSeek R1 |
| **Meta** | Llama 3 70B |
| **Mistral** | Mistral Large, Mistral Medium, Mistral Small |
| **Cohere** | Command A Reasoning |
| **Perplexity** | Sonar, Sonar Pro, Sonar Deep Research |
| **Qwen** | Qwen3 Max, Qwen3.5 Plus, Qwen Turbo, Qwen Flash |

All models are routed through SAP AI Core Orchestration Service. Default model is **Claude Sonnet 4.6**.

---

## How It Works

1. User sends a message through the React frontend on Vercel
2. Message is saved to Supabase
3. If web search is enabled, a keyword check (then Haiku fallback) decides whether to search
4. If search is needed, SearXNG fetches real web results with titles, snippets, and URLs
5. If documents were uploaded, Supabase vector search retrieves the most relevant chunks
6. Relevant past Q&A entries are retrieved from memory via vector similarity
7. The frontend calls `/api/chat` with the message, memory, and all retrieved context
8. `/api/chat` authenticates with SAP via OAuth2 and calls the SAP AI Core Orchestration Service
9. The selected model responds using all available context
10. Response is saved to Supabase; rolling memory and vector memory entries are updated in the background

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          USER                               │
│                (any device, any browser)                    │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        VERCEL                               │
│                                                             │
│  ┌───────────────────────┐  ┌─────────────────────────┐    │
│  │   React Frontend      │  │  Serverless Functions   │    │
│  │   (Vite + React)      │  │                         │    │
│  │                       │  │  /api/chat.js           │    │
│  │  • Login / Signup     │  │  • SAP OAuth2 auth      │    │
│  │  • Chat UI            │  │  • Search decision      │    │
│  │  • Model selector     │  │  • SearXNG web search   │    │
│  │  • Memory toggle      │  │  • Vector RAG retrieval │    │
│  │  • Web search toggle  │  │  • Vector memory lookup │    │
│  │  • Style selector     │  │  • Calls SAP AI Core    │    │
│  │  • File uploads       │  │  • Updates memory       │    │
│  │                       │  │                         │    │
│  │                       │  │  /api/ingest.js         │    │
│  │                       │  │  • Structure-aware      │    │
│  │                       │  │    chunking per type    │    │
│  │                       │  │  • Generates embeddings │    │
│  │                       │  │  • Stores in Supabase   │    │
│  └───────────┬───────────┘  └────────────┬────────────┘    │
│              │                           │                  │
└──────────────┼───────────────────────────┼──────────────────┘
               │                           │
       auth + history              AI + search + RAG
               ▼                           ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│      SUPABASE        │   │          SAP AI CORE             │
│                      │   │                                  │
│  • User accounts     │   │  Orchestration Service           │
│  • Conversations     │   │  └── Anthropic (Claude 3–4.6)   │
│  • Messages          │   │  └── OpenAI (GPT + o-series)    │
│  • Rolling memory    │   │  └── Google (Gemini 2.0–3)      │
│  • Vector memory     │   │  └── Amazon (Nova)               │
│    (memory_entries)  │   │  └── DeepSeek / Meta / Mistral  │
│  • Document chunks   │   │  └── Cohere / Perplexity / Qwen │
│    (RAG storage)     │   │                                  │
│  • pgvector indexes  │   │  Haiku 4.5 used internally for: │
│  • Row-level         │   │  • Memory updates                │
│    security          │   │  • Search decision fallback      │
│                      │   │  • Auto-titling                  │
│  Free tier           │   │                                  │
│  PostgreSQL +        │   │  Gemini 2.5 Flash used for:     │
│  pgvector            │   │  • Memory compression            │
└──────────────────────┘   └──────────────────────────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │   HUGGINGFACE           │
                              │                         │
                              │  • SearXNG Instance     │
                              │    (web search)         │
                              │  • Embedding API        │
                              │    (all-MiniLM-L6-v2)   │
                              └─────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | Chat UI, model selector, file handling |
| Hosting | Vercel (free) | Permanent URL, auto-deploys from GitHub |
| Backend | Vercel Serverless Functions | `/api/chat` and `/api/ingest` |
| Auth + DB | Supabase (free) | Users, conversations, messages, RAG chunks, memory |
| Vector Search | pgvector (Supabase) | Semantic RAG retrieval and memory lookup |
| Embeddings | HuggingFace Inference API (free) | `all-MiniLM-L6-v2` — 384-dim vectors |
| AI | SAP AI Core Orchestration | Routes requests to selected AI model |
| Web Search | SearXNG on HuggingFace Spaces (free) | Real web results for current queries |
| Search Fallback | DuckDuckGo (free) | Fallback if SearXNG is unavailable |
| Keep-Alive | GitHub Actions (public repo) | Pings SearXNG every 6 hours |

---

## RAG Chunking Strategy

Documents are chunked differently based on file type for better retrieval quality:

| File Type | Strategy |
|-----------|----------|
| PDF, DOCX, TXT | Sentence-aware grouping (~600 chars, 2-sentence overlap) |
| Markdown | Split by headers first, then sentence-group within each section |
| Code files | Split at function/class/export boundaries |
| CSV | 50 rows per chunk, header row repeated in every chunk |

---

## Project Structure

```
├── api/
│   ├── chat.js              ← Main serverless function (AI, search, RAG, memory)
│   └── ingest.js            ← Document ingestion (structure-aware chunking + embedding)
├── src/
│   ├── components/
│   │   ├── Auth.jsx             ← Login / signup page
│   │   ├── MainApp.jsx          ← App shell and layout
│   │   ├── Sidebar.jsx          ← Conversation list with date grouping
│   │   ├── ChatWindow.jsx       ← Main chat interface
│   │   ├── MessageBubble.jsx    ← Individual message rendering
│   │   └── AccountModal.jsx     ← Change password / delete account
│   ├── lib/
│   │   └── supabase.js          ← Supabase client
│   ├── App.jsx                  ← Auth routing
│   ├── main.jsx                 ← React entry point
│   └── index.css                ← Global styles + mobile responsive
├── schema.sql               ← Run first — creates all tables and RLS policies
├── add_memory.sql           ← Run second — adds memory columns to conversations
├── rag_migration.sql        ← Run third — adds document_chunks table for RAG
├── vector_migration.sql     ← Run fourth — pgvector, embedding columns, RPC search functions
├── vercel.json              ← Function config and routing
├── index.html               ← HTML entry point
├── vite.config.js           ← Vite config
├── package.json             ← Dependencies
└── .env.example             ← Environment variable template
```

---

## Setup

### 1 — Clone and install

```bash
git clone https://github.com/Shri-2006/ai-chatbot.git
cd ai-chatbot
npm install
```

### 2 — Configure environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL (Project Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (used by serverless functions for RAG ingest) |
| `SAP_AUTH_URL` | ✅ | SAP OAuth2 token URL from your SAP service key |
| `SAP_CLIENT_ID` | ✅ | SAP client ID |
| `SAP_CLIENT_SECRET` | ✅ | SAP client secret |
| `SAP_AI_API_URL` | ✅ | SAP AI Core API base URL |
| `SAP_ORCHESTRATION_DEPLOYMENT_ID` | ✅ | Your SAP orchestration deployment ID |
| `RESOURCE_GROUP` | ✅ | SAP AI Core resource group (usually `default`) |
| `HUGGINGFACE_API_KEY` | ⚠️ optional | HuggingFace token — required for vector embeddings (RAG + vector memory). Without this, RAG falls back to keyword search and vector memory is disabled. |
| `SEARXNG_URL` | ⚠️ optional | Your SearXNG HuggingFace Space URL. Without this, web search falls back to DuckDuckGo instant answers only. |

### 3 — Set up the database

Run all four SQL files in **Supabase → SQL Editor** in order:

```
1. schema.sql            ← tables, RLS policies, triggers
2. add_memory.sql        ← memory columns on conversations table
3. rag_migration.sql     ← document_chunks table for RAG
4. vector_migration.sql  ← pgvector extension, embedding columns, RPC search functions
```

### 4 — Set up SearXNG (optional but recommended)

1. Create a new **Docker** Space on HuggingFace (public)
2. Upload `searxng-space/Dockerfile`, `settings.yml`, and `README.md`
3. Wait ~3 minutes for it to build
4. Add the Space URL as `SEARXNG_URL` in Vercel env vars
5. Create a separate public GitHub repo using `searxng-ping/` to keep it alive:
   - Add `SEARXNG_URL` as a repo secret
   - GitHub Actions will ping every 6 hours and commit monthly

### 5 — Deploy to Vercel

1. Push the repo to GitHub
2. Go to vercel.com → New Project → import repo
3. Framework: **Vite**
4. Add all environment variables under Settings → Environment Variables
5. Deploy

After deploying, add your Vercel URL to **Supabase → Authentication → URL Configuration**.

---

## Known Limitations

- PDF files are chunked at ~600 characters with 2-sentence overlap — very dense technical PDFs may need multiple queries to cover all content
- Maximum 20 file attachments per message, 20 MB each
- HuggingFace free tier embedding API has occasional cold starts; RAG falls back to keyword search automatically when this happens
- SearXNG on HuggingFace free tier may have occasional cold starts — DuckDuckGo fallback handles this automatically
- DuckDuckGo fallback returns instant answers only, not full web results
- SAP AI Core has occasional 503 errors during high load — retrying the message usually works
- Conversation memory adds a small delay per message (Haiku runs in the background after each reply)
- Perplexity Sonar models have their own built-in web search — enabling SearXNG on top is redundant but harmless
- PPTX files are not supported for RAG ingest — convert to PDF first
- XLSX files convert to CSV first for RAG ingest