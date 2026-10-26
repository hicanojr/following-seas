-- Fair Winds (Following Seas) Phase 4: Chief of Staff chat history.
--
-- One row per chat message, grouped by conversation_id. Same rules as 0001:
-- user_id defaults to auth.uid() and Row Level Security limits every row to
-- its owner. History is append-only from the API: select and insert only, no
-- update or delete policy.

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id  uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  -- Job cards and drafts shown with an assistant reply, for the chat UI only.
  attachments      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

comment on table public.chat_messages is 'Chief of Staff chat history. Append-only from the API.';

create index chat_messages_user_conversation_idx
  on public.chat_messages (user_id, conversation_id, created_at);
create index chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy chat_messages_select_own on public.chat_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke update, delete on public.chat_messages from anon, authenticated;
