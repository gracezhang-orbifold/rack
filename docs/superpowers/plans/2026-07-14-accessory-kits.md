# Camera Accessory Kits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camera item types link to an accessory-kit type; borrowing a camera offers a pre-checked "Also take an accessory kit" that claims a kit unit in the same request as a second, independent session.

**Architecture:** One nullable self-FK on `item_types` (`accessory_type_id`). The server claims both units inside one `POST /api/borrow` (a second client call would trip the unconfirmed-checkout guard); the two loans are ordinary `borrow_sessions` with the same due date — returns, extensions, questionnaires, overdue logic all apply per piece unchanged. Spec: `docs/superpowers/specs/2026-07-14-camera-accessory-kits-design.md`.

**Tech Stack:** Fastify + `pg` (raw SQL), Postgres via docker compose, React + TanStack Query + Tailwind, vitest in `api/` and `web/`.

## Global Constraints

- Migration file: `db/migrations/011_accessory_types.sql`.
- Link is TYPE-level; a kit's own `accessory_type_id` is never chained when it is claimed as a companion.
- `accessory` object shape in availability/by-asset responses: `{ item_type_id, name, available_units } | null`.
- Borrow response `accessory`: `{ session_id, item_unit_id, due_at } | { error: string } | null` (null when not requested or type has no link). Kit exhaustion error text exactly: `no kits available — camera only`.
- A raced-away kit never cancels the camera; a failed cabinet unlock cancels BOTH sessions.
- PATCH item-types: `accessory_type_id` is presence-based (explicit `null` clears; omitted leaves unchanged) — it deliberately skips the coalesce pattern.
- Self-link rejected at API (400) and DB (check constraint).
- ESM imports in `api/src` use `.js` suffixes. Commit only the files each task names.
- Smoke test needs a fresh seed per run: `docker compose down -v db && docker compose up -d db && sleep 3 && (cd api && npm run migrate -- --seed) && npx tsx scripts/seed-dev-users.ts` (docker via `export PATH="$HOME/.orbstack/bin:$PATH"`). Dev api (`tsx watch`, port 3000) and mock Seam/Resend (port 9911) must be running; `touch api/src/server.ts` forces a reload after reseed.

---

### Task 1: Migration 011 — `accessory_type_id`

**Files:**
- Create: `db/migrations/011_accessory_types.sql`

**Interfaces:**
- Produces: `item_types.accessory_type_id uuid null references item_types(id)`, check constraint `accessory_type_id <> id`.

- [ ] **Step 1: Write the migration**

Create `db/migrations/011_accessory_types.sql`:

```sql
-- Camera accessory kits: an item type may link to another type whose units
-- are offered as an opt-in companion at borrow time ("also take an accessory
-- kit"). The link is type-level — any available kit unit pairs with any
-- camera of the linked type — and the companion loan is an ordinary,
-- independent borrow_sessions row.

alter table public.item_types
  add column accessory_type_id uuid references public.item_types(id);

alter table public.item_types
  add constraint item_types_no_self_accessory check (accessory_type_id <> id);
```

- [ ] **Step 2: Run the migration**

Run: `(cd api && npm run migrate)`
Expected: `011_accessory_types.sql` applied, no error.

- [ ] **Step 3: Verify**

