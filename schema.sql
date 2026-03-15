-- Run this entire file in Supabase → SQL Editor → New query → Run

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  default_model text default 'claude-sonnet-4-6',
  created_at timestamptz default now()
);

create table public.conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text default 'New Chat',
  model text default 'claude-sonnet-4-6',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations on delete cascade not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  file_refs jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email,'@',1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.update_conversation_timestamp()
returns trigger as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

create trigger on_message_inserted
  after insert on public.messages
  for each row execute procedure public.update_conversation_timestamp();

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

create policy "Users can view own profile"   on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Users can view own conversations"   on public.conversations for select using (auth.uid() = user_id);
create policy "Users can insert own conversations" on public.conversations for insert with check (auth.uid() = user_id);
create policy "Users can update own conversations" on public.conversations for update using (auth.uid() = user_id);
create policy "Users can delete own conversations" on public.conversations for delete using (auth.uid() = user_id);

create policy "Users can view messages"   on public.messages for select using (exists (select 1 from public.conversations where id = conversation_id and user_id = auth.uid()));
create policy "Users can insert messages" on public.messages for insert with check (exists (select 1 from public.conversations where id = conversation_id and user_id = auth.uid()));
create policy "Users can delete messages" on public.messages for delete using (exists (select 1 from public.conversations where id = conversation_id and user_id = auth.uid()));
