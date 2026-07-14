# Camera Accessory Kits: linked types + opt-in companion checkout

**Date:** 2026-07-14
**Status:** Approved

## Problem

Some cameras ship with an accessory box (charger, mounts, cables). The
physical plan: one printed QR label on the camera, another on the accessory
box. Rack needs to model the relationship so borrowing a camera offers its
kit, while each piece keeps its own label, loan, and lifecycle.

## Decisions

- **Linked but separate:** the accessory box is its own borrowable unit with
  its own asset id and label. Borrowing a camera *offers* a kit; it never
  silently takes one.
- **Type-level link:** kits are interchangeable within a camera model. A
  camera item type links to an accessory item type (e.g. "GoPro 13 Black" →
  "GoPro 13 Accessory Kit"); any available kit unit pairs with any camera
  unit of that type.
- **Two independent sessions:** the camera loan and kit loan are ordinary
  `borrow_sessions` rows created by one request with the same due date. They
  return, extend, and get return-questionnaired independently. No session
  schema change.
- **One request:** the client cannot make two borrow calls (the
  unconfirmed-checkout guard blocks the second while the first label is
  unscanned), so the server claims both units inside a single
  `POST /api/borrow`.

## Data model

New migration `db/migrations/011_accessory_types.sql`:

- `alter table item_types add column accessory_type_id uuid references item_types(id)`
- `check (accessory_type_id <> id)` — no self-links.

Nothing else changes. The linked type is a normal item type with normal
units; availability comes from the existing `item_availability` view.

## API

- `GET /api/availability` — each row gains
  `accessory: { item_type_id, name, available_units } | null`, joined from
  the linked type, so Browse renders the offer without an extra fetch.
- `GET /api/units/by-asset/:assetId` — gains the same `accessory` object for
  the Scan flow.
- `POST /api/borrow` — accepts `with_accessory?: boolean`. Handler flow:
  1. Existing guards run once (unconfirmed checkout, overdue block).
  2. Claim the camera unit (`borrow_unit`, honoring `unit_id` if given).
  3. If `with_accessory` and the camera's type has `accessory_type_id`,
     claim a kit unit of that type with the same `days`. The kit's own
     `accessory_type_id`, if any, is ignored — no chaining.
  4. Response gains `accessory: { session_id, item_unit_id, due_at } |
     { error: string } | null` (null when not requested or no link). A
     raced-away kit does NOT cancel the camera — `accessory.error` reports
     it ("no kits available — camera only").
  5. One cabinet unlock as today. If the unlock fails, cancel BOTH sessions
     (`cancel_borrow_session` each) and return 502.
- Admin config: `POST`/`PATCH /api/admin/item-types` accept
  `accessory_type_id`; validation: the id must exist and differ from the
  type being edited (400 otherwise). PATCH treats the field by key presence
  — an explicit `null` clears the link (this field deliberately skips the
  coalesce pattern, which cannot clear). `GET /api/admin/item-types`
  includes it.

## Frontend

- **Types** (`lib/types.ts`): `AvailabilityItem.accessory`,
  `ScannedUnit.accessory`, `BorrowResult.accessory`,
  `AdminItemType.accessory_type_id`.
- **Browse sheet** (`screens/BrowseScreen.tsx`), day-picker step: when the
  selected type has a linked kit with `available_units > 0`, show a
  pre-checked checkbox — "Also take an accessory kit (3 available)" — and
  send `with_accessory`. Post-borrow scan step confirms both labels
  sequentially: camera first, then "Now scan the accessory box label" for
  the kit session. If the response carries `accessory.error`, show "No kit
  available — camera only" and continue the normal single confirm.
- **ScanScreen**: same checkbox when the scanned unit's type has a linked
  kit with stock.
- **Admin inventory** (`screens/AdminInventoryScreen.tsx`): an "Accessory
  kit" select on each type card — None plus every other item type — saved
  via the PATCH.
- **My Items**: untouched. Two rows appear, each with its own confirm badge,
  return flow, extension, and return questionnaire.

## Edge cases

- Kit stock races to zero between render and claim → camera succeeds,
  `accessory.error` surfaced in the sheet.
- Unlock failure → both sessions cancelled, 502, nothing checked out.
- `with_accessory` on a type with no link → `accessory: null`, no error.
- Borrowing a kit directly (its own label or Browse row) is a plain borrow;
  its `accessory_type_id` link, if someone configures one, is ignored when
  it is claimed as a companion.
- Self-link rejected at both the DB (check constraint) and the API (400).
- Unlinking: PATCH with `accessory_type_id: null`.

## Testing

- **Smoke** (`scripts/smoke-test.sh`): PATCH-link two types → borrow
  `with_accessory` → two sessions, equal `due_at`; exhaust kits → camera
  succeeds with `accessory.error`; kit borrows alone; self-link → 400;
  PATCH `null` unlinks.
- **Web** (vitest): Browse checkbox renders from `accessory` and the borrow
  body carries `with_accessory`; the double scan-confirm sequence confirms
  camera then kit; admin select sends `accessory_type_id` (including null).
- **End-to-end**: link "GoPro 13 Black" → kit type in the admin UI, borrow
  with the checkbox on, confirm both labels, see two rows in My Items,
  return each independently.