```bash
export PATH="$HOME/.orbstack/bin:$PATH"
docker compose exec -T db psql -U rack rack -tA -c \
  "select column_name, is_nullable from information_schema.columns where table_name='item_types' and column_name='accessory_type_id';"
docker compose exec -T db psql -U rack rack -tA -c \
  "update item_types set accessory_type_id = id where name='Oculus';" ; echo "exit=$? (expect nonzero: check violation)"
```
Expected: `accessory_type_id|YES`; the self-link UPDATE fails with `item_types_no_self_accessory`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/011_accessory_types.sql
git commit -m "feat(db): item_types.accessory_type_id — camera accessory kit link"
```

---

### Task 2: Admin config — link/unlink accessory type

**Files:**
- Modify: `api/src/routes/admin.ts` (GET list ~line 87, POST ~line 99, PATCH ~line 118)
- Modify: `scripts/smoke-test.sh` (new section before `== Results`)

**Interfaces:**
- Consumes: column from Task 1.
- Produces: `GET /api/admin/item-types` rows include `accessory_type_id: string | null`; POST accepts `accessory_type_id?: string | null`; PATCH is presence-based (explicit null clears). Bad/unknown/self id → 400.

- [ ] **Step 1: Add the failing smoke checks**

Insert immediately before the final `echo; echo "== Results: …"` line:

```bash
echo "== Accessory kits"
CAM=$(curl -sb "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Cam","category":"Camera"}' | jqv id)
KIT=$(curl -sb "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Cam Kit","category":"Camera"}' | jqv id)
check "self-link rejected" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d "{\"accessory_type_id\":\"$CAM\"}")"
check "unknown accessory type rejected" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d '{"accessory_type_id":"00000000-0000-0000-0000-000000000000"}')"
check "link saved" "$KIT" "$(curl -sb "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d "{\"accessory_type_id\":\"$KIT\"}" | jqv accessory_type_id)"
check "omitted field leaves link alone" "$KIT" "$(curl -sb "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d '{"notes":"smoke"}' | jqv accessory_type_id)"
check "null clears link" "" "$(curl -sb "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d '{"accessory_type_id":null}' | jqv accessory_type_id)"
# re-link for the tasks below
curl -sb "$AJ" -X PATCH "$API/api/admin/item-types/$CAM" -H 'Content-Type: application/json' -d "{\"accessory_type_id\":\"$KIT\"}" >/dev/null
```

- [ ] **Step 2: Run smoke to verify the new checks fail**

Run (fresh seed): `./scripts/smoke-test.sh`
Expected: "link saved" FAILs (field ignored → jqv empty); pre-existing checks pass.

- [ ] **Step 3: Implement**

In `api/src/routes/admin.ts`:

1. Add a shared validator above `adminRoutes` (below the imports):

```ts
// Accessory-kit link validation: the id must name an existing item type and
// differ from the type being edited. Returns an error message or null.
async function accessoryLinkError(value: unknown, selfId: string | null): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return "accessory_type_id must be an item type id or null";
  if (selfId !== null && value === selfId) return "an item type cannot be its own accessory kit";
  try {
    const { rows } = await query(`select 1 from item_types where id = $1`, [value]);
    if (!rows[0]) return "accessory type not found";
  } catch {
    return "accessory_type_id must be an item type id or null"; // malformed uuid
  }
  return null;
}
```

2. GET list — add the column to the select (grouped by `t.id`, no GROUP BY change):

```ts
      select t.id, t.name, t.category, t.notes, t.return_questions, t.accessory_type_id,
```

3. POST — extend the body type with `accessory_type_id?: unknown`, destructure it, and after the `return_questions` validation add:

```ts
      if (accessory_type_id !== undefined) {
        const err = await accessoryLinkError(accessory_type_id, null);
        if (err) return reply.code(400).send({ error: err });
      }
```

and extend the insert:

```ts
      const { rows } = await query(
        `insert into item_types (name, category, notes, return_questions, accessory_type_id)
         values ($1, $2, $3, $4, $5) returning *`,
        [name, category, notes ?? null, JSON.stringify(return_questions ?? []),
         (accessory_type_id as string | undefined) ?? null]);
```

4. PATCH — extend the body type with `accessory_type_id?: unknown`; after the `return_questions` validation add:

```ts
      const hasAccessory = Object.prototype.hasOwnProperty.call(req.body ?? {}, "accessory_type_id");
      if (hasAccessory) {
        const err = await accessoryLinkError(req.body!.accessory_type_id, req.params.id);
        if (err) return reply.code(400).send({ error: err });
      }
```

and replace the UPDATE (presence-based branch for this one field — coalesce cannot clear):

```ts
      const { rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes),
          return_questions = coalesce($5::jsonb, return_questions),
          accessory_type_id = case when $6 then $7::uuid else accessory_type_id end
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null,
         return_questions === undefined ? null : JSON.stringify(return_questions),
         hasAccessory, hasAccessory ? (req.body!.accessory_type_id as string | null) : null]);
