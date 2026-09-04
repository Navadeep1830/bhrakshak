#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BhuRakshak Field — APK build script (no Gradle, no external dependencies)
#
# Builds the WebView client APK from android/ with plain SDK tools:
#   javac → d8 → aapt2 → zipalign → apksigner
#
# Requirements (auto-detected, override with env):
#   JDK_HOME  — JDK 17+ with javac        (default /home/z/android-tools/jdk17)
#   SDK_ROOT  — Android SDK with platforms;android-34 + build-tools;34.0.0
#   (default /home/z/android-tools/android-sdk)
#
# Output: ../apk/BhuRakshakField-v1.0.apk
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

JDK_HOME="${JDK_HOME:-/home/z/android-tools/jdk17}"
SDK_ROOT="${SDK_ROOT:-/home/z/android-tools/android-sdk}"
BT="$SDK_ROOT/build-tools/34.0.0"
PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
export PATH="$JDK_HOME/bin:$BT:$PATH"

VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
OUT="apk/BhuRakshakField-v${VERSION_NAME}.apk"

echo "── [1/7] compiling java"
rm -rf build && mkdir -p build/classes build/dex
javac -source 11 -target 11 -encoding UTF-8 \
      -cp "$PLATFORM" -d build/classes \
      $(find java -name '*.java') 2>&1 | grep -v '^warning' || true

echo "── [2/7] launcher icon"
if [ ! -f res/mipmap-xxxhdpi/ic_launcher.png ]; then
  (cd tools && javac MakeIcon.java && java -Djava.awt.headless=true MakeIcon ..)
fi

echo "── [3/7] dexing (d8, min-api 24)"
d8 --release --min-api 24 --lib "$PLATFORM" \
   --output build/dex \
   $(find build/classes -name '*.class')

echo "── [4/7] packaging resources (aapt2)"
aapt2 compile --dir res -o build/res.zip
aapt2 link -o build/app-unsigned.apk \
   -I "$PLATFORM" \
   --manifest AndroidManifest.xml \
   -A assets \
   --min-sdk-version 24 \
   --target-sdk-version 34 \
   --version-code "$VERSION_CODE" \
   --version-name "$VERSION_NAME" \
   build/res.zip

echo "── [5/7] adding classes.dex"
(cd build && zip -q -j app-unsigned.apk dex/classes.dex)

echo "── [6/7] zipalign"
zipalign -f -p 4 build/app-unsigned.apk build/app-aligned.apk

echo "── [7/7] signing"
if [ ! -f keystore.jks ]; then
  keytool -genkeypair -keystore keystore.jks -alias bhrakshak \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass bhrakshak -keypass bhrakshak \
    -dname "CN=BhuRakshak Field, O=BhuRakshak, L=Shillong, C=IN" 2>/dev/null
fi
mkdir -p ../apk
apksigner sign --ks keystore.jks --ks-key-alias bhrakshak \
   --ks-pass pass:bhrakshak --key-pass pass:bhrakshak \
   --out "../$OUT" build/app-aligned.apk

apksigner verify "../$OUT" && echo ""
echo "✓ APK built: $OUT"
ls -lh "../$OUT" | awk '{print "  size:", $5}'
