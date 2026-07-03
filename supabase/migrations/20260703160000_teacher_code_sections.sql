ALTER TABLE teachers ADD COLUMN teacher_code text UNIQUE;

CREATE TABLE sections (
  id uuid primary key default gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz default now()
);

INSERT INTO sections (name) VALUES
  ('WAD-2A'), ('WAD-2B'), ('BSBM-2A'), ('BSBM-2B');