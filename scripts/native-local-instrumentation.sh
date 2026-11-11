#!/usr/bin/env bash
set -uo pipefail
mkdir -p android/app/build/reports
trap 'adb logcat -d > android/app/build/reports/local-logcat.txt || true' EXIT
# Establish runtime grants before the instrumentation process starts. Closing a
# UiAutomation shell descriptor immediately does not wait for pm grant to finish.
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk || exit $?
android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.msayed.qrferry.local.LocalNativeTest
