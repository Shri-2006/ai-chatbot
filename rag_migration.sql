-- Run this in Supabase → SQL Editor → New query → Run
-- Adds RAG document storage to the chatbot

create table public.document_chunks (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  file_name text not null,
  chunk_index integer not null,
  content text not null,
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz default now()
);

-- Full-text search index
create index document_chunks_search_idx on public.document_chunks using gin(search_vector);
-- Fast lookup by conversation
create index document_chunks_conversation_idx on public.document_chunks(conversation_id);

-- Row level security
alter table public.document_chunks enable row level security;

create policy "Users can view own chunks" on public.document_chunks
  for select using (auth.uid() = user_id);

create policy "Users can insert own chunks" on public.document_chunks
  for insert with check (auth.uid() = user_id);

create policy "Users can delete own chunks" on public.document_chunks
  for delete using (auth.uid() = user_id);
