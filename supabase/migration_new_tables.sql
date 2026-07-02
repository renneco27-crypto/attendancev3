-- ============================================================================
-- New tables for the simplified QR attendance flow
-- Run this in Supabase SQL Editor after deploying the 3 new Edge Functions
-- ============================================================================

-- ─── ATTENDANCE SESSIONS ────────────────────────────────────────────────────
create table if not exists attendance_sessions (
  id                 uuid primary key default gen_random_uuid(),
  teacher_id         uuid not null,
  class_name         text not null,
  rotation_key       text not null,
  rotation_key_updated_at timestamptz default now(),
  is_active          boolean default true,
  expires_at         timestamptz not null,
  created_at         timestamptz default now()
);

create index if not exists idx_attendance_sessions_teacher on attendance_sessions(teacher_id);
create index if not exists idx_attendance_sessions_active  on attendance_sessions(is_active) where is_active = true;

-- ─── DEVICE REGISTRATIONS ───────────────────────────────────────────────────
create table if not exists device_registrations (
  id                 uuid primary key default gen_random_uuid(),
  student_name       text not null,
  student_id         uuid not null default gen_random_uuid(),
  teacher_id         uuid not null,
  device_identifier  text not null default '',
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'revoked')),
  created_at         timestamptz default now()
);

create index if not exists idx_device_registrations_teacher   on device_registrations(teacher_id);
create index if not exists idx_device_registrations_device    on device_registrations(device_identifier) where device_identifier != '';
create unique index if not exists idx_device_registrations_uniq
  on device_registrations(teacher_id, device_identifier)
  where device_identifier != '';

-- ─── ATTENDANCE RECORDS ─────────────────────────────────────────────────────
create table if not exists attendance_records (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references attendance_sessions(id),
  student_id         uuid not null,
  scanned_at         timestamptz default now()
);

create index if not exists idx_attendance_records_session on attendance_records(session_id);
create unique index if not exists idx_attendance_records_uniq on attendance_records(session_id, student_id);

-- ─── REALTIME ───────────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table attendance_records;
exception when others then null;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (teacher-owned, Edge Function writes bypass via service_role)
-- ============================================================================

-- ATTENDANCE_SESSIONS
alter table attendance_sessions enable row level security;

drop policy if exists "Teachers insert their own sessions" on attendance_sessions;
create policy "Teachers insert their own sessions"
  on attendance_sessions for insert
  with check (teacher_id = auth.uid());

drop policy if exists "Teachers view their own sessions" on attendance_sessions;
create policy "Teachers view their own sessions"
  on attendance_sessions for select
  using (teacher_id = auth.uid());

drop policy if exists "Teachers update their own sessions" on attendance_sessions;
create policy "Teachers update their own sessions"
  on attendance_sessions for update
  using (teacher_id = auth.uid());

-- DEVICE_REGISTRATIONS
alter table device_registrations enable row level security;

drop policy if exists "Teachers insert their own registrations" on device_registrations;
create policy "Teachers insert their own registrations"
  on device_registrations for insert
  with check (teacher_id = auth.uid());

drop policy if exists "Teachers view their own registrations" on device_registrations;
create policy "Teachers view their own registrations"
  on device_registrations for select
  using (teacher_id = auth.uid());

-- No UPDATE/DELETE policies — mutations go through Edge Functions (revoke-device)

-- ATTENDANCE_RECORDS
alter table attendance_records enable row level security;

drop policy if exists "Teachers view attendance for their sessions" on attendance_records;
create policy "Teachers view attendance for their sessions"
  on attendance_records for select
  using (
    exists (
      select 1 from attendance_sessions
      where attendance_sessions.id = attendance_records.session_id
      and attendance_sessions.teacher_id = auth.uid()
    )
  );

-- No INSERT/UPDATE — sessions and attendance are written by Edge Functions via service_role
