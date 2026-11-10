#!/usr/bin/env bash
set -euo pipefail
mkdir -p android/app/build/reports/nav-trace
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
classes='com.msayed.qrferry.NavigationDiagnosticTest,com.msayed.qrferry.ChromePolicyTest'
count=2
if [ "${1:-31}" -ge 33 ]; then classes="com.msayed.qrferry.NativeIntegrationTest,$classes"; count=9; fi
if [ "${2:-}" = functional ]; then
  classes='com.msayed.qrferry.ChromePolicyTest,com.msayed.qrferry.SpecularRimTest,com.msayed.qrferry.FloatingChromeTest'; count=4
  if [ "${1:-31}" -ge 33 ]; then classes="com.msayed.qrferry.NativeIntegrationTest,$classes"; count=9; fi
fi
# Run directly so Gradle's post-test uninstall cannot erase the captured traces.
adb shell am instrument -w -r -e class "$classes" com.msayed.qrferry.test/androidx.test.runner.AndroidJUnitRunner | tee android/app/build/reports/nav-trace/instrumentation.txt
if adb shell test -d /sdcard/Android/data/com.msayed.qrferry/files/nav-diagnostic; then adb pull /sdcard/Android/data/com.msayed.qrferry/files/nav-diagnostic android/app/build/reports/nav-trace/; fi
adb logcat -d > android/app/build/reports/nav-trace/logcat.txt
adb shell dumpsys webviewupdate > android/app/build/reports/nav-trace/webview.txt
grep -Eq "OK \($count tests?\)" android/app/build/reports/nav-trace/instrumentation.txt
