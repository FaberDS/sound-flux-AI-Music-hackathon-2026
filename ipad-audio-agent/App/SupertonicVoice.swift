import AVFoundation
import FluidAudio
import OSLog

@MainActor
final class SupertonicVoice {
    static let revision = "9f3606bf5c5ff9d6680cf6226614ac61358a24f3"
    private var manager: Supertonic3Manager?
    private var styles: [Supertonic3Voice: Supertonic3VoiceStyle] = [:]
    private var acknowledgements: [Supertonic3Voice: AVAudioPCMBuffer] = [:]
    private var directory: URL?
    private(set) var accelerated = false
    private let timing = Logger(subsystem: "com.soundflux.ipadagent", category: "TurnTiming")
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var operationID = UUID()
    private var playbackFinished: CheckedContinuation<Void, Never>?

    init() {
        ModelRegistry.revisionOverrides[Repo.supertonic3.remotePath] = Self.revision
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func prepare(progress: @escaping ProgressHandler) async throws {
        if manager != nil, acknowledgements.count == Supertonic3Voice.allCases.count { return }
        let id = operationID
        var base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
            .appendingPathComponent("SupertonicVoice", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try base.setResourceValues(values)
        let root = base.appendingPathComponent(Repo.supertonic3.folderName, isDirectory: true)
        let marker = root.appendingPathComponent(".soundflux-complete")
        let voiceFiles = Set(Supertonic3Voice.allCases.map(\.fileName))
        let required = ModelNames.Supertonic3.requiredFiles.union(voiceFiles)
        if !voiceAssetsComplete(at: root, revision: Self.revision, required: required) {
            try await ModelHub.download(.supertonic3, to: base,
                                        additionalModelNames: voiceFiles, progressHandler: progress)
            try check(id)
            try Self.revision.write(to: marker, atomically: true, encoding: .utf8)
        }
        try check(id)
        progress(DownloadProgress(fractionCompleted: 1, phase: .compiling(modelName: "Supertonic")))
        var loadedStyles: [Supertonic3Voice: Supertonic3VoiceStyle] = [:]
        for voice in Supertonic3Voice.allCases {
            loadedStyles[voice] = try Supertonic3VoiceStyle.load(from: root.appendingPathComponent(voice.fileName))
        }
        try check(id)
        styles = loadedStyles
        directory = base
        let candidate = Supertonic3Manager(directory: base, computeUnits: .cpuAndNeuralEngine,
                                           vectorEstimator: .aneBucketed(.int4))
        do {
            let fastFiles = ModelNames.Supertonic3.requiredFiles(veVariant: "ane-int4").union(voiceFiles)
            let fastMarker = ".soundflux-ane-complete"
            if !voiceAssetsComplete(at: root, revision: Self.revision, required: fastFiles, markerName: fastMarker) {
                try await ModelHub.download(.supertonic3, to: base, variant: "ane-int4",
                                            additionalModelNames: voiceFiles, progressHandler: progress)
                try check(id)
                try Self.revision.write(to: root.appendingPathComponent(fastMarker), atomically: true, encoding: .utf8)
            }
            try check(id)
            progress(DownloadProgress(fractionCompleted: 1, phase: .compiling(modelName: "Supertonic")))
            try await candidate.initialize()
            try check(id)
            // The fixed-length models load lazily: run a silent first utterance during setup.
            let warmup = try await candidate.synthesize(text: "Guten Morgen.", language: "de",
                                                       style: loadedStyles[.f1]!, totalSteps: 8, speed: 1.0)
            guard !warmup.samples.isEmpty else { throw Supertonic3Error.emptyText }
            try check(id)
            manager = candidate
            accelerated = true
            timing.info("Supertonic ready: ANE int4")
        } catch {
            await candidate.cleanup()
            try check(id) // Cancellation must never start a fallback or resume playback.
            timing.notice("Supertonic acceleration unavailable; using CPU/GPU")
            try await loadFallback(id: id)
        }
        guard let loaded = manager else { throw Supertonic3Error.notInitialized }
        var feedback: [Supertonic3Voice: AVAudioPCMBuffer] = [:]
        for voice in Supertonic3Voice.allCases {
            let audio = try await loaded.synthesize(text: "Einen Moment bitte.", language: "de",
                                                    style: loadedStyles[voice]!, totalSteps: 8, speed: 1.0)
            try check(id)
            feedback[voice] = try makeBuffer(audio.samples)
        }
        acknowledgements = feedback
    }

    func acknowledge(voice: Supertonic3Voice) throws {
        guard let buffer = acknowledgements[voice] else { throw Supertonic3Error.notInitialized }
        stop()
        engine.prepare()
        try engine.start()
        player.scheduleBuffer(buffer)
        player.play()
    }

    private func makeBuffer(_ samples: [Float]) throws -> AVAudioPCMBuffer {
        guard !samples.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else { throw Supertonic3Error.emptyText }
        buffer.frameLength = buffer.frameCapacity
        samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: $0.count) }
        return buffer
    }

    private func loadFallback(id: UUID) async throws {
        try check(id)
        guard let directory else { throw Supertonic3Error.notInitialized }
        let fallback = Supertonic3Manager(directory: directory, computeUnits: .cpuAndGPU,
                                          vectorEstimator: .fp16Dynamic)
        try await fallback.initialize()
        try check(id)
        manager = fallback
        accelerated = false
    }

    func speak(_ text: String, voice: Supertonic3Voice, onStart: @escaping @MainActor () -> Void) async throws {
        guard let manager, let style = styles[voice] else { throw Supertonic3Error.notInitialized }
        let id = operationID
        defer { if operationID == id { stop() } }
        try await withTaskCancellationHandler {
            // Each supplied sentence renders in full before playback.
            let started = ContinuousClock.now
            let audio: (samples: [Float], duration: Float)
            do {
                audio = try await manager.synthesize(text: text, language: "de", style: style, totalSteps: 8, speed: 1.0)
            } catch {
                try check(id)
                guard accelerated else { throw error }
                // A longer reply may need a bucket that the setup warm-up did not exercise.
                timing.notice("Supertonic inference failed on ANE; retrying once on CPU/GPU")
                await manager.cleanup()
                try await loadFallback(id: id)
                guard let fallback = self.manager else { throw Supertonic3Error.notInitialized }
                audio = try await fallback.synthesize(text: text, language: "de", style: style, totalSteps: 8, speed: 1.0)
            }
            try check(id)
            timing.info("Supertonic synthesis (\(self.accelerated ? "ANE int4" : "CPU/GPU", privacy: .public), \(voice.rawValue, privacy: .public)): \(started.duration(to: .now).description, privacy: .public); audio \(audio.duration, privacy: .public)s")
            let buffer = try makeBuffer(audio.samples)
            engine.prepare()
            try engine.start()
            await withCheckedContinuation { continuation in
                playbackFinished = continuation
                player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                    Task { @MainActor in
                        guard let self, self.operationID == id else { return }
                        self.playbackFinished?.resume()
                        self.playbackFinished = nil
                    }
                }
                player.play()
                onStart()
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
        playbackFinished?.resume()
        playbackFinished = nil
    }

    private func check(_ id: UUID) throws {
        try Task.checkCancellation()
        guard operationID == id else { throw CancellationError() }
    }
}
