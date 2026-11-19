create index if not exists google_calendar_oauth_states_user_id_idx
  on public.google_calendar_oauth_states(user_id);
create index if not exists google_calendar_oauth_states_expires_at_idx
  on public.google_calendar_oauth_states(expires_at);
