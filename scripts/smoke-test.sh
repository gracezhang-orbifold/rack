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

echo; echo "== Results: $PASS passed, $FAIL failed"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
