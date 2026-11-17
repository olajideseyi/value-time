-- Harden the initial ownership policies and restrict direct execution of the signup trigger function.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
do $$
declare t text;
begin
 foreach t in array array['user_preferences','courses','schedule_entries','assignments','tasks','attendance','telegram_connections','reminders','notification_logs'] loop
  execute format('drop policy if exists %I on public.%I',t||'_select_own',t);
  execute format('drop policy if exists %I on public.%I',t||'_insert_own',t);
  execute format('drop policy if exists %I on public.%I',t||'_update_own',t);
  execute format('drop policy if exists %I on public.%I',t||'_delete_own',t);
  execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',t||'_select_own',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',t||'_insert_own',t);
  execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',t||'_update_own',t);
  execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',t||'_delete_own',t);
 end loop;
end $$;
