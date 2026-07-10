#!/usr/bin/env bash
# End-to-end smoke test against the local Supabase stack. No hardware needed —
# Seam is mocked by scripts/mock-seam.ts.
#
# Prereqs:
#   1. supabase start        (requires Docker)
#   2. supabase db reset     (migrations + seed)
#   3. printf 'SEAM_API_KEY=mock\nSEAM_API_URL=http://host.docker.internal:9911\nRESEND_API_KEY=mock\nRESEND_API_URL=http://host.docker.internal:9911\nCRON_SECRET=local-cron-secret\n' > supabase/functions/.env
#   4. deno run --allow-net scripts/mock-seam.ts 9911 &
#   5. supabase functions serve --env-file supabase/functions/.env &
#   6. ./scripts/smoke-test.sh

set -uo pipefail

API=${SUPABASE_API_URL:-http://127.0.0.1:54321}
ANON_KEY=${SUPABASE_ANON_KEY:-$(supabase status --output json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).ANON_KEY??JSON.parse(d).anon_key??""))')}
DB_URL=${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
CRON_SECRET=${CRON_SECRET:-local-cron-secret}

PASS=0; FAIL=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok: $1"
  else FAIL=$((FAIL+1)); echo "  FAIL: $1 (expected $2, got $3)"; fi
}

# Override PSQL_BIN if psql isn't installed on the host, e.g.
#   PSQL_BIN="docker exec -i supabase_db_rack psql" \
#   SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres" ./scripts/smoke-test.sh
sql() { ${PSQL_BIN:-psql} "$DB_URL" -tA -c "$1"; }

signin() { # signin <email> -> prints access token
  curl -s "$API/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"password123\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).access_token??""))'
}

# FAIL_MODE=1: standalone run of the Seam-failure compensation path only.
# Restart the mock first with MOCK_SEAM_FAIL=1 (the happy-path checks would
# fail against a failing mock, so this mode skips them).
if [ "${FAIL_MODE:-0}" = "1" ]; then
  USER_JWT=$(signin user@rack.local)
  GOPRO13=$(sql "select id from public.item_types where name = 'GoPro 13 Black';")
  sql "update public.locks set seam_device_id = 'mock-device-1' where name = 'Main cabinet TTLock';" >/dev/null
  BF=$(curl -s "$API/functions/v1/borrow" -X POST \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
    -d "{\"item_type_id\":\"$GOPRO13\"}")
  check "borrow reports unlock failure" "yes" "$(echo "$BF" | grep -q 'did not unlock' && echo yes || echo no)"
  check "failed session cancelled (not stranded active)" "yes" \
    "$([ "$(sql "select count(*) from public.borrow_sessions where status = 'cancelled';")" -ge 1 ] && echo yes || echo no)"
  check "unlock_failed audit event logged" "yes" \
    "$([ "$(sql "select count(*) from public.device_events where event_type = 'unlock_failed';")" -ge 1 ] && echo yes || echo no)"
  echo; echo "== Results: $PASS passed, $FAIL failed"
  exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
fi

echo "== Sign in seeded users"
USER_JWT=$(signin user@rack.local)
ADMIN_JWT=$(signin admin@rack.local)
check "user signed in" "yes" "$([ -n "$USER_JWT" ] && echo yes || echo no)"
check "admin signed in" "yes" "$([ -n "$ADMIN_JWT" ] && echo yes || echo no)"

auth_get() { curl -s "$API$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1"; }
auth_status() { curl -s -o /dev/null -w '%{http_code}' "$API$3" -X "$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" "${@:4}"; }

echo "== Browse inventory"
TYPES=$(auth_get "$USER_JWT" "/rest/v1/item_availability?select=item_type_id&limit=100" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))')
check "item_availability visible to user (28 types)" "28" "$TYPES"

