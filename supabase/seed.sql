-- Seed: real inventory from the "Orbifold Asset Tracker" spreadsheet (2026-07)
-- plus local-dev auth users. Runs automatically on `supabase db reset`.
-- Ambiguities in the source sheet are flagged with SEED-TODO notes.
--
-- NOTE: this file is for the LOCAL stack. `supabase db push` does not run it
-- against production; see README for the production import step.

-- ---------------------------------------------------------------------------
-- Local-dev users (admin@rack.local / user@rack.local, password: password123)
-- ---------------------------------------------------------------------------

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'admin@rack.local',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Rack Admin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user@rack.local',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Rack User"}',
   now(), now(), '', '', '', '');

insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"admin@rack.local","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"user@rack.local","email_verified":true}',
   'email', now(), now(), now());

-- handle_new_user created the profiles; promote the admin.
update public.profiles set role = 'admin' where email = 'admin@rack.local';

-- ---------------------------------------------------------------------------
-- Cabinet + lock (Seam device id is set after pairing the real TTLock)
-- ---------------------------------------------------------------------------

insert into public.cabinets (id, name, location, notes)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Main Equipment Cabinet', 'Office',
        'SEED-TODO: set real location');

insert into public.locks (cabinet_id, kind, name, seam_device_id, is_active)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cabinet', 'Main cabinet TTLock',
        null, true);
-- After pairing via Seam Connect:
--   update public.locks set seam_device_id = '<seam device id>'
--   where name = 'Main cabinet TTLock';

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

do $$
declare
  v_cabinet uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_type_id uuid;
  r record;
begin
  for r in
    select * from (values
      -- name, category, qty, unit_status, unit_owner, type_notes, unit_notes
      ('GoPro Hero4',                   'Camera', 1,  'available', null,
        null, null),
      ('GoPro 12 Black',                'Camera', 2,  'available', null,
        null, null),
      ('GoPro 13 Black',                'Camera', 3,  'available', null,
        null, null),
      ('SJCAM C110 Plus Action Camera', 'Camera', 4,  'available', null,
        null, null),
      ('TOPDON TC004 Thermal Camera',   'Camera', 2,  'available', null,
        null, null),
      ('Orbbec Gemini',                 'Camera', 2,  'available', null,
        null, null),
      ('Wrist Strap Mount',             'Camera Accessories', 10, 'available', null,
        null, null),
      ('AKASO Head Strap Mount',        'Camera Accessories', 2,  'available', null,
        null, null),
      ('GoPro Head Strap Mount',        'Camera Accessories', 1,  'available', null,
        null, null),
      ('Tripod',                        'Camera Accessories', 3,  'available', null,
        null, null),
      ('SD Cards',                      'Camera Accessories', 6,  'available', null,
        'Stored with the GoPros', null),
      ('Logitech Wired Keyboard',       'IT Accessories', 1, 'in_use', 'Enoch',
        null,
        'SEED-TODO: in use by Enoch pre-system; no borrow session exists — create one or mark returned once Enoch signs in'),
      ('Apple Magic Keyboard',          'IT Accessories', 1, 'in_use', 'Enoch',
        null,
        'SEED-TODO: in use by Enoch pre-system; no borrow session exists — create one or mark returned once Enoch signs in'),
      ('Logitech MX Keys S',            'IT Accessories', 0, 'available', null,
        'SEED-TODO: quantity inconsistent in source sheet (available 1 / in use 6, no total) — add units via admin', null),
      ('Logitech Mouse',                'IT Accessories', 0, 'available', null,
        'SEED-TODO: quantity inconsistent in source sheet (available 1 / in use 6, no total) — add units via admin', null),
      ('Apple Mouse',                   'IT Accessories', 1, 'in_use', null,
        null,
        'SEED-TODO: sheet shows 1 in use, borrower unknown'),
      ('MacBook Air',                   'Laptop', 0, 'available', null,
        'SEED-TODO: quantity unknown in source sheet — add units via admin', null),
      ('MacBook Pro',                   'Laptop', 0, 'available', null,
        'SEED-TODO: quantity unknown in source sheet — add units via admin', null),
      ('Oculus',                        'Other', 1, 'available', null,
        null, null),
      ('Antigravity Drone',             'Other', 1, 'available', null,
        null, null),
      ('Meta Quest 3',                  'Other', 1, 'missing', null,
        null, 'SEED-TODO: only the box was found'),
      ('Google Coral Dev Board Mini',   'Other', 1, 'available', null,
        null, null),
      ('PiSugar Battery',               'Other', 1, 'available', null,
        null, null),
      ('Raspberry Pi Camera Module',    'Other', 1, 'available', null,
        null, null),
      ('Helmet',                        'Other', 1, 'available', null,
        null, null),
      ('Helmet with GoPro Mount',       'Other', 1, 'available', null,
        null, null),
      ('Perception Neuron Studio',      'Tracking', 1, 'available', null,
        null, null),
      ('Manus Gloves',                  'Tracking', 1, 'available', null,
        null, null)
    ) as t(name, category, qty, unit_status, unit_owner, type_notes, unit_notes)
  loop
    insert into public.item_types (name, category, notes)
    values (r.name, r.category, r.type_notes)
    returning id into v_type_id;

    if r.qty > 0 then
      insert into public.item_units (item_type_id, status, cabinet_id, owner, notes)
      select v_type_id, r.unit_status::public.unit_status, v_cabinet, r.unit_owner, r.unit_notes
      from generate_series(1, r.qty);
    end if;
  end loop;
end;
$$;
