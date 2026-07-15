#!/usr/bin/env bash
# E2E smoke test for the self-hosted API. Prereqs:
#   docker compose up -d db
#   (cd api && npm run migrate -- --seed) && npx tsx scripts/seed-dev-users.ts
#   deno run --allow-net --allow-env scripts/mock-seam.ts 9911 &
#   SEAM_API_URL=http://127.0.0.1:9911 RESEND_API_URL=http://127.0.0.1:9911 \
#     NODE_ENV=development npm --prefix api run dev &
#   ./scripts/smoke-test.sh
#
# To exercise the Seam-failure compensation path (borrow must cancel the
# session when the door never opens): restart the mock with
# MOCK_SEAM_FAIL=1, then manually POST /api/borrow — expect a 502 response
# and the session left `cancelled` (not stranded `active`). Not scripted here
# since it requires a separately-configured mock; matches previous behavior.
set -uo pipefail
API=${API:-http://127.0.0.1:3000}
PSQL=${PSQL_BIN:-docker compose exec -T db psql -U rack rack}
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok: $1";
  else FAIL=$((FAIL+1)); echo "  FAIL: $1 (expected $2, got $3)"; fi; }
sql() { $PSQL -tA -c "$1"; }
jqv() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const p=process.argv[1];const v=p?p.split(".").reduce((a,k)=>a?.[k],j):j;console.log(Array.isArray(v)?v.length:v??"")}catch{console.log("")}})' "$1"; }

UJ=$(mktemp); AJ=$(mktemp)   # cookie jars
echo "== Auth"
curl -sc "$UJ" "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"user@rack.local","password":"password123"}' >/dev/null
curl -sc "$AJ" "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@rack.local","password":"password123"}' >/dev/null
check "user session works" "user@rack.local" "$(curl -sb "$UJ" "$API/api/me" | jqv email)"
check "unauthenticated is 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/me")"

echo "== Browse + authz"
check "28 item types" "28" "$(curl -sb "$UJ" "$API/api/availability" | jqv '')"
check "non-admin blocked from admin routes" "403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/admin/borrows")"

echo "== Borrow happy path (mock Seam)"
sql "update locks set seam_device_id = 'mock-device-1' where name = 'Main cabinet TTLock';" >/dev/null
GOPRO=$(sql "select id from item_types where name = 'GoPro 13 Black';")
B=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")
S1=$(echo "$B" | jqv session_id)
check "borrow returns session" "yes" "$([ -n "$S1" ] && echo yes || echo no)"
check "unlock ok" "ok" "$(echo "$B" | jqv unlock)"
check "2 audit events" "2" "$(sql "select count(*) from device_events where borrow_session_id='$S1';")"

echo "== Race: 2 concurrent borrows, 1 unit"
OCULUS=$(sql "select id from item_types where name = 'Oculus';")
R1=$(mktemp); R2=$(mktemp)
curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$OCULUS\"}" > "$R1" &
curl -sb "$AJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$OCULUS\"}" > "$R2" &
wait
check "exactly one wins" "1" "$(cat "$R1" "$R2" | grep -c session_id)"
check "exactly one 'no units available'" "1" "$(cat "$R1" "$R2" | grep -c 'no units available')"

echo "== Return"
# Labeled units must be scanned back in — include the asset id when the
# claimed unit has one (fresh seeds have none, so this stays a no-op there).
A1=$(sql "select coalesce(u.asset_id, '') from borrow_sessions s join item_units u on u.id = s.item_unit_id where s.id = '$S1';")
RBODY="{\"session_id\":\"$S1\"}"
[ -n "$A1" ] && RBODY="{\"session_id\":\"$S1\",\"asset_id\":\"$A1\"}"
RET=$(curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "$RBODY")
check "return succeeds" "returned" "$(echo "$RET" | jqv status)"

echo "== Reminders (idempotent)"
B2=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")
S2=$(echo "$B2" | jqv session_id)
sql "update borrow_sessions set due_at = now() - interval '2 days', checked_out_at = now() - interval '9 days' where id = '$S2';" >/dev/null
check "first run emails 1" "1" "$(curl -s -X POST "$API/api/dev/run-reminders" | jqv users_emailed)"
check "second run emails 0" "0" "$(curl -s -X POST "$API/api/dev/run-reminders" | jqv users_emailed)"

echo "== Overdue borrow block"
check "overdue borrower is blocked" "409" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")"
curl -sb "$UJ" "$API/api/borrow/extend" -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$S2\",\"days\":7}" >/dev/null
B6=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")
S6=$(echo "$B6" | jqv session_id)
check "extend clears the block" "yes" "$([ -n "$S6" ] && echo yes || echo no)"
curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S6\"}" >/dev/null