```

- [ ] **Step 4: Run smoke to verify it passes**

Run (fresh seed): `./scripts/smoke-test.sh` — all pass, including the five new checks.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/admin.ts scripts/smoke-test.sh
git commit -m "feat(api): item types link an accessory kit type (presence-based PATCH)"
```

---

### Task 3: Availability + by-asset carry accessory info

**Files:**
- Modify: `api/src/routes/catalog.ts` (`/api/availability` line 6, `/api/units/by-asset` line 16)
- Modify: `scripts/smoke-test.sh` (extend the `== Accessory kits` section)

**Interfaces:**
- Consumes: link from Task 2.
- Produces: both endpoints' rows gain `accessory: { item_type_id, name, available_units } | null`.

- [ ] **Step 1: Add the failing smoke checks**

Append to the `== Accessory kits` section (after the re-link line):

```bash
curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$CAM\",\"count\":2}" >/dev/null
curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$KIT\"}" >/dev/null
check "availability carries accessory" "1" "$(curl -sb "$UJ" "$API/api/availability" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke Cam");console.log(t?.accessory?t.accessory.available_units:"")})')"
check "unlinked type has null accessory" "yes" "$(curl -sb "$UJ" "$API/api/availability" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke Cam Kit");console.log(t&&t.accessory===null?"yes":"no")})')"
```

- [ ] **Step 2: Run smoke to verify the new checks fail** (fresh seed; "availability carries accessory" FAILs — field absent).

- [ ] **Step 3: Implement**

In `api/src/routes/catalog.ts`, replace the two queries:

```ts
  app.get("/api/availability", { preHandler: requireUser }, async () => {
    const { rows } = await query(`
      select a.item_type_id, a.name, a.category, a.notes,
             a.total_units::int, a.available_units::int, a.in_use_units::int,
             a.needs_repair_units::int, a.missing_units::int, a.asset_ids,
             case when t.accessory_type_id is null then null else json_build_object(
               'item_type_id', acc.item_type_id, 'name', acc.name,
               'available_units', acc.available_units::int) end as accessory
      from item_availability a
      join item_types t on t.id = a.item_type_id
      left join item_availability acc on acc.item_type_id = t.accessory_type_id
      order by a.category, a.name`);
    return rows;
  });
```

```ts
      const { rows } = await query(`
        select u.id as unit_id, u.asset_id, u.status, t.id as item_type_id, t.name, t.category,
               case when t.accessory_type_id is null then null else json_build_object(
                 'item_type_id', acc.item_type_id, 'name', acc.name,
                 'available_units', acc.available_units::int) end as accessory
        from item_units u
        join item_types t on t.id = u.item_type_id
        left join item_availability acc on acc.item_type_id = t.accessory_type_id
        where u.asset_id = $1 and u.status <> 'retired'`, [req.params.assetId]);
```

- [ ] **Step 4: Run smoke to verify it passes** (fresh seed; all green).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/catalog.ts scripts/smoke-test.sh
git commit -m "feat(api): availability and by-asset expose linked accessory kit info"
```

---

### Task 4: `POST /api/borrow` claims the companion kit

**Files:**
- Modify: `api/src/routes/borrow.ts` (`/api/borrow` handler, lines 80–147)
- Modify: `scripts/smoke-test.sh`

**Interfaces:**
- Consumes: link (Task 2); existing `borrow_unit(user, type, days, unit)` and `cancel_borrow_session(session)` SQL functions.
- Produces: body gains `with_accessory?: boolean`; response gains `accessory` per the Global Constraints shape.

- [ ] **Step 1: Add the failing smoke checks**

Append to the `== Accessory kits` section:

```bash
B7=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$CAM\",\"with_accessory\":true}")
S7=$(echo "$B7" | jqv session_id); K7=$(echo "$B7" | jqv accessory.session_id)
check "camera session created" "yes" "$([ -n "$S7" ] && echo yes || echo no)"
check "kit session created" "yes" "$([ -n "$K7" ] && echo yes || echo no)"
check "kit shares the due date" "yes" "$([ "$(echo "$B7" | jqv due_at)" = "$(echo "$B7" | jqv accessory.due_at)" ] && echo yes || echo no)"
B8=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$CAM\",\"with_accessory\":true}")
check "camera ok when kits exhausted" "yes" "$([ -n "$(echo "$B8" | jqv session_id)" ] && echo yes || echo no)"
check "kit exhaustion reported" "no kits available — camera only" "$(echo "$B8" | jqv accessory.error)"
for S in $S7 $K7 $(echo "$B8" | jqv session_id); do
  curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S\"}" >/dev/null
