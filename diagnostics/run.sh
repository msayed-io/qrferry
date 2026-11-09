#!/usr/bin/env bash
set +e
android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.msayed.qrferry.NavigationDiagnosticTest
result=$?
mkdir -p android/app/build/reports/nav-trace
adb pull /sdcard/Android/data/com.msayed.qrferry/files/nav-diagnostic android/app/build/reports/nav-trace/
adb logcat -d > android/app/build/reports/nav-trace/logcat.txt
adb shell dumpsys webviewupdate > android/app/build/reports/nav-trace/webview.txt
exit "$result"
