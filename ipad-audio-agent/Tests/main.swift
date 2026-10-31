import Foundation

let timelineStart = ContinuousClock.now
var timeline = TurnTimeline()
timeline.record("Ignored before start")
assert(timeline.entries.isEmpty && timeline.elapsed() == nil)
timeline.start("Fertig", at: timelineStart)
timeline.record("Transkript bereit", since: timelineStart.advanced(by: .milliseconds(20)),
                at: timelineStart.advanced(by: .milliseconds(250)))
assert(timeline.entries.last?.elapsed == 0.25)
assert(timeline.entries.last?.duration == 0.23)
timeline.record("LLM-Anfrage", at: timelineStart.advanced(by: .milliseconds(260)))
timeline.finish("Abgebrochen", at: timelineStart.advanced(by: .milliseconds(500)))
timeline.record("Late response", at: timelineStart.advanced(by: .seconds(2)))
timeline.finish("Late completion", at: timelineStart.advanced(by: .seconds(3)))
assert(!timeline.isRunning && timeline.entries.last?.label == "Abgebrochen")
assert(timeline.elapsed(at: timelineStart.advanced(by: .seconds(10))) == 0.5, "Finished timelines must freeze")
timeline.start("Neue Anfrage", at: timelineStart.advanced(by: .seconds(20)))
assert(timeline.entries.count == 1 && timeline.entries.first?.elapsed == 0)
for index in 1...40 { timeline.record("Event \(index)") }
assert(timeline.entries.count == 32 && Set(timeline.entries.map(\.id)).count == 32)
print("Passed: timeline offsets, stage durations, cancellation, reset, and bounded event storage.")

assert(PocketAssets.includes("v2.1/german/constants_bin/alba.safetensors"))
assert(PocketAssets.includes("v2.1/german/constants_bin/tokenizer.model"))
assert(PocketAssets.includes("v2.1/german/flowlm_step.mlmodelc/weights/weight.bin"))
assert(!PocketAssets.includes("v2.1/german/constants_bin/cosette.safetensors"), "Noncommercial voices must not be downloaded")
assert(!PocketAssets.includes("v2.1/german/constants_bin/jean.safetensors"))
assert(!PocketAssets.includes("v2.1/german/constants_bin/juergen.safetensors"), "Only the explicitly reviewed voice is allowed")
assert(!PocketAssets.includes("v2.1/german/flowlm_step.mlpackage/weights/weight.bin"))
assert(!PocketAssets.includes("v2.1/german/mimi_encoderv3.mlmodelc/model.mil"))
assert(!PocketAssets.includes("v2.1/english/constants_bin/alba.safetensors"))
assert(!PocketAssets.includes("v2.1/german/flowlm_step.mlmodelc/../../other"))
print("Passed: Pocket downloads only the reviewed German model and commercially licensed Alba voice.")

assert(germanVoiceRank(language: "en-US", quality: 3) == 0)
assert(germanVoiceRank(language: "de-AT", quality: 3) > germanVoiceRank(language: "de-DE", quality: 2))
assert(germanVoiceRank(language: "de-DE", quality: 2) > germanVoiceRank(language: "de-DE", quality: 1))
assert(germanVoiceRank(language: "de-DE", quality: 3) > germanVoiceRank(language: "de-AT", quality: 3))
print("Passed: German voices prefer quality before regional fallback and exclude other languages.")

// Runnable without iPad hardware, downloaded models, or a test framework.
assert(Conversation.isEndCommand("  STOPP!\n"))
assert(Conversation.isEndCommand("Gespräch   beenden."))
assert(Conversation.isEndCommand("Ich möchte jetzt aufhören!"))
assert(!Conversation.isEndCommand("Was bedeutet Stopp?"))
assert(!Conversation.isEndCommand("„Stopp“"))
assert(!Conversation.isEndCommand(""))

