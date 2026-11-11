#!/usr/bin/env bash
set -uo pipefail
reports=android/app/build/reports
mkdir -p "$reports"
apk=android/app/build/outputs/apk/debug/app-debug.apk
trap 'adb logcat -d > "$reports/local-logcat.txt" || true' EXIT
# Establish runtime grants before the instrumentation process starts. Closing a
# UiAutomation shell descriptor immediately does not wait for pm grant to finish.
adb install -r -g "$apk" || exit $?
grant_all_files
# An idle emulator dims its display, and the dim scrim changes every pixel the
# optical assertions sample. Keep the panel on and undimmed for the whole run.
adb shell svc power stayon true >/dev/null 2>&1
adb shell settings put system screen_off_timeout 2147483647 >/dev/null 2>&1
adb shell settings put system screen_dim_timeout 2147483647 >/dev/null 2>&1
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
# "All files access" is an app-op, not a runtime permission, and `adb install -r`
# resets app-ops. It is therefore re-applied after EVERY install: otherwise the
# automatic storage prompt on Send opens a system settings screen in the middle
# of an interaction test and steals focus from the WebView.
grant_all_files(){ adb shell appops set com.msayed.qrferry MANAGE_EXTERNAL_STORAGE allow >/dev/null 2>&1 || true; }
api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
run_suite(){ android/gradlew --no-daemon -p android :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class="$1"; }
if [ "$api" -ge 35 ]; then
  # Native, JVM-side and WebView-integration classes first; the packaged UI suite
  # runs in its own instrumentation process so a window left by an earlier class
  # cannot steal focus from its consent dialogs.
  run_suite com.msayed.qrferry.ChromePolicyTest,com.msayed.qrferry.FloatingChromeTest,com.msayed.qrferry.SpecularRimTest,com.msayed.qrferry.NativeIntegrationTest,com.msayed.qrferry.local.LocalNativeTest,com.msayed.qrferry.local.LocalRecoveryProcessTest || exit $?
  adb install -r -g "$apk" || exit $?
  grant_all_files
  run_suite com.msayed.qrferry.local.LocalUiTest || exit $?
  # Real device pixels of every local screen travel with the report: the chrome is
  # reviewed against the app's own History/Privacy capsules, not against prose.
  shots=android/app/build/reports/local-shots
  rm -rf "$shots"; mkdir -p "$shots"
  adb exec-out run-as com.msayed.qrferry cat cache/shots.zip > /tmp/local-shots.zip 2>/dev/null && \
   unzip -qo /tmp/local-shots.zip -d "$shots" >/dev/null 2>&1 || true
  echo "screenshots: $(ls "$shots" | wc -l)"
else
  # API 24/29 cover the native subsystem only: their bundled WebView cannot run
  # the modern packaged UI suite.
  run_suite com.msayed.qrferry.local.LocalNativeTest,com.msayed.qrferry.local.LocalRecoveryProcessTest || exit $?
fi
# Recovery must work from disk, not from a surviving in-process engine: write the
# record in one instrumentation process, force-stop the app, then restore in a
# second process. Both phases are native-only, so every API level runs them.
# `am instrument` is used directly because Gradle uninstalls the APKs (and would
# delete the journal) after a connected test run.
test_apk=android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb install -r -g "$apk" || exit $?
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
