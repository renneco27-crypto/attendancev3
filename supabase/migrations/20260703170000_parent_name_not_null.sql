ALTER TABLE device_registrations ADD COLUMN parent_name text NOT NULL DEFAULT '';
UPDATE device_registrations SET parent_email = '' WHERE parent_email IS NULL;
ALTER TABLE device_registrations ALTER COLUMN parent_email SET NOT NULL;
ALTER TABLE device_registrations ALTER COLUMN parent_email SET DEFAULT '';