done
B9=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$KIT\"}")
S9=$(echo "$B9" | jqv session_id)
check "kit borrows alone, no companion field" "yes" "$([ -n "$S9" ] && [ -z "$(echo "$B9" | jqv accessory.session_id)" ] && echo yes || echo no)"
curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S9\"}" >/dev/null
```

(The returns free the pools first, so the direct kit borrow proves a kit is an ordinary standalone loan — with no `accessory` companion of its own — rather than 409ing on an empty pool.)

- [ ] **Step 2: Run smoke to verify the new checks fail** (fresh seed; "kit session created" FAILs).

- [ ] **Step 3: Implement**

In `api/src/routes/borrow.ts` `/api/borrow`:

1. Body type and destructure gain `with_accessory`:

```ts
  app.post<{ Body: { item_type_id?: string; days?: number; unit_id?: string; with_accessory?: boolean } }>(
    "/api/borrow", { preHandler: requireUser }, async (req, reply) => {
      const { item_type_id, days, unit_id, with_accessory } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      if (with_accessory !== undefined && typeof with_accessory !== "boolean")
        return reply.code(400).send({ error: "with_accessory must be a boolean" });
```

2. Immediately after the camera claim succeeds (`session = rows[0];` + catch block), before the `last_return` query, add:

```ts
      // Companion kit: claim a unit of the type's linked accessory type in
      // the same request — a second client call would trip the unconfirmed-
      // checkout guard above. The kit's own link, if any, is never chained.
      let accessory: { session_id: string; item_unit_id: string; due_at: string } | { error: string } | null = null;
      if (with_accessory === true) {
        const { rows: [t] } = await query(
          `select accessory_type_id from item_types where id = $1`, [item_type_id]);
        if (t?.accessory_type_id) {
          try {
            const { rows: [kit] } = await query(`select * from borrow_unit($1, $2, $3, $4)`,
              [req.user!.id, t.accessory_type_id, days ?? 7, null]);
            accessory = { session_id: kit.session_id, item_unit_id: kit.item_unit_id, due_at: kit.due_at };
          } catch {
            // Kit pool raced to empty — the camera checkout stands.
            accessory = { error: "no kits available — camera only" };
          }
        }
      }
```

3. Include `accessory` in both success returns:

```ts
        return { ...session, unlock: "skipped", last_return, accessory };
```
```ts
      return { ...session, unlock: "ok", last_return, accessory };
```

4. The unlock-failure branch cancels the kit too:

```ts
      if (!unlock.ok) {
        await query(`select cancel_borrow_session($1)`, [session.session_id]);
        if (accessory && "session_id" in accessory)
          await query(`select cancel_borrow_session($1)`, [accessory.session_id]);
        return reply.code(502).send({ error: "cabinet did not unlock — item not checked out, please retry" });
      }
```

- [ ] **Step 4: Run smoke to verify it passes** (fresh seed; all green).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/borrow.ts scripts/smoke-test.sh
git commit -m "feat(api): borrow claims a companion accessory kit in the same request"
```

---

### Task 5: Web types, API client, hooks

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/hooks/queries.ts`
- Test: `web/src/lib/api.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 6–8):
  - `interface AccessoryInfo { item_type_id: string; name: string; available_units: number; }`
  - `type BorrowAccessory = { session_id: string; item_unit_id: string; due_at: string } | { error: string } | null;`
  - `AvailabilityItem.accessory: AccessoryInfo | null`; `ScannedUnit.accessory: AccessoryInfo | null`; `BorrowResult.accessory: BorrowAccessory`; `AdminItemType.accessory_type_id: string | null`
  - `api.borrow(item_type_id, days, unit_id?, with_accessory?)` — `with_accessory: true` included only when truthy
  - `api.updateItemType` body gains `accessory_type_id?: string | null` (null must survive into the JSON body)
  - `useBorrow` mutationFn gains `with_accessory?: boolean`; `useUpdateItemType` body type gains `accessory_type_id?: string | null`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("api client", …)` in `web/src/lib/api.test.ts`:

```ts
  it("borrow includes with_accessory only when set", async () => {
    const f = mockFetch(200, { session_id: "s1" });
    vi.stubGlobal("fetch", f);
    await api.borrow("t1", 7, undefined, true);
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, with_accessory: true,
    });
    await api.borrow("t1", 7);
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7,
    });
  });

  it("updateItemType sends an explicit null accessory_type_id", async () => {
    const f = mockFetch(200, { id: "t1" });
    vi.stubGlobal("fetch", f);
    await api.updateItemType("t1", { accessory_type_id: null });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      accessory_type_id: null,
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/lib/api.test.ts`
Expected: FAIL (borrow has no 4th param / type error).

- [ ] **Step 3: Implement**

`web/src/lib/types.ts` — add:

```ts
export interface AccessoryInfo { item_type_id: string; name: string; available_units: number; }
export type BorrowAccessory =
  { session_id: string; item_unit_id: string; due_at: string } | { error: string } | null;
```

and extend the existing interfaces (add one field each, keep the rest):

```ts
export interface AvailabilityItem {
  item_type_id: string; name: string; category: string; notes: string | null;
  total_units: number; available_units: number; in_use_units: number;
  needs_repair_units: number; missing_units: number; asset_ids: string[];
  accessory: AccessoryInfo | null;
}
```
```ts
export interface ScannedUnit {
  unit_id: string; asset_id: string; status: UnitStatus;
  item_type_id: string; name: string; category: string;
  accessory: AccessoryInfo | null;
}
```
`BorrowResult` gains `accessory: BorrowAccessory;` and `AdminItemType` gains `accessory_type_id: string | null;`.

`web/src/lib/api.ts`:

```ts
  borrow: (item_type_id: string, days: number, unit_id?: string, with_accessory?: boolean) =>
    request<BorrowResult>("/borrow", post({
      item_type_id, days,
      ...(unit_id ? { unit_id } : {}),
      ...(with_accessory ? { with_accessory: true } : {}),
    })),
```

`updateItemType` body type becomes `{ name?: string; category?: string; notes?: string; return_questions?: ReturnQuestion[]; accessory_type_id?: string | null }` (JSON.stringify keeps explicit nulls, so no other change).

`web/src/hooks/queries.ts` — `useBorrow`:

```ts
    mutationFn: (v: { item_type_id: string; days: number; unit_id?: string; with_accessory?: boolean }) =>
      api.borrow(v.item_type_id, v.days, v.unit_id, v.with_accessory),
```

and `useUpdateItemType`'s body type gains `accessory_type_id?: string | null`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix web test -- src/lib/api.test.ts` → PASS. Then `npm --prefix web run build` → clean (screens don't read the new fields yet; test fixtures are untyped literals).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/hooks/queries.ts web/src/lib/api.test.ts
git commit -m "feat(web): accessory-kit types, borrow with_accessory, null-clearing link"
```

---

### Task 6: Browse — kit checkbox + double scan-confirm

**Files:**
- Modify: `web/src/screens/BrowseScreen.tsx`
- Test: `web/src/screens/BrowseScreen.test.tsx`

**Interfaces:**
- Consumes: `AvailabilityItem.accessory`, `BorrowResult.accessory`, `useBorrow` with `with_accessory` (Task 5).

- [ ] **Step 1: Write the failing tests**

In `web/src/screens/BrowseScreen.test.tsx`: add `accessory: null` to BOTH existing `AVAIL` rows (the screen now reads the field), then append inside the describe block:

```tsx
  const AVAIL_KIT = [
    { ...AVAIL[0], accessory: { item_type_id: "t9", name: "GoPro Kit", available_units: 2 } },
    AVAIL[1],
  ];

  it("offers a pre-checked accessory kit and sends with_accessory", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
          last_return: null,
          accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL_KIT };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    const kitBox = await screen.findByRole("checkbox", { name: /also take an accessory kit \(2 available\)/i });
    expect(kitBox).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
    const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow"));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      item_type_id: "t1", days: 7, with_accessory: true,
    });
  });

  it("confirms the camera label, then the accessory box label", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/borrow/confirm")) {
        const body = JSON.parse((init as RequestInit).body as string);
        return { ok: true, status: 200, json: async () => ({
          session_id: body.session_id, item_unit_id: "x", asset_id: body.asset_id, confirmed: true }) };
      }
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
          last_return: null,
          accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL_KIT };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();
    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm & unlock/i }));

    await userEvent.type(await screen.findByPlaceholderText(/type the asset id/i), "RACK-0001");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/now scan the accessory box label/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/type the asset id/i), "RACK-0002");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("All set")).toBeInTheDocument();

    const confirms = f.mock.calls.filter(([u]) => String(u).endsWith("/api/borrow/confirm"))
      .map(([, i]) => JSON.parse((i as RequestInit).body as string));
    expect(confirms).toEqual([
      { session_id: "s1", asset_id: "RACK-0001" },
      { session_id: "s2", asset_id: "RACK-0002" },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/screens/BrowseScreen.test.tsx`
Expected: both new tests FAIL (no checkbox; single confirm); the six pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `web/src/screens/BrowseScreen.tsx`:

1. State (next to `confirmedAsset`): `const [confirmedKitAsset, setConfirmedKitAsset] = useState<string | null>(null);` and `const [withKit, setWithKit] = useState(true);`
2. Reset both in `openSheet` (`setConfirmedKitAsset(null); setWithKit(true);`) and clear `setConfirmedKitAsset(null)` in `closeSheet`.
3. Derivations, after the state block (they need `selected`/`result`):

```tsx
  const kitOffer = selected?.accessory && selected.accessory.available_units > 0 ? selected.accessory : null;
  const kitSession = result?.accessory && "session_id" in result.accessory ? result.accessory : null;
  const kitError = result?.accessory && "error" in result.accessory ? result.accessory.error : null;
  // Which session the next scanned label confirms: camera first, then the kit.
  const pendingSession = result && !confirmedAsset ? result.session_id
    : kitSession && !confirmedKitAsset ? kitSession.session_id : null;
```

4. `confirmAsset` targets `pendingSession` and advances the step:

```tsx
  const confirmAsset = (assetId: string) => {
    if (!pendingSession) return;
    confirmUnit.mutate({ session_id: pendingSession, asset_id: assetId }, {
      onSuccess: (r) => {
        if (!confirmedAsset) setConfirmedAsset(r.asset_id);
        else setConfirmedKitAsset(r.asset_id);
        setManualId(""); setScanError(null); setScanKey((k) => k + 1);
      },
      onError: (e) => {
        setScanError(e instanceof ApiError ? e.message : errorMessage(e));
        setScanKey((k) => k + 1); // remount the scanner so they can rescan
      },
    });
  };
```

5. `confirm()` sends the flag:

```tsx
    borrow.mutate({ item_type_id: selected.item_type_id, days,
      with_accessory: kitOffer && withKit ? true : undefined }, {
```

6. Day-picker branch — insert between the presets `div` and the error line:

```tsx
            {kitOffer && (
              <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="h-4 w-4" checked={withKit}
                  onChange={(e) => setWithKit(e.target.checked)} />
                Also take an accessory kit ({kitOffer.available_units} available)
              </label>
            )}
```

7. "All set" branch condition becomes `result && confirmedAsset && (!kitSession || confirmedKitAsset)` and its body shows both ids:

```tsx
            <p className="mb-5 text-sm text-gray-600">
              <span className="font-mono">{confirmedAsset}</span>
              {confirmedKitAsset ? <> and <span className="font-mono">{confirmedKitAsset}</span> are checked out to you.</> : <> is checked out to you.</>} Close the door when you're done.
            </p>
```

8. Scan-step branch (`: result ?`) — swap the instruction paragraph for a step-aware one and surface the kit outcome:

```tsx
            <p className="mb-3 text-sm text-gray-600">
              {!confirmedAsset
                ? "Take your item, then scan the QR label on it to confirm which one you took."
                : "Now scan the accessory box label."}
            </p>
            {kitError && <p className="mb-3 text-sm text-amber-800">{kitError}</p>}
```

(keep `LastReturnNotice` where it is — it describes the camera unit.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web test -- src/screens/BrowseScreen.test.tsx` → 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/BrowseScreen.tsx web/src/screens/BrowseScreen.test.tsx
git commit -m "feat(web): browse offers accessory kit and confirms both labels"
```

---

### Task 7: ScanScreen — kit checkbox

**Files:**
- Modify: `web/src/screens/ScanScreen.tsx`
- Test (create): `web/src/screens/ScanScreen.test.tsx`

**Interfaces:**
- Consumes: `ScannedUnit.accessory`, `useBorrow` with `with_accessory` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `web/src/screens/ScanScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { ScanScreen } from "./ScanScreen";
import { ToastProvider } from "../components/ui";

const UNIT = {
  unit_id: "u1", asset_id: "RACK-0001", status: "available",
  item_type_id: "t1", name: "GoPro 13 Black", category: "Camera",
  accessory: { item_type_id: "t9", name: "GoPro Kit", available_units: 1 },
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={["/scan/RACK-0001"]}>
        <Routes><Route path="/scan/:assetId" element={<ScanScreen />} /></Routes>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

it("offers the accessory kit and sends with_accessory on a label checkout", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/borrow"))
      return { ok: true, status: 200, json: async () => ({
        session_id: "s1", item_unit_id: "u1", due_at: "2026-07-21T00:00:00Z", unlock: "ok",
        last_return: null,
        accessory: { session_id: "s2", item_unit_id: "u2", due_at: "2026-07-21T00:00:00Z" },
      }) };
    if (path.includes("/api/units/by-asset/")) return { ok: true, status: 200, json: async () => UNIT };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  const kitBox = await screen.findByRole("checkbox", { name: /also take an accessory kit \(1 available\)/i });
  expect(kitBox).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: /confirm & unlock/i }));
  expect(await screen.findByText(/accessory kit checked out too/i)).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/borrow"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    item_type_id: "t1", days: 7, unit_id: "u1", with_accessory: true,
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/screens/ScanScreen.test.tsx` — FAIL (no checkbox).

- [ ] **Step 3: Implement**

In `web/src/screens/ScanScreen.tsx`:

1. State: `const [withKit, setWithKit] = useState(true);`
2. Derivation after `const u = unit.data!;`: `const kitOffer = u.accessory && u.accessory.available_units > 0 ? u.accessory : null;`
3. In the available branch, insert between the presets `div` and the error line:

```tsx
          {kitOffer && (
            <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4" checked={withKit}
                onChange={(e) => setWithKit(e.target.checked)} />
              Also take an accessory kit ({kitOffer.available_units} available)
            </label>
          )}
```

4. Borrow call: `borrow.mutate({ item_type_id: u.item_type_id, days, unit_id: u.unit_id, with_accessory: kitOffer && withKit ? true : undefined }, { onSuccess: setResult })`
5. Result view — after the `msg.body` paragraph, before `LastReturnNotice`:

```tsx
        {result.accessory && "session_id" in result.accessory && (
          <p className="mb-2 text-sm text-gray-600">Accessory kit checked out too — confirm both labels from My Items.</p>
        )}
        {result.accessory && "error" in result.accessory && (
          <p className="mb-2 text-sm text-amber-800">{result.accessory.error}</p>
        )}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm --prefix web test -- src/screens/ScanScreen.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/ScanScreen.tsx web/src/screens/ScanScreen.test.tsx
git commit -m "feat(web): scan checkout offers the accessory kit"
```

---

### Task 8: Admin inventory — accessory kit select

**Files:**
- Modify: `web/src/screens/AdminInventoryScreen.tsx`
- Test: `web/src/screens/AdminInventoryScreen.test.tsx`

**Interfaces:**
- Consumes: `AdminItemType.accessory_type_id`, `useUpdateItemType` with `accessory_type_id` (Task 5).

- [ ] **Step 1: Write the failing test**

In `web/src/screens/AdminInventoryScreen.test.tsx`: add `accessory_type_id: null` to both `INVENTORY` fixture types, then append:

```tsx
it("links an accessory kit type via the select", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH")
      return { ok: true, status: 200, json: async () => ({ ...INVENTORY[0], accessory_type_id: "t2" }) };
    if (path.endsWith("/api/admin/item-types")) return { ok: true, status: 200, json: async () => INVENTORY };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await screen.findByText("GoPro 13 Black");
  const selects = screen.getAllByLabelText(/accessory kit/i);
  await userEvent.selectOptions(selects[0], "t2");

  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ accessory_type_id: "t2" });
  });
});
```

(Fixture reminder: `INVENTORY[0]` is id `t1` "GoPro 13 Black", `INVENTORY[1]` is id `t2` "Manus Gloves" — the select for t1 must offer t2 but not t1 itself.)

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/screens/AdminInventoryScreen.test.tsx` — new test FAILs (no select); the four pre-existing pass.

