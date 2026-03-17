Live Demo: https://ai-chatbot-eight-pi-10.vercel.app/
A full stack AI chatbot similar to chatgpt.com or claude.ai or gemini.google.com, built using SAP AI Core with support for multiple models, persistent memory, and RAG. 

#Features
-multiple models from SAP AI Core -Gemini,Claude, GPT
-Keeps chat history and syncs across many devices
-Multi user autheentication, sign up and login with email
-File attachments-JPG,PNG,PDF,DOCX,TXT,ODT supported

How it works: 
User sends message through React frontend on Vercel, Message gets stored in Supabase, frontend calls the backend which authenticates and sends request to SAP AI Core to the model selected. Response gets returned and stored in Supabase, and given to frontend.

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

Components:
Frontend: React and Vite
Backend: Vercel (Serveless)
Database: Supabase
AI Provider: SAP AI Core
Models : Claude, GPT and Gemini are supported


AI generated Diagrams:

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
