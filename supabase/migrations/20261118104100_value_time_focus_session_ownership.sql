-- Keep optional course/task references inside the same user's workspace.
create or replace function public.validate_focus_session_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.course_id is not null and not exists (
    select 1 from public.courses c where c.id = new.course_id and c.user_id = new.user_id
  ) then
    raise exception 'The selected course does not belong to this account.' using errcode = '23514';
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'The selected task does not belong to this account.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_focus_session_links() from public, anon;
grant execute on function public.validate_focus_session_links() to authenticated, service_role;
drop trigger if exists validate_focus_session_links on public.focus_sessions;
create trigger validate_focus_session_links
before insert or update of course_id, task_id, user_id
on public.focus_sessions
for each row execute function public.validate_focus_session_links();
