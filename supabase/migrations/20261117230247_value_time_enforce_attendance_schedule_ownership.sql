alter policy attendance_insert_own on public.attendance
with check (user_id=(select auth.uid()) and exists (select 1 from public.schedule_entries s where s.id=attendance.schedule_entry_id and s.user_id=(select auth.uid())));
alter policy attendance_update_own on public.attendance
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and exists (select 1 from public.schedule_entries s where s.id=attendance.schedule_entry_id and s.user_id=(select auth.uid())));