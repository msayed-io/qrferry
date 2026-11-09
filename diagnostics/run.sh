#!/usr/bin/env bash
set -euo pipefail
mkdir -p android/app/build/reports/nav-trace
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# Run directly so Gradle's post-test uninstall cannot erase the captured traces.
adb shell am instrument -w -r -e class com.msayed.qrferry.NavigationDiagnosticTest com.msayed.qrferry.test/androidx.test.runner.AndroidJUnitRunner | tee android/app/build/reports/nav-trace/instrumentation.txt
adb pull /sdcard/Android/data/com.msayed.qrferry/files/nav-diagnostic android/app/build/reports/nav-trace/
adb logcat -d > android/app/build/reports/nav-trace/logcat.txt
adb shell dumpsys webviewupdate > android/app/build/reports/nav-trace/webview.txt
grep -q 'OK (1 test)' android/app/build/reports/nav-trace/instrumentation.txt
