#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BhuRakshak — native APK API-contract test (run against port 3100, the port
# the user's LAN setup uses). Reproduces EXACTLY what the Android app calls:
#   register → notifications → message(SOS) → thread → checkin → gauge
#   then the website side: login → inbox → reply → thread (two-way proof)
# ─────────────────────────────────────────────────────────────────────────────
BASE="${1:-http://localhost:3100}"
DEV="android-test-$(date +%s)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check(){ if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1 — got: $(echo "$2" | head -c 160)"; fi }

echo "── native app flow against $BASE (device: $DEV)"

# 1. register (what ConnectActivity + AlertService heartbeat call)
R=$(curl -s -m 10 -X POST "$BASE/api/app/register" -H 'Content-Type: application/json' \
    -d "{\"deviceId\":\"$DEV\",\"name\":\"Native test phone\"}")
check "device registers" "$R" '"ok":true'

# 2. notifications poll (AlertService + ALERTS tab)
R=$(curl -s -m 10 "$BASE/api/app/notifications" -H "x-device-id: $DEV")
check "notifications poll (device auth)" "$R" '"notifications"'
check "sms fan-out in payload" "$R" '"sms"'

# 3. SOS with position (CHAT tab → zone attribution) — real zone centroid
R=$(curl -s -m 10 -X POST "$BASE/api/app/message" -H 'Content-Type: application/json' \
    -H "x-device-id: $DEV" \
    -d '{"category":"sos","body":"Crack widening on the hill above NH-6, houses at risk","lat":25.7732,"lon":91.5100}')
check "SOS send" "$R" '"ok":true'
check "SOS gets zone attribution" "$R" 'ML-EKH'
check "SOS priority urgent" "$R" '"priority":1'

# 4. thread fetch (CHAT tab render)
R=$(curl -s -m 10 "$BASE/api/app/messages" -H "x-device-id: $DEV")
check "thread fetch shows own SOS" "$R" 'Crack widening'

# 5. I'M SAFE check-in (STATUS tab)
R=$(curl -s -m 10 -X POST "$BASE/api/app/checkin" -H 'Content-Type: application/json' \
    -H "x-device-id: $DEV" -d '{"lat":25.7732,"lon":91.5100,"message":"team at shelter"}')
check "I'M SAFE check-in" "$R" '"ok":true'

# 6. manual rain gauge (STATUS tab → real engine pass) — on the same zone
R=$(curl -s -m 20 -X POST "$BASE/api/app/gauge" -H 'Content-Type: application/json' \
    -H "x-device-id: $DEV" -d '{"lat":25.7732,"lon":91.5100,"rain1h":62,"rain24h":180}')
check "rain gauge reading accepted" "$R" '"ok":true'

# 7. website side: login (session cookie)
JAR=/tmp/native-test-cookies.txt; rm -f "$JAR"
R=$(curl -s -m 10 -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@bhrakshak.in","password":"Admin@123"}')
check "website login" "$R" '"role":"admin"'

# 8. website inbox sees the SOS
R=$(curl -s -m 10 -b "$JAR" "$BASE/api/messages")
check "dashboard inbox shows SOS" "$R" 'Crack widening'
check "dashboard inbox counts SOS open" "$R" '"sos":1'

# 9. command staff replies to the phone
ID=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);m=[x for x in d['messages'] if x['deviceId'] and '$DEV' in str(x.get('deviceId'))] or [x for x in d['messages'] if 'Crack widening' in x['body']];print(m[0]['id'] if m else '')" 2>/dev/null)
if [ -z "$ID" ]; then ID=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print([x for x in d['messages'] if 'Crack' in x['body']][0]['id'])"); fi
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/messages" -H 'Content-Type: application/json' \
    -d "{\"replyToId\":\"$ID\",\"body\":\"Copy your SOS. NDRF team dispatched to your zone, evacuate to Tuichang shelter now.\"}")
check "dashboard reply sent" "$R" '"ok":true'

# 10. phone sees the reply in its thread (two-way closed loop)
R=$(curl -s -m 10 "$BASE/api/app/messages" -H "x-device-id: $DEV")
check "phone thread shows command reply" "$R" 'NDRF team dispatched'
check "reply is from command role" "$R" '"authorRole":"command"'

# 11. inject storm → phone notifications must receive the L3/L4 events
R=$(curl -s -m 30 -b "$JAR" -X POST "$BASE/api/demo/storm" -H 'Content-Type: application/json' -d '{"district":"East Khasi Hills"}')
check "storm injected" "$R" '"ok":true'
check "storm fans out notifications" "$R" '"notificationsSent":'
R=$(curl -s -m 15 "$BASE/api/app/notifications" -H "x-device-id: $DEV")
check "phone receives storm alerts (level present)" "$R" '"level":4'
check "phone receives SMS fan-out" "$R" '"status"'

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL CHECKS GREEN — native app contract verified end-to-end"
exit $FAIL
