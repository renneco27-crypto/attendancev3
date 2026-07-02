-- Add is_mock_location column to attendance_records
alter table attendance_records
  add column if not exists is_mock_location boolean not null default false;

-- Add DELETE policy for teachers on attendance_records (for kicking from session)
drop policy if exists "Teachers delete attendance for their sessions" on attendance_records;
create policy "Teachers delete attendance for their sessions"
  on attendance_records for delete
  using (
    exists (
      select 1 from attendance_sessions
      where attendance_sessions.id = attendance_records.session_id
      and attendance_sessions.teacher_id = auth.uid()
    )
  );
