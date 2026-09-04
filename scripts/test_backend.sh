#!/usr/bin/env bash
# BhuRakshak backend verification — app + comms pipeline
set -u
BASE=http://localhost:3000
J=/tmp/bhr-cookie.txt
PASS=0; FAIL=0
chk() { # name, expected-substr, actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — got: $(echo "$3" | head -c 300)"; fi
}

echo "── 1. login"
R=$(curl -s -c $J -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@bhrakshak.in","password":"Admin@123"}')
chk "login ok" '"role":"admin"' "$R"

echo "── 2. device register (no session — pure device flow)"
R=$(curl -s -X POST $BASE/api/app/register -H 'Content-Type: application/json' -d '{"deviceId":"test-phone-01","name":"Test Field Phone","phone":"+919000000001","district":"East Khasi Hills"}')
chk "register ok" '"ok":true' "$R"

echo "── 3. app route planning (device auth header)"
R=$(curl -s -X POST $BASE/api/app/route -H 'Content-Type: application/json' -H 'x-device-id: test-phone-01' -d '{"originLat":25.28,"originLon":91.52,"destLat":25.58,"destLon":91.90}')
chk "route plan ok" '"recommended":true' "$R"
N=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);p=d.get('plan',{});rs=p.get('routes',[]);print(f\"{len(rs)} routes; rec={[r['id'] for r in rs if r.get('recommended')]}; marks={[len(r.get('hazardMarks',[])) for r in rs]}; risk={[r['riskLabel'] for r in rs]}\")" 2>&1)
echo "    → $N"

echo "── 4. app report w/ photo (multipart, device auth)"
R=$(curl -s -m 60 -X POST $BASE/api/app/report -H 'x-device-id: test-phone-01' \
  -F 'category=crack' \
  -F 'notes=Long longitudinal crack widening on the slope below the school, about 40cm wide and growing after last nights rain' \
  -F 'lat=25.2852' -F 'lon=91.5419' \
  -F 'deviceId=test-phone-01' -F 'offlineQueued=1' -F 'clientCreatedAt=2026-09-04T10:12:00.000Z' \
  -F 'photo=@/home/z/my-project/tool-results/test_crack.jpg;type=image/jpeg')
chk "report ingest ok" '"aiPreScreen"' "$R"
echo "    → $(echo "$R" | python3 -c "import json,sys;r=json.load(sys.stdin).get('report',{});print({k:r.get(k) for k in ['aiPreScreen','aiConfidence','aiSource','aiFindings','photoId','zoneCode']})" 2>&1)"
PHOTO_ID=$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin).get('report',{}).get('photoId') or '')" 2>/dev/null)

echo "── 5. media serving"
R=$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' $BASE/api/media/$PHOTO_ID)
chk "media 200 jpeg" '^200 image/' "$R"

echo "── 6. sync batch (offline queue — base64)"
B64=$(base64 -w0 /home/z/my-project/tool-results/test_crack.jpg)
R=$(curl -s -m 90 -X POST $BASE/api/app/sync -H 'Content-Type: application/json' -H "x-device-id: test-phone-01" \
  -d "{\"deviceId\":\"test-phone-01\",\"reports\":[{\"clientCreatedAt\":\"2026-09-04T09:40:00.000Z\",\"category\":\"crack\",\"notes\":\"Crack across the farm road near the culvert, shoulder dropping, water flowing out of it constantly\",\"lat\":25.412,\"lon\":91.688,\"photoDataUrl\":\"data:image/jpeg;base64,$B64\"}]}")
chk "sync ok" '"synced":1' "$R"
echo "    → $(echo "$R" | head -c 240)"

echo "── 7. notifications poll"
R=$(curl -s "$BASE/api/app/notifications?since=2026-09-04T00:00:00Z" -H 'x-device-id: test-phone-01')
chk "notifications ok" '"notifications"' "$R"
echo "    → $(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print('events:',len(d.get('notifications',[])),'sms:',len(d.get('sms',[])))" 2>&1)"

