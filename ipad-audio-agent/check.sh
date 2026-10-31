#!/bin/sh
set -eu
cd "$(dirname "$0")"
check_dir=$(mktemp -d "${TMPDIR:-/tmp}/soundflux-check.XXXXXX")
trap 'rm -rf "$check_dir"' EXIT
xcrun swiftc -module-cache-path "$check_dir/modules" App/Conversation.swift App/SpeechDownload.swift App/SpeechVoice.swift App/PocketAssets.swift App/TurnTimeline.swift App/ReplyModel.swift App/SystemPrompt.swift App/UserContext.swift Tests/main.swift -o "$check_dir/check"
"$check_dir/check"
plutil -lint Info.plist SoundFlux.xcodeproj/project.pbxproj
