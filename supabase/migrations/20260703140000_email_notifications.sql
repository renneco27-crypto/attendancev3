ALTER TABLE device_registrations ADD COLUMN parent_email text;

CREATE TABLE email_quota (
  provider_name text primary key,
  date date not null default current_date,
  sent_count int not null default 0,
  daily_limit int not null
);

ALTER TABLE attendance_records ADD COLUMN email_sent boolean DEFAULT false;
ALTER TABLE attendance_records ADD COLUMN email_provider_used text;

CREATE OR REPLACE FUNCTION increment_email_quota(p_provider text, p_limit int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  INSERT INTO email_quota (provider_name, date, sent_count, daily_limit)
  VALUES (p_provider, current_date, 1, p_limit)
  ON CONFLICT (provider_name)
  DO UPDATE SET sent_count = email_quota.sent_count + 1
  WHERE email_quota.date = current_date
  RETURNING sent_count INTO v_count;
  IF NOT FOUND THEN
    UPDATE email_quota SET sent_count = 1, date = current_date
    WHERE provider_name = p_provider RETURNING sent_count INTO v_count;
  END IF;
  RETURN v_count <= p_limit;
END;
$$;
