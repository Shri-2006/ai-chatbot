# AI Chatbot

Live Demo: https://ai-chatbot-eight-pi-10.vercel.app/
Additional Repo: https://github.com/Shri-2006/searxng-ping

A full-stack AI chatbot built with SAP AI Core, similar to Claude.ai or ChatGPT. Supports multiple AI providers, persistent memory, RAG document search, hybrid web search via SearXNG, and multi-device sync.

---

## Features

- **Multiple AI models** — Claude (4.6-opus,sonnet, haiku, 4.5, opus sonnet and haiku), GPT (4o, 4.1, 5), Gemini (2.0 flash flash lite, pro, 2.5 flash flash lite, pro), grouped by provider in a scrollable dropdown
- **Persistent chat history** — conversations saved to Supabase and synced across all devices and browsers
- **Multi-user authentication** — sign up and log in with email and password
- **Conversation memory** — three modes per conversation:
  - 🧠 **Off** — sends last 20 messages each time (no memory)
  - 📝 **Summary** — rolling summary updated after each reply (default, fast)
  - 💡 **Full Memory** — detailed record of everything discussed
- **RAG (Retrieval Augmented Generation)** — uploaded documents are chunked and stored in Supabase. Each message automatically retrieves the most relevant sections using PostgreSQL full-text search. No truncation — all document content is searchable
- **Hybrid web search (SearXNG)** — self-hosted SearXNG instance on HuggingFace Spaces used as the search backend. Automatically searches when the query needs current information (news, prices, events). Falls back to DuckDuckGo if SearXNG is unavailable. News and price queries use `time_range=day` for fresh results
- **File attachments** — JPG, PNG, PDF, DOCX, TXT supported (up to 5 files, 20MB each). PDFs are extracted client-side via pdf.js
- **Auto-generated conversation titles** — generated from the first message using Haiku
- **Account management** — change password and delete account from the sidebar
- **Mobile friendly** — responsive layout, works as a PWA (Add to Home Screen on Android/iOS)
- **Conversations grouped by date** — Today, Yesterday, This week, This month, Older

---

## How It Works

1. User sends a message through the React frontend on Vercel
2. Message is saved to Supabase
3. If web search is enabled, a keyword check (then Haiku fallback) decides whether to search
4. If search needed, SearXNG fetches real web results with titles, snippets, and URLs
5. If documents were uploaded, Supabase full-text search retrieves the most relevant chunks
6. The frontend calls `/api/chat` with the message, memory, and any retrieved context
7. `/api/chat` authenticates with SAP via OAuth2 and calls the SAP AI Core Orchestration Service
8. The selected model responds using all available context
9. Response is saved to Supabase; memory is updated in the background via Haiku
10. Full conversation history is always accessible from any device via Supabase

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
│  │  • Login / Signup     │  │  • SAP auth             │    │
│  │  • Chat UI            │  │  • Keyword search check │    │
│  │  • Model selector     │  │  • SearXNG search       │    │
│  │  • Memory toggle      │  │  • RAG chunk retrieval  │    │
│  │  • Web search toggle  │  │  • Calls SAP AI Core    │    │
│  │  • File uploads       │  │  • Updates memory       │    │
│  │                       │  │                         │    │
│  │                       │  │  /api/ingest.js         │    │
│  │                       │  │  • Chunks documents     │    │
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
│  • Conversations     │   │  └── Claude 4.6 Sonnet / Opus    │
│  • Messages          │   │  └── Claude 4.5 Haiku/Sonnet/Opus│
│  • Conversation      │   │  └── GPT-5, GPT-5 Mini           │
│    memory            │   │  └── GPT-4o, GPT-4.1 series      │
│  • Document chunks   │   │  └── Gemini 2.5 Pro / Flash      │
│    (RAG storage)     │   │  └── Gemini 2.0 Flash series     │
│  • Row-level         │   │                                  │
│    security          │   │  Haiku used internally for:      │
│                      │   │  • Memory updates                │
│  Free tier           │   │  • Search decision fallback      │
│  PostgreSQL +        │   │  • Auto-titling                  │
│  Full-text search    │   └──────────────────────────────────┘
└──────────────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │   HUGGINGFACE SPACES    │
                              │                         │
                              │  SearXNG Instance       │
                              │  • Self-hosted search   │
                              │  • Google, Bing, Brave  │
                              │  • Google News          │
                              │  • Bing News            │
                              │  • Unlimited queries    │
                              │  • Kept alive by        │
                              │    GitHub Actions ping  │
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
| AI | SAP AI Core Orchestration | Routes requests to selected AI model |
| Web Search | SearXNG on HuggingFace Spaces (free) | Real web results for current queries |
| Search Fallback | DuckDuckGo (free) | Fallback if SearXNG is unavailable |
| Keep-Alive | GitHub Actions (public repo) | Pings SearXNG every 6 hours |

---

## Project Structure

```
├── api/
│   ├── chat.js              ← Main serverless function (AI, search, RAG retrieval)
│   └── ingest.js            ← Document ingestion (chunking + Supabase storage)
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
├── schema.sql               ← Run first — creates all tables and policies
├── add_memory.sql           ← Run second — adds memory columns
├── rag_migration.sql        ← Run third — adds document_chunks table for RAG
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

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL (Project Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for RAG ingest) |
| `SAP_AUTH_URL` | SAP OAuth2 URL from your SAP service key |
| `SAP_CLIENT_ID` | SAP client ID |
| `SAP_CLIENT_SECRET` | SAP client secret |
| `SAP_AI_API_URL` | SAP AI Core API base URL |
| `RESOURCE_GROUP` | SAP AI Core resource group (usually `default`) |
| `SAP_ORCHESTRATION_DEPLOYMENT_ID` | Your SAP orchestration deployment ID |
| `SEARXNG_URL` | Your SearXNG HuggingFace Space URL (optional but recommended) |

### 3 — Set up the database

Run all three SQL files in **Supabase → SQL Editor** in order:

```
1. schema.sql           ← tables, RLS policies, triggers
2. add_memory.sql       ← memory columns on conversations table
3. rag_migration.sql    ← document_chunks table for RAG
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

- PDF files are chunked at 800 characters with 100-character overlap during RAG ingest — very dense technical PDFs may need multiple queries to cover all content
- Maximum 5 file attachments per message
- SearXNG on HuggingFace free tier may have occasional cold starts — DuckDuckGo fallback handles this automatically
- DuckDuckGo fallback returns instant answers only, not full web results
- SAP AI Core has occasional 503 errors during high load — retrying the message usually works
- Conversation memory adds a small delay per message (Haiku runs in the background after each reply)