echo "== Return questionnaire config"
SDT=$(curl -sb "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke SD card","category":"Storage","return_questions":[{"id":"q_contents","label":"What is on the card?","kind":"text"},{"id":"q_keep","label":"Important - must not be wiped?","kind":"yes_no","flag_if_yes":true}]}' | jqv id)
check "type created with questions" "yes" "$([ -n "$SDT" ] && echo yes || echo no)"
check "questions echoed on list" "2" "$(curl -sb "$AJ" "$API/api/admin/item-types" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke SD card");console.log(t?t.return_questions.length:"")})')"
check "bad question config rejected" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' -d '{"name":"Bad","category":"X","return_questions":[{"id":"a","label":"L","kind":"nope"}]}')"

curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' \
  -d "{\"item_type_id\":\"$SDT\"}" >/dev/null
B4=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SDT\"}")
S4=$(echo "$B4" | jqv session_id)
check "my-borrows carries questions" "2" "$(curl -sb "$UJ" "$API/api/my-borrows" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).active.find(b=>b.item_name==="Smoke SD card");console.log(a?a.return_questions.length:"")})')"
check "return without yes/no answer is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S4\"}")"
check "unknown answer key is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S4\",\"answers\":{\"zz\":true,\"q_keep\":true}}")"
RET4=$(curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$S4\",\"answers\":{\"q_contents\":\"client shoot raw files\",\"q_keep\":true}}")
check "flagged return succeeds" "returned" "$(echo "$RET4" | jqv status)"
check "return reports flagged" "true" "$(echo "$RET4" | jqv flagged)"
check "flagged unit stays available" "available" "$(sql "select u.status from item_units u join borrow_sessions s on s.item_unit_id = u.id where s.id = '$S4';")"
check "answers stored" "true" "$(sql "select (return_answers->>'q_keep') from borrow_sessions where id = '$S4';")"

ATT=$(curl -sb "$AJ" "$API/api/admin/attention")
check "attention queue has 1" "1" "$(echo "$ATT" | jqv '')"
check "attention row is flagged" "true" "$(echo "$ATT" | jqv 0.return_flagged)"
check "attention answers rendered" "2" "$(echo "$ATT" | jqv 0.answers)"
check "resolve succeeds" "true" "$(curl -sb "$AJ" -X POST "$API/api/admin/attention/$S4/resolve" | jqv resolved)"
check "resolve again is 409" "409" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X POST "$API/api/admin/attention/$S4/resolve")"
check "attention queue empty after resolve" "0" "$(curl -sb "$AJ" "$API/api/admin/attention" | jqv '')"

B5=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SDT\"}")
check "borrow warns about last return" "true" "$(echo "$B5" | jqv last_return.flagged)"
check "warning carries answers" "2" "$(echo "$B5" | jqv last_return.answers)"
S5=$(echo "$B5" | jqv session_id)
check "admin return skips questionnaire" "returned" "$(curl -sb "$AJ" "$API/api/admin/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S5\"}" | jqv status)"

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

curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$CAM\",\"count\":2}" >/dev/null
curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$KIT\"}" >/dev/null
check "availability carries accessory" "1" "$(curl -sb "$UJ" "$API/api/availability" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke Cam");console.log(t?.accessory?t.accessory.available_units:"")})')"
check "unlinked type has null accessory" "yes" "$(curl -sb "$UJ" "$API/api/availability" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke Cam Kit");console.log(t&&t.accessory===null?"yes":"no")})')"

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

# Create-and-link: the kit ships in the item's box, so it doesn't exist in
# inventory yet — one call creates the kit type + units and links it.
SOLO=$(curl -sb "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Solo","category":"Camera"}' | jqv id)
curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SOLO\",\"count\":3}" >/dev/null
AKR=$(curl -sb "$AJ" "$API/api/admin/item-types/$SOLO/accessory-kit" -H 'Content-Type: application/json' -d '{}')
AKID=$(echo "$AKR" | jqv id)
check "kit created with default name" "Smoke Solo Accessory Kit" "$(echo "$AKR" | jqv name)"
check "kit unit count matches item" "3" "$(sql "select count(*) from item_units where item_type_id = '$AKID';")"
check "item linked to new kit" "$AKID" "$(sql "select accessory_type_id from item_types where id = '$SOLO';")"
check "second kit rejected" "409" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X POST "$API/api/admin/item-types/$SOLO/accessory-kit" -H 'Content-Type: application/json' -d '{}')"

echo "== Service requests"
curl -sb "$AJ" -X POST "$API/api/admin/assign-asset-ids" >/dev/null
SRASSET=$(sql "select asset_id from item_units where asset_id is not null limit 1;")
check "missing description is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/service-requests" -H 'Content-Type: application/json' -d "{\"asset_id\":\"$SRASSET\"}")"
check "unknown asset id is 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/service-requests" -H 'Content-Type: application/json' -d '{"asset_id":"RACK-ZZZZ","description":"smoke: does not power on"}')"
SR=$(curl -sb "$UJ" "$API/api/service-requests" -H 'Content-Type: application/json' -d "{\"asset_id\":\"$SRASSET\",\"description\":\"smoke: does not power on\"}")
SRID=$(echo "$SR" | jqv id)
check "raise returns open" "open" "$(echo "$SR" | jqv status)"
check "mine list has 1" "1" "$(curl -sb "$UJ" "$API/api/service-requests" | jqv '')"
check "admin open list has 1" "1" "$(curl -sb "$AJ" "$API/api/admin/service-requests" | jqv '')"
check "resolve succeeds" "resolved" "$(curl -sb "$AJ" -X POST "$API/api/admin/service-requests/$SRID/resolve" | jqv status)"
check "re-resolve is 409" "409" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X POST "$API/api/admin/service-requests/$SRID/resolve")"
check "admin open list empty after resolve" "0" "$(curl -sb "$AJ" "$API/api/admin/service-requests" | jqv '')"

