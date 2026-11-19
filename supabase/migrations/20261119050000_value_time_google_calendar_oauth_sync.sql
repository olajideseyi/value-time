alter table public.schedule_entries
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_event_etag text,
  add column if not exists google_calendar_synced_at timestamptz;

create unique index if not exists schedule_entries_google_event_unique
  on public.schedule_entries(user_id, google_calendar_event_id)
  where google_calendar_event_id is not null;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected_email text not null,
  calendar_id text not null default 'primary',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;
revoke all on public.google_calendar_oauth_states from anon, authenticated;
grant all on public.google_calendar_connections to service_role;
grant all on public.google_calendar_oauth_states to service_role;
