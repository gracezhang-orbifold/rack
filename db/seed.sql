-- Seed: real inventory from the "Orbifold Asset Tracker" spreadsheet (2026-07).
-- Ambiguities in the source sheet are flagged with SEED-TODO notes.
--
-- Dev users are seeded separately via scripts/seed-dev-users.ts.

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
