# AI Chatbot

Live Demo: https://ai-chatbot-eight-pi-10.vercel.app/

A full-stack AI chatbot built with SAP AI Core, similar to claude.ai or chatGPT.com or google.gemini.com. Supports multiple AI providers, persistent memory, file uploads, hybrid web search, and multi-device sync.

---

## Features

- **Multiple AI models** — Claude (4.6, 4.5), GPT (4o, 4.1, 5), Gemini (2.0, 2.5), grouped by provider in a scrollable dropdown
- **Persistent chat history** — conversations saved to Supabase and synced across all devices and browsers
- **Multi-user authentication** — sign up and log in with email and password
- **Conversation memory** — three modes per conversation:
  -  **Off** — sends last 20 messages each time
  -  **Summary** — rolling summary updated after each reply (default, fast)
  -  **Full Memory** — detailed record of everything discussed
- **Hybrid web search** — automatically searches DuckDuckGo when the query needs current information (news, prices, recent events); skips search for coding help, explanations, and general knowledge
- **File attachments** — JPG, PNG, PDF, DOCX, TXT supported (up to 5 files, 20MB each)
- **Auto-generated titles** — conversation titles generated from the first message
- **Account management** — change password and delete account from the sidebar
- **Mobile friendly** — responsive layout, works as a PWA (Add to Home Screen on Android/iOS)
- **Conversations grouped by date** — Today, Yesterday, This week, This month, Older

---

## How It Works

1. User sends a message through the React frontend on Vercel
2. Message is saved to Supabase
3. If web search is enabled, Haiku quickly decides whether a search is needed
4. If yes, DuckDuckGo is queried and results are injected into the prompt
5. The frontend calls `/api/chat` (Vercel serverless function)
6. The function authenticates with SAP using OAuth2 and sends the request to SAP AI Core Orchestration
7. The selected model responds
8. Response is saved to Supabase and returned to the frontend
9. Conversation memory is updated in the background using Haiku

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        USER                             │
│              (any device, any browser)                  │
└─────────────────────┬───────────────────────────────────┘
                      │  HTTPS
                      ▼
┌─────────────────────────────────────────────────────────┐
│                     VERCEL                              │
│                                                         │
│  ┌─────────────────────┐  ┌───────────────────────┐    │
│  │   React Frontend    │  │  Serverless Function  │    │
│  │   (Vite + React)    │  │    /api/chat.js        │    │
│  │                     │  │                       │    │
│  │  • Login / Signup   │  │  • Gets SAP token     │    │
│  │  • Chat UI          │  │  • Web search decision│    │
│  │  • Model selector   │  │  • Calls SAP AI Core  │    │
│  │  • Memory toggle    │  │  • Updates memory     │    │
│  │  • File uploads     │  │  • Returns response   │    │
│  │  • Web search toggle│  │                       │    │
│  └──────────┬──────────┘  └──────────┬────────────┘    │
│             │                        │                  │
└─────────────┼────────────────────────┼──────────────────┘
              │                        │
              │ auth + chat history    │ AI requests
              ▼                        ▼
┌─────────────────────┐  ┌─────────────────────────────────┐
│      SUPABASE       │  │         SAP AI CORE             │
│                     │  │                                 │
│  • User accounts    │  │  Orchestration Service          │
│  • Conversations    │  │  └── Claude 4.6 Sonnet / Opus   │
│  • Messages         │  │  └── Claude 4.5 Sonnet / Opus   │
│  • Conversation     │  │  └── Claude 4.5 Haiku           │
│    memory           │  │  └── GPT-5, GPT-5 Mini          │
│  • Row-level        │  │  └── GPT-4o, GPT-4.1 series     │
│    security         │  │  └── Gemini 2.5 Pro / Flash     │
│                     │  │  └── Gemini 2.0 Flash series    │
│  Free tier          │  │                                 │
│  PostgreSQL         │  │  (Haiku used internally for     │
│                     │  │   memory + search decisions)    │
└─────────────────────┘  └─────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | Chat UI, model selector, file handling |
| Hosting | Vercel (free) | Permanent URL, auto-deploys from GitHub |
| Backend | Vercel Serverless Function | Proxies requests to SAP AI Core |
| Auth + DB | Supabase (free) | User accounts, conversation history, memory |
| AI | SAP AI Core Orchestration | Routes requests to selected model |
| Web Search | DuckDuckGo (free) | Instant answers for real-time queries |

---

## Project Structure

```
├── api/
│   └── chat.js              ← Vercel serverless function (backend)
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
├── schema.sql               ← Run first in Supabase SQL editor
├── add_memory.sql           ← Run second in Supabase SQL editor
├── vercel.json              ← Routes /api/* to serverless function
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

Fill in `.env.local`:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL (Project Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `SAP_AUTH_URL` | SAP OAuth2 URL — the `url` field from your SAP service key |
| `SAP_CLIENT_ID` | SAP client ID — the `clientid` field |
| `SAP_CLIENT_SECRET` | SAP client secret — the `clientsecret` field |
| `SAP_AI_API_URL` | SAP AI Core API base URL — the `AI_API_URL` field |
| `RESOURCE_GROUP` | SAP AI Core resource group (usually `default`) |
| `SAP_ORCHESTRATION_DEPLOYMENT_ID` | Deployment ID of your SAP orchestration service |

### 3 — Set up the database

Run both SQL files in your **Supabase → SQL Editor**:

```
1. schema.sql       ← creates all tables, policies, and triggers
2. add_memory.sql   ← adds memory columns to conversations table
```

### 4 — Run locally

```bash
npm run dev
```

Open http://localhost:5173

### 5 — Deploy to Vercel

1. Push the repo to GitHub
2. Go to vercel.com → New Project → import the repo
3. Framework preset: **Vite**
4. Add all environment variables from `.env.local` under Settings → Environment Variables
5. Deploy

After deploying, go to **Supabase → Authentication → URL Configuration** and add your Vercel URL to Site URL and Redirect URLs.

---

## Known Limitations

- PDF files are truncated to 4,000 characters per file to stay within SAP AI Core payload limits — very long PDFs will be cut off
- Maximum 5 file attachments per message
- DuckDuckGo web search returns instant answers only — not full web search results like Google. Works well for facts, news summaries, and quick lookups
- Conversation memory adds a small delay per message (Haiku updates memory after each reply)
- SAP AI Core orchestration deployment must be running for the app to work — if stopped, all AI calls will fail
