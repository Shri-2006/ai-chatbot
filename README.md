#Website to deployment as of March 15, 2026:
https://ai-chatbot-eight-pi-10.vercel.app/

#Details
-multiple models from SAP AI Core -Gemini,Claude, GPT, Mistral
-Keeps chat history and syncs across many devices
-Multi user autheentication, sign up and login with email
-File attachments-JPG,PNG,PDF,DOCX,TXT,ODT supported

#System Architecture:
User-> Vercel (REACT and Vite frontend hoster, and holds function for SAP token, AI API key, and returns response)-> Auth of User, Chat history to Supabase, then API AI requests to SAP AI core)



#Setup:
Clone this repo, copy .env.example to .env local and fill credentials , run npm install.

Env Variables needed are 
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SAP_AUTH_URL
SAP_CLIENT_ID
SAP_CLIENT_SECRET
SAP_AI_API_URL
RESOURCE_GROUP
SAP_ORCHESTRATION_DEPLOYMENT_ID

## Database
Run the schema.sql in your Supabase SQL editor to set up the tables.
 
## Deployment

Frontend and API are both deployed on Vercel. Connect the GitHub repo to Vercel and add the env variables in the project settings before deploying.




AI generated Info:

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
│  │  • Chat UI          │  │  • Calls AI models via│    │
│  │  • Model selector   │  │    SAP Orchestration  │    │
│  │  • File uploads     │  │  • Returns response   │    │
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
│  • Conversations    │  │  └── Claude 4.6 Sonnet          │
│  • Messages         │  │  └── Claude 4.6 Opus            │
│  • Row-level        │  │  └── Claude 4.5 Sonnet          │
│    security         │  │  └── Claude 4.5 Haiku           │
│                     │  │  └── Claude 4.5 Opus            │
│  Free tier          │  │  └── Claude 3.7 Sonnet          │
│  PostgreSQL         │  │  └── Claude 3.5 Sonnet          │
│                     │  │  └── (+ more models)            │
└─────────────────────┘  └─────────────────────────────────┘
```

### How a message flows through the system

1. User types a message and hits send
2. React frontend saves the user message to Supabase
3. Frontend calls `/api/chat` (Vercel serverless function) with the message history
4. Serverless function authenticates with SAP using OAuth2 client credentials
5. Function sends the conversation to SAP AI Core Orchestration Service
6. SAP routes the request to the selected Claude model
7. Claude's response comes back through SAP → Vercel → frontend
8. Frontend saves the assistant response to Supabase and displays it
9. Next time the user opens the app on any device, full history loads from Supabase

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | Chat UI, model selector, file handling |
| Hosting | Vercel (free) | Permanent URL, auto-deploys from GitHub |
| Backend | Vercel Serverless Function | Proxy between frontend and SAP AI Core |
| Auth + DB | Supabase (free) | User accounts, conversation history |
| AI | SAP AI Core Orchestration | Routes requests to Claude models |
| Models | Anthropic Claude (via SAP) | The actual AI responses |

---

## Project Structure

```
app/
├── api/
│   └── chat.js          ← Vercel serverless function (backend)
├── src/
│   ├── components/
│   │   ├── Auth.jsx         ← Login / signup page
│   │   ├── MainApp.jsx      ← App shell and layout
│   │   ├── Sidebar.jsx      ← Conversation list
│   │   ├── ChatWindow.jsx   ← Main chat interface
│   │   └── MessageBubble.jsx ← Individual message rendering
│   ├── lib/
│   │   └── supabase.js      ← Supabase client
│   ├── App.jsx              ← Auth routing
│   ├── main.jsx             ← React entry point
│   └── index.css            ← Global styles
├── schema.sql           ← Run once in Supabase SQL editor
├── vercel.json          ← Routes /api/* to serverless function
├── index.html           ← HTML entry point
├── vite.config.js       ← Vite config
├── package.json         ← Dependencies
└── .env.example         ← Environment variable template
```