let vienna = TimeZone(identifier: "Europe/Vienna")!
let morning = ISO8601DateFormatter().date(from: "2026-09-24T05:00:00Z")!
let evening = ISO8601DateFormatter().date(from: "2026-09-24T19:00:00Z")!
let night = ISO8601DateFormatter().date(from: "2026-09-24T21:00:00Z")!
assert(Conversation.greetingReply("  GUTEN   MORGEN!\n", at: morning, timeZone: vienna) == "Guten Morgen. Wie geht es dir heute?")
assert(Conversation.greetingReply("Hallo", firstName: "  Amelie  ", at: evening, timeZone: vienna) == "Guten Abend, Amelie. Wie geht es dir heute?")
assert(Conversation.greetingReply("Hallo", firstName: " \n ", at: night, timeZone: vienna) == "Hallo. Wie geht es dir heute?")
assert(Conversation.greetingReply("Hallo.") != nil)
assert(Conversation.greetingReply("Guten Abend") != nil)
assert(Conversation.greetingReply("Guten Morgen, mir geht es schlecht") == nil, "A greeting with a real request must reach the model")
assert(Conversation.greetingReply("Was bedeutet guten Morgen?") == nil)
assert(Conversation.greetingReply("Stopp") == nil)
print("Passed: only standalone greetings bypass generation; requests and stop commands keep their own paths.")

var conversation = Conversation()
let cancelledTurn = conversation.turnID
conversation.invalidate()
assert(!conversation.complete(cancelledTurn, user: "Anna", reply: "Hallo Anna"))
assert(conversation.exchanges.isEmpty, "A late reply from a cancelled turn must not enter memory")

for number in 1...50 {
    conversation.invalidate()
    assert(conversation.complete(conversation.turnID, user: "Nachricht \(number)", reply: "Antwort \(number)"))
}
assert(conversation.exchanges.count == 3)
assert(conversation.exchanges.first?.user == "Nachricht 48")
assert(conversation.exchanges.last?.reply == "Antwort 50")

conversation.invalidate()
conversation.complete(conversation.turnID, user: String(repeating: "ü", count: 1_000), reply: String(repeating: "a", count: 1_500))
conversation.invalidate()
conversation.complete(conversation.turnID, user: String(repeating: "ö", count: 1_000), reply: "Kurz.")
assert(conversation.exchanges.count == 1, "Drop whole old exchanges when the memory budget is exceeded")
let endedTurn = conversation.turnID
conversation.clear()
assert(conversation.exchanges.isEmpty)
assert(!conversation.accepts(endedTurn))
assert(!conversation.complete(endedTurn, user: "Old", reply: "Must be ignored"))
print("Passed: German end commands, cancelled/ended turns, and bounded conversation memory.")

let start = ContinuousClock.now
var download = SpeechDownload(started: start)
download.sample(nil, now: start.advanced(by: .seconds(30)))
assert(download.fraction == nil, "Unknown download size must stay indeterminate")
assert(download.elapsedSeconds == 30)
assert(!download.timedOut)
let progress = Progress(totalUnitCount: 100)
progress.completedUnitCount = 37
download.sample(progress, now: start.advanced(by: .seconds(45)))
assert(download.fraction == 0.37)
progress.completedUnitCount = 100
download.sample(progress, now: start.advanced(by: .seconds(60)))
assert(download.description.contains("Installation"), "100% downloaded is not the same as installed")
download.sample(nil, now: start.advanced(by: .seconds(599)))
assert(!download.timedOut, "Sparse progress must not prematurely fail a slow download")
download.sample(nil, now: start.advanced(by: .seconds(600)))
assert(download.timedOut, "Preparation must not wait forever")
download = SpeechDownload(started: start.advanced(by: .seconds(600)))
assert(!download.timedOut && download.fraction == nil, "Retry starts with fresh progress and deadline")
print("Passed: indeterminate/known progress, installation status, timeout, and retry reset.")

// Exercise interrupted setup, stale revisions, and missing files for both downloaded engines.
let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: cache) }
let required: Set<String> = ["model", "voice.json"]
let marker = cache.appendingPathComponent(".soundflux-complete")
try Data().write(to: cache.appendingPathComponent("model"))
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: required))
try "v1".write(to: marker, atomically: true, encoding: .utf8)
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: required), "Missing voice must trigger setup")
try Data().write(to: cache.appendingPathComponent("voice.json"))
assert(voiceAssetsComplete(at: cache, revision: "v1", required: required))
assert(!voiceAssetsComplete(at: cache, revision: "v2", required: required), "A changed pin must not reuse an old completion marker")
try FileManager.default.removeItem(at: marker)
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: required), "Partial caches cannot be treated as installed")
print("Passed: voice caches require matching revisions, complete assets, and successful-download markers.")