echo "── 8. comms (website)"
R=$(curl -s -b $J $BASE/api/comms)
chk "comms ok" '"devices"' "$R"
echo "    → $(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin).get('stats'))" 2>&1)"

echo "── 9. activity feed (website)"
R=$(curl -s -b $J $BASE/api/activity)
chk "activity ok" '"items"' "$R"
echo "    → $(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);its=d.get('items',[]);from collections import Counter;print('items:',len(its),Counter(i['kind'] for i in its))" 2>&1)"

echo "── 10. storm → engine → SMS + notification fanout"
R=$(curl -s -m 120 -b $J -X POST $BASE/api/demo/storm -H 'Content-Type: application/json' -d '{"district":"East Khasi Hills","peakMmPerH":36,"hours":6}')
chk "storm ok" '"escalatedToL2plus"' "$R"
echo "    → $(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ['escalatedToL2plus','maxLevel','notificationsSent','smsSent']})" 2>&1)"

sleep 7
echo "── 11. SMS delivery settle"
R=$(curl -s -b $J $BASE/api/comms | python3 -c "import json,sys;d=json.load(sys.stdin);print('delivered:',d['stats']['delivered'],'inFlight:',d['stats']['inFlight'],'total:',d['stats']['total'])")
echo "    → $R"

echo "── 12. reports list shows photos + offline fields"
R=$(curl -s -b $J "$BASE/api/reports?status=all")
chk "reports ok" '"photoId"' "$R"


echo "── 13. simulate: dry-run prediction (arbitrary numbers — not hardcoded)"
R=$(curl -s -m 60 -b $J -X POST $BASE/api/simulate/predict -H 'Content-Type: application/json' -d '{"zoneCode":"SK-GNG-001","rain1h":7,"rain24h":30,"soilMoisture":45}')
chk "predict low → L0/L1" '"fusedLevel":0\|"fusedLevel":1' "$R"
R=$(curl -s -m 60 -b $J -X POST $BASE/api/simulate/predict -H 'Content-Type: application/json' -d '{"zoneCode":"SK-GNG-001","rain1h":55,"rain24h":230,"soilMoisture":92}')
chk "predict extreme → L4" '"fusedLevel":4' "$R"
chk "predict has formula" 'sigmoid' "$R"

echo "── 14. simulate: manual condition injection (single zone)"
R=$(curl -s -m 120 -b $J -X POST $BASE/api/simulate/conditions -H 'Content-Type: application/json' -d '{"zoneCode":"SK-GNG-002","rain1h":50,"rain24h":200,"soilMoisture":90}')
chk "inject ok" '"zonesInjected":1' "$R"
chk "inject escalated + comms" '"escalated":1' "$R"

echo "── 15. simulate: reset/decay"
R=$(curl -s -m 120 -b $J -X POST $BASE/api/simulate/reset -H 'Content-Type: application/json' -d '{"district":"Gangtok"}')
chk "reset ok" '"deescalated"' "$R"

echo "── 16. turn-by-turn steps in route plan"
R=$(curl -s -m 60 -X POST $BASE/api/app/route -H 'Content-Type: application/json' -H 'x-device-id: test-phone-01' -d '{"originLat":25.28,"originLon":91.52,"destLat":25.58,"destLon":91.90,"destName":"Test shelter"}')
chk "steps present" '"steps"' "$R"
chk "via present" '"via"' "$R"
N=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);rs=d['plan']['routes'];print('; '.join(f\"{r['id']}: {len(r['steps'])} steps, via={r.get('via')}, first={r['steps'][0]['instruction'] if r['steps'] else '-'}\" for r in rs))")
echo "    → $N"

echo "── 17. zones topDriver (real ML driver, not canned text)"
R=$(curl -s -b $J $BASE/api/zones)
chk "topDriver present" '"topDriver":{"name"' "$R"

echo "── 18. analytics live telemetry"
R=$(curl -s -b $J $BASE/api/analytics)
chk "engineLive present" '"engineLive"' "$R"
chk "registry live" '"registry"' "$R"
chk "recentRuns present" '"recentRuns"' "$R"


echo ""
echo "RESULT: $PASS passed, $FAIL failed"
