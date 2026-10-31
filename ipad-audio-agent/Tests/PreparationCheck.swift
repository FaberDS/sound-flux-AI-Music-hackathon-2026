import FluidAudio
import SwiftUI

// Temporary app entry point used by check-preparation.sh; never bundled in production.
@main
struct PreparationCheckApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Automatische Vorbereitung wird geprüft …").task {
                do {
                    try await checkPreparation()
                    print("PREPARATION CHECK PASSED")
                    exit(0)
                } catch {
                    print("PREPARATION CHECK FAILED: \(error)")
                    exit(1)
                }
            }
        }
    }
}

private struct CheckFailure: Error { let message: String }

@MainActor
private func checkPreparation() async throws {
    func expect(_ condition: Bool, _ message: String) throws {
        if !condition { throw CheckFailure(message: message) }
    }
    func waitUntilReady(_ agent: VoiceAgent) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(600))
        while agent.busy {
            try expect(ContinuousClock.now < deadline, "Preparation timed out")
            try await Task.sleep(for: .milliseconds(100))
        }
        try expect(agent.modelIssue == nil && agent.voiceReady, agent.notice ?? agent.modelIssue ?? "Voice not ready")
    }

    let defaults = UserDefaults.standard
    let keys = ["replyModel", "speechOutput", "supertonicSpeaker", "speaksReplies"]
    let saved = keys.map { defaults.object(forKey: $0) }
    defer {
        for (key, value) in zip(keys, saved) { defaults.set(value, forKey: key) }
        defaults.synchronize()
    }
    for key in keys { defaults.set("unknown", forKey: key) }
    var agent = VoiceAgent()
    defer { agent.stop() }
    try expect(agent.replyModel == .apple && agent.speechOutput == .apple && agent.supertonicSpeaker == .f1,
               "Invalid saved selections must fall back to Apple/F1")

    agent.selectReplyModel(.qwen06)
    try expect(agent.phase == .preparingModel, "Selecting Qwen must start preparation immediately")
    try await waitUntilReady(agent)
    agent.selectSpeechOutput(.supertonic)
    try expect(agent.phase == .preparingVoice, "Selecting Supertonic must start preparation immediately")
    try await waitUntilReady(agent)
    agent.selectSupertonicSpeaker(.f3)
    print("PASSED: preparation on selection")

    agent = VoiceAgent()
    try expect(agent.replyModel == .qwen06 && agent.speechOutput == .supertonic && agent.supertonicSpeaker == .f3,
               "Selections must survive a fresh agent")
    await agent.start()
    try expect(agent.phase == .preparingModel, "Startup must prepare the saved model first")
    try await waitUntilReady(agent)
    await agent.start()
    agent.prepareSelection()
    try expect(!agent.busy, "Repeated startup and ready selections must not reload")
    print("PASSED: persisted selections, sequential startup, and no duplicate loading")

    agent.selectReplyModel(.qwen17)
    try expect(agent.phase == .preparingModel, "Switching Qwen models must prepare the new model")
    agent.stop()
    try await Task.sleep(for: .milliseconds(200))
    try expect(!agent.busy && agent.modelIssue != nil, "Cancellation must not mark an unloaded model ready")
    agent.selectReplyModel(.qwen17)
    try await waitUntilReady(agent)
    print("PASSED: cancellation and retry of the selected model")

    agent.speaksReplies = false
    agent.selectReplyModel(.qwen35_2)
    try expect(agent.phase == .preparingModel, "Selecting Qwen3.5 must prepare it")
    try await waitUntilReady(agent)
    agent.draft = ReplyModel.exampleInput
    agent.send()
    try await waitUntilReady(agent)
    try expect(!agent.reply.isEmpty && agent.notice == nil, agent.notice ?? "Qwen3.5 must generate a reply")
    try expect(!agent.reply.contains("<think>") && !agent.reply.contains("</think>"), "Thinking must remain disabled")
    print("PASSED: Qwen3.5 generated a reply with thinking disabled")

    agent.selectReplyModel(.apple)
    agent = VoiceAgent()
    agent.selectReplyModel(.qwen35_2)
    try await waitUntilReady(agent)
    try expect(VoiceAgent().replyModel == .qwen35_2, "Qwen3.5 selection must persist")
    print("PASSED: Qwen3.5 cached reload and persisted selection")
}