// An older F1-only install must fetch the other profiles before all voices become ready.
let voiceDirectory = cache.appendingPathComponent("voice_styles")
try FileManager.default.createDirectory(at: voiceDirectory, withIntermediateDirectories: true)
try "v1".write(to: marker, atomically: true, encoding: .utf8)
try Data().write(to: voiceDirectory.appendingPathComponent("F1.json"))
let allProfiles = Set(["F", "M"].flatMap { prefix in (1...5).map { "voice_styles/\(prefix)\($0).json" } })
let allVoiceAssets = required.union(allProfiles)
assert(voiceAssetsComplete(at: cache, revision: "v1", required: required.union(["voice_styles/F1.json"])))
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: allVoiceAssets), "An F1-only cache is not ready for ten voices")
for profile in allProfiles { try Data().write(to: cache.appendingPathComponent(profile)) }
assert(voiceAssetsComplete(at: cache, revision: "v1", required: allVoiceAssets), "Complete voice profiles must be reusable offline")
try FileManager.default.removeItem(at: voiceDirectory.appendingPathComponent("M5.json"))
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: allVoiceAssets), "An interrupted upgrade must remain retryable")
print("Passed: F1-only caches upgrade to all ten voices; missing profiles trigger setup.")

// Downloading acceleration must preserve a usable offline baseline on failure.
let baseline: Set<String> = ["model", "voice.json"]
let accelerated = baseline.union(["fast-128", "fast-256", "fast-512"])
let fastMarker = ".soundflux-ane-complete"
assert(voiceAssetsComplete(at: cache, revision: "v1", required: baseline))
try Data().write(to: cache.appendingPathComponent("fast-128"))
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: accelerated, markerName: fastMarker), "All acceleration buckets are required")
assert(voiceAssetsComplete(at: cache, revision: "v1", required: baseline), "Partial acceleration must not invalidate the fallback")
for path in ["fast-256", "fast-512"] { try Data().write(to: cache.appendingPathComponent(path)) }
assert(!voiceAssetsComplete(at: cache, revision: "v1", required: accelerated, markerName: fastMarker), "The baseline marker cannot certify a partial acceleration download")
try "v1".write(to: cache.appendingPathComponent(fastMarker), atomically: true, encoding: .utf8)
assert(voiceAssetsComplete(at: cache, revision: "v1", required: accelerated, markerName: fastMarker))
print("Passed: partial acceleration remains retryable and preserves the offline fallback.")

// The shared test phrase must exercise inference, not the fast greeting shortcut.
assert(ReplyModel.allCases.count == 4)
assert(Conversation.greetingReply(ReplyModel.exampleInput) == nil)
assert(!Conversation.isEndCommand(ReplyModel.exampleInput))
let qwenModels = ReplyModel.allCases.filter { $0 != .apple }
assert(Set(qwenModels.compactMap(\.repository)).count == qwenModels.count)
assert(ReplyModel(rawValue: "Qwen3.5 2B") == .qwen35_2)
for model in qwenModels {
    assert(model.revision.count == 40 && model.repository!.hasSuffix("-4bit"))
    assert(!model.downloadSize.isEmpty)
}
let qwen35 = ReplyModel.qwen35_2
for file in qwen35.requiredFiles.subtracting(["chat_template.jinja"]) {
    try Data().write(to: cache.appendingPathComponent(file))
}
try qwen35.revision.write(to: cache.appendingPathComponent(".soundflux-complete"), atomically: true, encoding: .utf8)
assert(!voiceAssetsComplete(at: cache, revision: qwen35.revision, required: qwen35.requiredFiles),
       "Qwen3.5 requires its separate chat template for offline replies")
try Data().write(to: cache.appendingPathComponent("chat_template.jinja"))
assert(voiceAssetsComplete(at: cache, revision: qwen35.revision, required: qwen35.requiredFiles))
print("Passed: distinct pinned Qwen models and a test input that reaches the LLM.")