echo "== Draft answers"
# Earlier sessions left active for this user (the extended GoPro loan S2, or
# an Oculus race win) never got their label scanned, and assign-asset-ids
# (above) has since tagged their units — that trips the unconfirmed-checkout
# guard on the next borrow. Clear any such stragglers first.
for row in $(sql "
    select s.id || ':' || u.asset_id
    from borrow_sessions s
    join item_units u on u.id = s.item_unit_id
    where s.user_id = (select id from profiles where email = 'user@rack.local')
      and s.status = 'active' and s.unit_confirmed_at is null and u.asset_id is not null"); do
  sid="${row%%:*}"; aid="${row#*:}"
  curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' \
    -d "{\"session_id\":\"$sid\",\"asset_id\":\"$aid\"}" >/dev/null
done
B10=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SDT\"}")
SD_DRAFT=$(echo "$B10" | jqv session_id)
check "borrow for draft test" "yes" "$([ -n "$SD_DRAFT" ] && echo yes || echo no)"
check "partial draft saved" "true" "$(curl -sb "$UJ" -X PUT "$API/api/borrow/$SD_DRAFT/draft-answers" -H 'Content-Type: application/json' -d '{"answers":{"q_contents":"half-written note"}}' | jqv saved)"
check "my-borrows carries draft" "half-written note" "$(curl -sb "$UJ" "$API/api/my-borrows" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).active.find(b=>b.session_id==="'"$SD_DRAFT"'");console.log(a&&a.draft_answers?a.draft_answers.q_contents:"")})')"
check "unknown draft key is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" -X PUT "$API/api/borrow/$SD_DRAFT/draft-answers" -H 'Content-Type: application/json' -d '{"answers":{"zz":true}}')"
check "wrong type draft is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" -X PUT "$API/api/borrow/$SD_DRAFT/draft-answers" -H 'Content-Type: application/json' -d '{"answers":{"q_keep":"yes"}}')"
check "malformed session id is 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" -X PUT "$API/api/borrow/not-a-uuid/draft-answers" -H 'Content-Type: application/json' -d '{"answers":{}}')"
# assign-asset-ids (above) may have tagged this unit too — include the label
# scan on return when so, same as the earlier "== Return" section.
A10=$(sql "select coalesce(u.asset_id, '') from borrow_sessions s join item_units u on u.id = s.item_unit_id where s.id = '$SD_DRAFT';")
RBODY10="{\"session_id\":\"$SD_DRAFT\",\"answers\":{\"q_contents\":\"final note\",\"q_keep\":false}}"
[ -n "$A10" ] && RBODY10="{\"session_id\":\"$SD_DRAFT\",\"asset_id\":\"$A10\",\"answers\":{\"q_contents\":\"final note\",\"q_keep\":false}}"
RETD=$(curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "$RBODY10")
check "return with full answers succeeds" "returned" "$(echo "$RETD" | jqv status)"
check "draft cleared after return" "" "$(sql "select draft_answers from borrow_sessions where id = '$SD_DRAFT';")"
check "return answers recorded" "t" "$(sql "select (return_answers is not null) from borrow_sessions where id = '$SD_DRAFT';")"

echo "== Cleanup"
# Delete every 'Smoke *' type this run created via the admin API, so the dev
# DB (and the admin UI's dropdowns) don't accumulate test litter. Cascade by
# hand — the FKs are NO ACTION: events -> sessions -> requests -> units ->
# types, with accessory links to smoke types nulled first.
sql "
  delete from service_requests;
  delete from device_events where borrow_session_id in (
    select s.id from borrow_sessions s
    join item_units u on u.id = s.item_unit_id
    where u.item_type_id in (select id from item_types where name like 'Smoke %'));
  delete from borrow_sessions where item_unit_id in (
    select id from item_units
    where item_type_id in (select id from item_types where name like 'Smoke %'));
  delete from item_requests where item_type_id in (select id from item_types where name like 'Smoke %');
  delete from item_units where item_type_id in (select id from item_types where name like 'Smoke %');
  update item_types set accessory_type_id = null
    where accessory_type_id in (select id from item_types where name like 'Smoke %');
  delete from item_types where name like 'Smoke %';
" >/dev/null
check "smoke artifacts cleaned up" "0" "$(sql "select count(*) from item_types where name like 'Smoke %';")"

echo; echo "== Results: $PASS passed, $FAIL failed"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
