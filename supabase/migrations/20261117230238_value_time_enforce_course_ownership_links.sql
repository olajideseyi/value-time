alter policy assignments_insert_own on public.assignments
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=assignments.course_id and c.user_id=(select auth.uid()))));
alter policy assignments_update_own on public.assignments
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=assignments.course_id and c.user_id=(select auth.uid()))));

alter policy schedule_entries_insert_own on public.schedule_entries
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=schedule_entries.course_id and c.user_id=(select auth.uid()))));
alter policy schedule_entries_update_own on public.schedule_entries
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=schedule_entries.course_id and c.user_id=(select auth.uid()))));

alter policy "Users can create their own examinations" on public.examinations
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=examinations.course_id and c.user_id=(select auth.uid()))));
alter policy "Users can update their own examinations" on public.examinations
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and (course_id is null or exists (select 1 from public.courses c where c.id=examinations.course_id and c.user_id=(select auth.uid()))));