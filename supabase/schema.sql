-- =============================================================================
-- Idempotent schema — safe to run multiple times (all CREATEs use IF NOT EXISTS)
-- =============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Teachers (auth-bound: each row maps a Supabase Auth user to teacher role)
create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  name text not null,
  created_at timestamptz default now()
);

-- Students
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  face_thumbnail_url text,
  created_at timestamptz default now()
);

-- Devices (one active device per student; binding is locked, not self-service)
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) not null,
  device_identifier text not null unique,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_devices_student_id on devices(student_id);
create index if not exists idx_devices_device_identifier on devices(device_identifier);

-- Device change requests (manual approval flow, NOT student-self-service)
create table if not exists device_change_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) not null,
  old_device_id uuid references devices(id),
  new_device_identifier text not null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz default now(),
  resolved_at timestamptz
);
create index if not exists idx_device_change_requests_student_id on device_change_requests(student_id);

-- Class sessions
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  class_name text not null,
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- Issued QR token sequence (server-generated, ground truth for validation)
create table if not exists session_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) not null,
  token text not null unique,
  sequence_index integer not null,
  issued_at timestamptz not null
);
create index if not exists idx_session_tokens_session_id on session_tokens(session_id);
create index if not exists idx_session_tokens_token on session_tokens(token);
create unique index if not exists idx_session_tokens_session_seq on session_tokens(session_id, sequence_index);

-- Attendance records
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) not null,
  student_id uuid references students(id) not null,
  device_id uuid references devices(id) not null,
  checked_in_at timestamptz default now(),
  unique (session_id, student_id)
);
create index if not exists idx_attendance_session_id on attendance(session_id);

-- Enable Realtime for attendance table (teacher dashboard live feed)
-- This errors if already added — wrap in a DO block to ignore
do $$
begin
  alter publication supabase_realtime add table attendance;
exception when others then
  null; -- table already in publication, ignore
end;
$$;

-- ============================================================================
-- Row Level Security (drop + recreate to be idempotent)
-- ============================================================================

alter table teachers enable row level security;
alter table students enable row level security;
alter table devices enable row level security;
alter table device_change_requests enable row level security;
alter table sessions enable row level security;
alter table session_tokens enable row level security;
alter table attendance enable row level security;

-- Helper: check if the requesting user is a registered teacher
create or replace function public.is_teacher()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.teachers
    where auth_user_id = auth.uid()
  );
$$;

-- Helper: check if teacher via raw user meta (fallback)
create or replace function public.is_teacher_meta()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'teacher';
$$;

-- Drop existing policies before recreating (safe to re-run)
drop policy if exists "Users can read their own teacher record" on teachers;
drop policy if exists "Service role can manage teachers" on teachers;
drop policy if exists "Teachers can read students" on students;
drop policy if exists "Teachers can insert students" on students;
drop policy if exists "No direct device access" on devices;
drop policy if exists "Authenticated users can insert device change requests" on device_change_requests;
drop policy if exists "Teachers can read device change requests" on device_change_requests;
drop policy if exists "Teachers can update device change requests" on device_change_requests;
drop policy if exists "Anyone can create sessions" on sessions;
drop policy if exists "Anyone can read sessions" on sessions;
drop policy if exists "Anyone can update sessions" on sessions;
drop policy if exists "No direct session_tokens access" on session_tokens;
drop policy if exists "Teachers can read attendance" on attendance;

-- TEACHERS
create policy "Users can read their own teacher record"
  on teachers for select
  using (auth.uid() = auth_user_id);

create policy "Service role can manage teachers"
  on teachers for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- STUDENTS
create policy "Teachers can read students"
  on students for select
  using (public.is_teacher() or public.is_teacher_meta());

create policy "Teachers can insert students"
  on students for insert
  with check (public.is_teacher() or public.is_teacher_meta());

-- DEVICES — no direct table access; managed exclusively by Edge Functions via service_role
create policy "No direct device access"
  on devices for all
  using (false);

-- DEVICE_CHANGE_REQUESTS
create policy "Authenticated users can insert device change requests"
  on device_change_requests for insert
  with check (auth.role() = 'authenticated');

create policy "Teachers can read device change requests"
  on device_change_requests for select
  using (public.is_teacher() or public.is_teacher_meta());

create policy "Teachers can update device change requests"
  on device_change_requests for update
  using (public.is_teacher() or public.is_teacher_meta());

-- SESSIONS — anon can create/read (teacher starts sessions via web app)
create policy "Anyone can create sessions"
  on sessions for insert
  with check (true);

create policy "Anyone can read sessions"
  on sessions for select
  using (true);

create policy "Anyone can update sessions"
  on sessions for update
  using (true);

-- SESSION_TOKENS — no direct table access
create policy "No direct session_tokens access"
  on session_tokens for all
  using (false);

-- ATTENDANCE — teachers can read for dashboard; Edge Functions handle writes
create policy "Teachers can read attendance"
  on attendance for select
  using (public.is_teacher() or public.is_teacher_meta());
