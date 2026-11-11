#!/usr/bin/env bash
set -uo pipefail
reports=android/app/build/reports
mkdir -p "$reports"
trap 'adb logcat -d > "$reports/local-logcat.txt" || true' EXIT
# Establish runtime grants before the instrumentation process starts. Closing a
# UiAutomation shell descriptor immediately does not wait for pm grant to finish.
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk || exit $?
api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
if [ "$api" -ge 35 ]; then
  # Also retain every existing native UI/optical integration assertion on the
  # modern WebView. API 24 below covers the native subsystem, not its old WebView.
  android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest
else
  android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.msayed.qrferry.local.LocalNativeTest,com.msayed.qrferry.local.LocalRecoveryProcessTest
fi || exit $?
# Recovery must work from disk, not from a surviving in-process engine: write the
# record in one instrumentation process, force-stop the app, then restore in a
# second process. Both phases are native-only, so every API level runs them.
# `am instrument` is used directly because Gradle uninstalls the APKs (and would
# delete the journal) after a connected test run.
test_apk=android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk || exit $?
adb install -r -g "$test_apk" || exit $?
recovery_phase(){
  adb shell am instrument -w -e class com.msayed.qrferry.local.LocalRecoveryProcessTest \
    -e recoveryStage "$1" com.msayed.qrferry.test/androidx.test.runner.AndroidJUnitRunner \
    > "$reports/recovery-$1.txt" 2>&1
  if grep -q 'OK (1 test)' "$reports/recovery-$1.txt"; then return 0; fi
  echo "recovery stage $1 failed"; cat "$reports/recovery-$1.txt"; return 1
}
recovery_phase checkpoint || exit 1
adb shell am force-stop com.msayed.qrferry || exit $?
recovery_phase restore || exit 1
