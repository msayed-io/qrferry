#!/usr/bin/env bash
set -uo pipefail
mkdir -p android/app/build/reports
trap 'adb logcat -d > android/app/build/reports/local-logcat.txt || true' EXIT
android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.msayed.qrferry.local.LocalNativeTest
