#!/bin/sh
# Runs real model preparation on a connected iPad, then restores the production app.
# Missing models download on the device. Settings are restored by the check.
set -eu
cd "$(dirname "$0")/.."
device=${1:?Usage: sh Tests/check-preparation.sh DEVICE DERIVED_DATA PACKAGES}
derived=${2:?Pass an existing Xcode derived-data directory}
packages=${3:?Pass an existing cloned-source-packages directory}
check_dir=$(mktemp -d "${TMPDIR:-/tmp}/tante-emma-preparation.XXXXXX")
app="$derived/Build/Products/Release-iphoneos/SoundFlux.app"
build() {
    xcodebuild -project "$1/SoundFlux.xcodeproj" -scheme SoundFlux -configuration Release \
        -destination 'generic/platform=iOS' -derivedDataPath "$derived" \
        -clonedSourcePackagesDirPath "$packages" -disableAutomaticPackageResolution \
        -skipPackageUpdates build > "$check_dir/build.log" 2>&1 || { tail -50 "$check_dir/build.log"; return 1; }
}
build "$PWD"
cp -R "$app" "$check_dir/SoundFlux.app"
restore() {
    ditto "$check_dir/SoundFlux.app" "$app"
    xcrun devicectl device install app --device "$device" "$check_dir/SoundFlux.app"
    xcrun devicectl device process launch --device "$device" --terminate-existing com.soundflux.ipadagent
}
trap restore EXIT
mkdir "$check_dir/project"
cp -R App Info.plist SoundFlux.xcodeproj "$check_dir/project/"
cp Tests/PreparationCheck.swift "$check_dir/project/App/SoundFluxApp.swift"
build "$check_dir/project"
xcrun devicectl device install app --device "$device" "$app"
xcrun devicectl device process launch --device "$device" --terminate-existing --console com.soundflux.ipadagent > "$check_dir/check.log" 2>&1
cat "$check_dir/check.log"
grep -q 'PREPARATION CHECK PASSED' "$check_dir/check.log"
