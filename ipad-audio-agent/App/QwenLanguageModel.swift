import Foundation
import Hub
import MLX
import MLXLLM
import MLXLMCommon

@MainActor
final class QwenLanguageModel {
    private var container: ModelContainer?
    private(set) var loadedModel: ReplyModel?

    func unload() {
        container = nil
        loadedModel = nil
        GPU.clearCache()
    }

    func prepare(_ model: ReplyModel, progress: @escaping @Sendable (Double) -> Void) async throws {
        if loadedModel == model { return }
        unload()
        let loaded = try await Self.load(model, progress: progress)
        try Task.checkCancellation()
        container = loaded
        loadedModel = model
    }

    nonisolated private static func load(
        _ model: ReplyModel, progress: @escaping @Sendable (Double) -> Void
    ) async throws -> ModelContainer {
        guard let repository = model.repository else { throw CocoaError(.fileReadUnsupportedScheme) }
        // Keep downloads across launches, but do not put model weights in iCloud backups.
        var base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
            .appendingPathComponent("QwenModels", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try base.setResourceValues(values)
        let hub = HubApi(downloadBase: base)
        let configuration = ModelConfiguration(id: repository, revision: model.revision)
        let directory = configuration.modelDirectory(hub: hub)
        if !voiceAssetsComplete(at: directory, revision: model.revision, required: model.requiredFiles) {
            _ = try await downloadModel(hub: hub, configuration: configuration) {
                progress($0.fractionCompleted)
            }
        }
        try Task.checkCancellation()
        progress(1)
        GPU.set(cacheLimit: 64 * 1024 * 1024)
        // Directory loading never contacts the Hub, including on later offline launches.
        let loaded = try await LLMModelFactory.shared.loadContainer(
            configuration: ModelConfiguration(directory: directory))
        try Task.checkCancellation()
        try model.revision.write(to: directory.appendingPathComponent(".soundflux-complete"),
                                 atomically: true, encoding: .utf8)
        return loaded
    }

    func respond(to text: String, instructions: String, history: [Conversation.Exchange],
                 onFirstText: @escaping @MainActor () -> Void) async throws -> String {
        guard let container else { throw CocoaError(.fileReadNoSuchFile) }
        var messages: [Chat.Message] = [.system(instructions)]
        for exchange in history {
            messages.append(.user(exchange.user))
            messages.append(.assistant(exchange.reply))
        }
        messages.append(.user(text))
        let input = try await container.prepare(input: UserInput(
            chat: messages, additionalContext: ["enable_thinking": false]))
        try Task.checkCancellation()
        let stream = try await container.generate(input: input, parameters: GenerateParameters(
            maxTokens: 120, temperature: 0.7, topP: 0.8, repetitionPenalty: 1.05))
        var answer = ""
        for await generation in stream {
            try Task.checkCancellation()
            if let chunk = generation.chunk, !chunk.isEmpty {
                if answer.isEmpty { onFirstText() }
                answer += chunk
            }
        }
        try Task.checkCancellation()
        return answer
    }
}
