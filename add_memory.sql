-- Run this in Supabase → SQL Editor → New query → Run
-- Adds memory storage and memory mode to conversations

alter table public.conversations
  add column if not exists memory text default null,
  add column if not exists memory_mode text default 'summary';

-- memory_mode values:
--   'off'     = no memory, send last 20 messages (original behaviour)
--   'summary' = rolling summary updated every message (default, fast)
--   'full'    = detailed memory of everything, updated continuously (thorough)
