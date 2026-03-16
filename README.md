#Website to deployment as of March 15, 2026:
https://ai-chatbot-eight-pi-10.vercel.app/

#Details
-multiple models from SAP AI Core -Gemini,Claude, GPT, Mistral
-Keeps chat history and syncs across many devices
-Multi user autheentication, sign up and login with email
-File attachments-JPG,PNG,PDF,DOCX,TXT,ODT supported

#System Architecture:




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
