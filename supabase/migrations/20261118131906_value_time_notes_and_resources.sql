-- Private notes and learning resources linked to a user's own courses.
create table if not exists public.notes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid references public.courses(id) on delete set null,
 title text not null,
 content text not null default '',
 resource_url text,
 tags text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists notes_user_updated_idx on public.notes(user_id,updated_at desc);
create index if not exists notes_course_idx on public.notes(course_id) where course_id is not null;
alter table public.notes enable row level security;
revoke all on public.notes from anon, public;
grant select,insert,update,delete on public.notes to authenticated;
drop policy if exists "Users can read their notes" on public.notes;
create policy "Users can read their notes" on public.notes for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Users can create their notes" on public.notes;
create policy "Users can create their notes" on public.notes for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Users can update their notes" on public.notes;
create policy "Users can update their notes" on public.notes for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "Users can delete their notes" on public.notes;
create policy "Users can delete their notes" on public.notes for delete to authenticated using ((select auth.uid())=user_id);
drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();
create or replace function public.validate_note_course_ownership()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.course_id is not null and not exists(select 1 from public.courses c where c.id=new.course_id and c.user_id=new.user_id) then
  raise exception 'The selected course does not belong to this account.' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.validate_note_course_ownership() from public,anon;
grant execute on function public.validate_note_course_ownership() to authenticated,service_role;
drop trigger if exists validate_note_course_ownership on public.notes;
create trigger validate_note_course_ownership before insert or update of course_id,user_id on public.notes for each row execute function public.validate_note_course_ownership();
