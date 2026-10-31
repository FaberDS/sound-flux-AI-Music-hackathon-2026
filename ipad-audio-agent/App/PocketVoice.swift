import AVFoundation
import FluidAudio

@MainActor
final class PocketVoice {
    private var manager: PocketTtsManager?
    private var session: PocketTtsSession?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
    private var operationID = UUID()
    private var pendingBuffers = 0
    private var playbackFinished: CheckedContinuation<Void, Never>?
    var isReady: Bool { manager != nil }

    init() {
        // Pin Pocket before its first download.
        ModelRegistry.revisionOverrides[Repo.pocketTts.remotePath] = PocketAssets.revision
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func prepare(progress: @escaping ProgressHandler) async throws {
        if isReady { return }
        let id = operationID
        var base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
            .appendingPathComponent("PocketVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try base.setResourceValues(values)
        let repo = base.appendingPathComponent("Models/\(Repo.pocketTts.folderName)", isDirectory: true)
        let root = repo.appendingPathComponent(PocketAssets.directory, isDirectory: true)
        let marker = root.appendingPathComponent(".soundflux-complete")
        let required = PocketAssets.models.union(PocketAssets.constants.map { "constants_bin/\($0)" })
        if !voiceAssetsComplete(at: root, revision: PocketAssets.revision, required: required) {
            try await ModelHub.download(.pocketTts, subdirectory: PocketAssets.directory, to: repo,
                                        progressHandler: progress, shouldSkip: { !PocketAssets.includes($0) })
            try check(id)
            try PocketAssets.revision.write(to: marker, atomically: true, encoding: .utf8)
        }
        try check(id)
        progress(DownloadProgress(fractionCompleted: 1, phase: .compiling(modelName: "Pocket Deutsch")))
        // ponytail: avoid the documented M1/26.6 Neural Engine abort; benchmark ANE before enabling it.
        let loaded = PocketTtsManager(defaultVoice: PocketAssets.voice, language: .german,
                                      directory: base, computeUnits: .avoidNeuralEngine)
        try await loaded.initialize()
        try check(id)
        manager = loaded
    }

    func speak(_ text: String, onStart: @escaping @MainActor () -> Void) async throws {
        guard let manager else { throw PocketTTSError.modelNotFound("Pocket bitte zuerst vorbereiten.") }
        let id = operationID
        defer { if operationID == id { stop() } }
        try await withTaskCancellationHandler {
            let voiceSession = try await manager.makeSession(voice: PocketAssets.voice)
            do { try check(id) }
            catch { await voiceSession.cancel(); throw error }
            session = voiceSession
            engine.prepare()
            try engine.start()
            voiceSession.enqueue(text)
            voiceSession.finish()
            var started = false
            for try await frame in voiceSession.frames {
                try check(id)
                guard !frame.samples.isEmpty else { continue }
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frame.samples.count)),
                      let channel = buffer.floatChannelData?[0] else {
                    throw PocketTTSError.processingFailed("Audiopuffer konnte nicht erstellt werden.")
                }
                buffer.frameLength = buffer.frameCapacity
                frame.samples.withUnsafeBufferPointer { samples in
                    channel.update(from: samples.baseAddress!, count: samples.count)
                }
                pendingBuffers += 1
                player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                    Task { @MainActor in
                        guard let self, self.operationID == id else { return }
                        self.pendingBuffers -= 1
                        if self.pendingBuffers == 0 {
                            self.playbackFinished?.resume()
                            self.playbackFinished = nil
                        }
                    }
                }
                if !started && pendingBuffers >= 3 {
                    player.play()
                    started = true
                    onStart()
                }
            }
            try check(id)
            if !started {
                guard pendingBuffers > 0 else { throw PocketTTSError.processingFailed("Pocket hat kein Audio erzeugt.") }
                player.play()
                onStart()
            }
            if pendingBuffers > 0 {
                await withCheckedContinuation { playbackFinished = $0 }
            }
            try check(id)
        } onCancel: {
            Task { @MainActor [weak self] in
                if self?.operationID == id { self?.stop() }
            }
        }
    }

    func stop() {
        operationID = UUID()
        player.stop()
        engine.stop()
        pendingBuffers = 0
        playbackFinished?.resume()
        playbackFinished = nil
        let active = session
        session = nil
        if let active { Task { await active.cancel() } }
    }

    private func check(_ id: UUID) throws {
        try Task.checkCancellation()
        guard operationID == id else { throw CancellationError() }
    }
}