- [ ] **Step 3: Implement**

In `web/src/screens/AdminInventoryScreen.tsx` (main component):

1. Add `const updateItemType = useUpdateItemType();` next to the other mutations (the hook is already imported for the questions editor).
2. Handler next to `setStatus`:

```tsx
  const setAccessory = (id: string, accessory_type_id: string | null) =>
    updateItemType.mutate({ id, body: { accessory_type_id } }, {
      onSuccess: () => toast("Accessory kit updated."),
      onError: (err) => toast(errorMessage(err), "error"),
    });
```

3. In the type card, directly below the "Return questions (…)" button/editor block, add:

```tsx
            <label className="mb-2 flex items-center justify-between text-xs text-gray-500">
              Accessory kit
              <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                value={t.accessory_type_id ?? ""} disabled={updateItemType.isPending}
                onChange={(e) => setAccessory(t.id, e.target.value || null)}>
                <option value="">None</option>
                {inventory.data!.filter((o) => o.id !== t.id).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
```

- [ ] **Step 4: Run tests to verify they pass** — 5/5 in the file.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/AdminInventoryScreen.tsx web/src/screens/AdminInventoryScreen.test.tsx
git commit -m "feat(web): accessory-kit select on admin item types"
```

---

### Task 9: Full verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: All suites**

```bash
npm --prefix api test        # DB-backed tests need the rack_test DB (see README); create it if missing
npm --prefix web test
npm --prefix api run build
npm --prefix web run build
```
Expected: all pass, builds clean.

- [ ] **Step 2: Full smoke against a fresh seed**

Reset per Global Constraints, then `./scripts/smoke-test.sh`.
Expected: `== Results: N passed, 0 failed` (N grew by ~13 across Tasks 2–4).

- [ ] **Step 3: README**

In the Fastify API bullet list, after the return-questions bullet, add:

```markdown
- Item types can link an **accessory kit** type (`accessory_type_id`).
  Borrowing a camera offers "Also take an accessory kit"; the server claims
  a kit unit in the same `POST /api/borrow` (`with_accessory: true`) as a
  second independent session with the same due date — each piece is
  returned, extended, and questionnaired on its own.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: camera accessory kits"
```

- [ ] **Step 5: Browser E2E (controller)**

With the stack running and `web/dist` freshly built: as admin link a camera type to a kit type in Inventory; as user borrow the camera with the checkbox on and confirm both labels; see two rows in My Items; return each independently.