echo "== RLS spot checks"
check "user cannot read locks (empty result)" "[]" "$(auth_get "$USER_JWT" "/rest/v1/locks?select=id")"
check "user PATCH item_units blocked" "0" "$(auth_get "$USER_JWT" "/rest/v1/item_units?select=id&limit=1" >/dev/null; curl -s "$API/rest/v1/item_units?status=eq.available" -X PATCH -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"notes":"hax"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(Array.isArray(j)?j.length:0)}catch{console.log(0)}})')"
DIRECT_INSERT=$(auth_status "$USER_JWT" POST "/rest/v1/borrow_sessions" -H "Content-Type: application/json" -d '{"user_id":"22222222-2222-2222-2222-222222222222","item_unit_id":"00000000-0000-0000-0000-000000000000","due_at":"2099-01-01"}')
check "user direct INSERT borrow_sessions rejected" "yes" "$([ "$DIRECT_INSERT" != "201" ] && echo yes || echo no)"

echo "== Pair mock Seam device"
sql "update public.locks set seam_device_id = 'mock-device-1' where name = 'Main cabinet TTLock';" >/dev/null
GOPRO13=$(sql "select id from public.item_types where name = 'GoPro 13 Black';")
OCULUS=$(sql "select id from public.item_types where name = 'Oculus';")

borrow() { # borrow <jwt> <type_id> -> body
  curl -s "$API/functions/v1/borrow" -X POST \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
    -d "{\"item_type_id\":\"$2\"}"
}

echo "== Borrow happy path"
B1=$(borrow "$USER_JWT" "$GOPRO13")
SESSION1=$(echo "$B1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).session_id??""))')
check "borrow returns session" "yes" "$([ -n "$SESSION1" ] && echo yes || echo no)"
check "unlock ok" "ok" "$(echo "$B1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).unlock??""))')"
check "unit now in_use" "1" "$(sql "select count(*) from public.item_units u join public.borrow_sessions s on s.item_unit_id = u.id where s.id = '$SESSION1' and u.status = 'in_use';")"
check "audit events logged (requested+succeeded)" "2" "$(sql "select count(*) from public.device_events where borrow_session_id = '$SESSION1';")"

echo "== Race test: 2 concurrent borrows, 1 unit (Oculus)"
R1=$(mktemp); R2=$(mktemp)
borrow "$USER_JWT" "$OCULUS" > "$R1" &
borrow "$ADMIN_JWT" "$OCULUS" > "$R2" &
wait
WINS=$(cat "$R1" "$R2" | grep -c '"session_id"')
LOSSES=$(cat "$R1" "$R2" | grep -c 'no units available')
check "exactly one borrow wins" "1" "$WINS"
check "exactly one gets 'no units available'" "1" "$LOSSES"

echo "== Return"
RET=$(curl -s "$API/functions/v1/return" -X POST \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION1\"}")
check "return succeeds" "returned" "$(echo "$RET" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).status??""))')"
check "unit available again" "1" "$(sql "select count(*) from public.item_units u join public.borrow_sessions s on s.item_unit_id = u.id where s.id = '$SESSION1' and u.status = 'available';")"

echo "== Seam failure path: run separately with MOCK_SEAM_FAIL=1 on the mock, then FAIL_MODE=1 $0"

echo "== Overdue reminders (idempotency)"
B2=$(borrow "$USER_JWT" "$GOPRO13")
SESSION2=$(echo "$B2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).session_id??""))')
sql "update public.borrow_sessions set due_at = now() - interval '2 days', checked_out_at = now() - interval '9 days' where id = '$SESSION2';" >/dev/null
REM1=$(curl -s "$API/functions/v1/overdue-reminders" -X POST -H "x-cron-secret: $CRON_SECRET" -d '{}')
REM2=$(curl -s "$API/functions/v1/overdue-reminders" -X POST -H "x-cron-secret: $CRON_SECRET" -d '{}')
echo "  first run:  $REM1"
echo "  second run: $REM2"
check "second run sends nothing" "0" "$(echo "$REM2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).overdue_sessions??"-1"))')"
BAD_SECRET=$(curl -s -o /dev/null -w '%{http_code}' "$API/functions/v1/overdue-reminders" -X POST -H "x-cron-secret: wrong" -d '{}')
check "wrong cron secret rejected" "403" "$BAD_SECRET"

echo
echo "== Results: $PASS passed, $FAIL failed"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
