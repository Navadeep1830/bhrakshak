@echo off
rem BhuRakshak demo tunnels: phone APK -> API, web -> dashboard.
npx --yes localtunnel --port 8000 --subdomain bhrakshak-api-demo > "%TEMP%\bhrakshak-tunnel-api.log" 2>&1
