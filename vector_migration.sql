-- Run this in Supabase → SQL Editor → New query → Run
-- Adds vector embeddings to document_chunks and memory

-- Enable pgvector extension
create extension if not exists vector;

-- Add embedding column to document_chunks
alter table public.document_chunks
  add column if not exists embedding vector(384);

-- Create vector similarity search index (hnsw is faster for querying)
create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

-- Memory table with embeddings for vector retrieval
create table if not exists public.memory_entries (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  importance integer default 5, -- 1-10, higher = more important
  embedding vector(384),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists memory_entries_embedding_idx
  on public.memory_entries
  using hnsw (embedding vector_cosine_ops);

create index if not exists memory_entries_conversation_idx
  on public.memory_entries(conversation_id);

-- RLS for memory_entries
alter table public.memory_entries enable row level security;

create policy "Users can view own memory" on public.memory_entries
  for select using (auth.uid() = user_id);
create policy "Users can insert own memory" on public.memory_entries
  for insert with check (auth.uid() = user_id);
create policy "Users can update own memory" on public.memory_entries
  for update using (auth.uid() = user_id);
create policy "Users can delete own memory" on public.memory_entries
  for delete using (auth.uid() = user_id);

-- Function for vector similarity search on document chunks
create or replace function match_document_chunks(
  query_embedding vector(384),
  match_conversation_id uuid,
  match_count int default 6,
  match_threshold float default 0.3
)
returns table (
  id uuid,
  file_name text,
  content text,
  chunk_index integer,
  similarity float
)
language sql stable
as $$
  select
    dc.id,
    dc.file_name,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where
    dc.conversation_id = match_conversation_id
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- Function for vector similarity search on memory
create or replace function match_memory_entries(
  query_embedding vector(384),
  match_conversation_id uuid,
  match_count int default 5,
  match_threshold float default 0.3
)
returns table (
  id uuid,
  content text,
  importance integer,
  similarity float
)
language sql stable
as $$
  select
    me.id,
    me.content,
    me.importance,
    1 - (me.embedding <=> query_embedding) as similarity
  from public.memory_entries me
  where
    me.conversation_id = match_conversation_id
    and me.embedding is not null
    and 1 - (me.embedding <=> query_embedding) > match_threshold
  order by me.embedding <=> query_embedding
  limit match_count;
$$;