// Prompt edits survive relaunch; invalid drafts cannot overwrite the active prompt.
let promptSuite = "SoundFlux.PromptCheck.\(UUID().uuidString)"
let promptDefaults = UserDefaults(suiteName: promptSuite)!
defer { promptDefaults.removePersistentDomain(forName: promptSuite) }
let bundledPrompt = try String(contentsOfFile: "App/Instructions.de.txt", encoding: .utf8)
var prompt = SystemPrompt(defaultText: bundledPrompt, defaults: promptDefaults)
assert(prompt.usesDefault && SystemPrompt.isValid(prompt.text))
assert(prompt.save("  Antworte kurz auf Deutsch.  "))
assert(prompt.text == "Antworte kurz auf Deutsch." && !prompt.usesDefault)
assert(SystemPrompt(defaultText: bundledPrompt, defaults: promptDefaults).text == prompt.text)
assert(!prompt.save(" \n "))
assert(!prompt.save(String(repeating: "a", count: SystemPrompt.maximumLength + 1)))
assert(SystemPrompt(defaultText: bundledPrompt, defaults: promptDefaults).text == prompt.text)
prompt.reset()
assert(prompt.usesDefault)
assert(SystemPrompt(defaultText: bundledPrompt, defaults: promptDefaults).usesDefault)
// Reset removes the override, so a future bundled default can take effect.
assert(SystemPrompt(defaultText: "Neuer Standard", defaults: promptDefaults).text == "Neuer Standard")
assert(prompt.save(prompt.defaultText))
assert(SystemPrompt(defaultText: "Neuer Standard", defaults: promptDefaults).usesDefault)
print("Passed: prompt persistence, input validation, reset, and updated bundled defaults.")

let contextSuite = "TanteEmma.ContextCheck.\(UUID().uuidString)"
let contextDefaults = UserDefaults(suiteName: contextSuite)!
defer { contextDefaults.removePersistentDomain(forName: contextSuite) }
var context = UserContext(defaults: contextDefaults)
assert(context.rows.map(\.key) == ["firstname", "lastname", "yearOfBirth"])
assert(context.rows.map(\.value) == ["Amelie", "Fischer", "1955"])
assert(context.firstName == "Amelie")
let nameRow = context.rows.first!.id
context.update(nameRow, key: " FirstName ", value: "  Anna  ")
assert(context.firstName == "Anna")
assert(Conversation.greetingReply("Guten Morgen", firstName: context.firstName, at: evening, timeZone: vienna) == "Guten Abend, Anna. Wie geht es dir heute?")
context.update(nameRow, value: " \n ")
assert(context.firstName == nil, "A blank first name must not become an address")
context.update(nameRow, key: "firstname", value: "Amelie")
context.add()
let addedRow = context.rows.last!.id
context.update(addedRow, key: "Lieblingsessen", value: "Apfelkuchen\nmit \"Zimt\"")
assert(context.issue == nil)
assert(UserContext(defaults: contextDefaults).rows == context.rows)
let year2026 = ISO8601DateFormatter().date(from: "2026-12-30T12:00:00Z")!
let year2027 = ISO8601DateFormatter().date(from: "2027-01-02T12:00:00Z")!
let injected = try context.promptContext(at: year2026, timeZone: vienna)
assert(injected.contains("currentDate: 2026-12-30") && injected.contains("currentTime: 13:00") && injected.contains("timeZone: Europe/Vienna") && injected.contains("currentYear: 2026") && injected.contains("Tante Emma"))
let nextYearContext = try context.promptContext(at: year2027, timeZone: vienna)
assert(nextYearContext.contains("currentYear: 2027"))
let jsonLine = injected.components(separatedBy: "\n")[1]
let pairs = try JSONSerialization.jsonObject(with: Data(jsonLine.utf8)) as! [[String: String]]
assert(pairs.last?["value"] == "Apfelkuchen\nmit \"Zimt\"", "User values must remain data with escaped quotes/newlines")
context.update(addedRow, key: "FIRSTNAME")
assert(context.issue != nil, "Duplicate keys must not produce contradictory profile fields")
context.update(addedRow, key: "Notiz", value: String(repeating: "x", count: UserContext.maximumLength + 1))
assert(context.issue != nil, "Context must fit within the prompt budget")
for row in context.rows { context.remove(row.id) }
assert(UserContext(defaults: contextDefaults).rows.isEmpty, "Removing all rows must not restore the seed profile on relaunch")
assert(context.firstName == nil)
let emptyContext = try context.promptContext(at: year2026)
assert(emptyContext.contains("\n[]\n"))
context.add()
let incompleteContext = try context.promptContext(at: year2026)
assert(incompleteContext.contains("\n[]\n"), "Incomplete rows are omitted")
for _ in 0...UserContext.maximumRows { context.add() }
assert(context.rows.count == UserContext.maximumRows)
print("Passed: editable context, persistence, empty profiles, validation, JSON escaping, and calendar-year rollover.")
