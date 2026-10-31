import AVFoundation
import FoundationModels
import FluidAudio
import Observation
import OSLog
import Speech
import UIKit

@MainActor @Observable
final class VoiceAgent: NSObject, AVAudioRecorderDelegate, AVSpeechSynthesizerDelegate {
    enum Phase: String {
        case ready = "Ich bin für dich da."
        case preparing = "Deutsch wird vorbereitet."
        case preparingVoice = "Die Stimme wird vorbereitet."
        case preparingModel = "Das Sprachmodell wird vorbereitet."
        case permission = "Mikrofon wird vorbereitet."
        case listening = "Ich höre zu."
        case transcribing = "Ich verarbeite deine Worte."
        case thinking = "Einen Moment bitte."
        case speaking = "Tante Emma spricht."
    }

    private(set) var phase = Phase.ready
    private(set) var modelIssue: String? = "Sprachmodell wird geprüft."
    private(set) var replyModel = ReplyModel(rawValue: UserDefaults.standard.string(forKey: "replyModel") ?? "") ?? .apple
    private(set) var modelStatus = "Apple · lokales Sprachmodell"
    private(set) var modelProgress: Double?
    private(set) var systemPrompt: SystemPrompt
    private(set) var userContext = UserContext()
    private(set) var speechReady = false
    private(set) var speechIssue = "Bitte Deutsch einmalig vorbereiten."
    private(set) var voiceHint = "Deutsche Stimme wird geprüft …"
    private(set) var speechOutput = SpeechOutput(rawValue: UserDefaults.standard.string(forKey: "speechOutput") ?? "") ?? .apple
    private(set) var supertonicSpeaker = Supertonic3Voice(rawValue: UserDefaults.standard.string(forKey: "supertonicSpeaker") ?? "") ?? .f1
    private(set) var readyVoices: Set<SpeechOutput> = [.apple]
    var voiceReady: Bool { readyVoices.contains(speechOutput) }
    private(set) var voiceStatus = ""
    private(set) var voiceProgress: Double?
    private(set) var speechDownload = SpeechDownload()
    private(set) var timeline = TurnTimeline()
    private(set) var preparationStep = "Sprachdateien werden geprüft …"
    private(set) var speechDiagnostic: String?
    private(set) var cleanupIssue: String?
    private(set) var userText = ""
    private(set) var reply = ""
    var draft = ""
    var notice: String?
    var speaksReplies = UserDefaults.standard.object(forKey: "speaksReplies") as? Bool ?? true {
        didSet { UserDefaults.standard.set(speaksReplies, forKey: "speaksReplies") }
    }

    @ObservationIgnored private var conversation = Conversation()
    @ObservationIgnored private var didStart = false
    @ObservationIgnored private var work: Task<Void, Never>?
    @ObservationIgnored private var feedbackTask: Task<Void, Never>?
    @ObservationIgnored private var feedbackUtterance: AVSpeechUtterance?
    @ObservationIgnored private var feedbackQueuedAt: ContinuousClock.Instant?
    @ObservationIgnored private var preparationMonitor: Task<Void, Never>?
    @ObservationIgnored private var downloadProgress: Progress?
    @ObservationIgnored private let setupLog = Logger(subsystem: "com.soundflux.ipadagent", category: "SpeechSetup")
    @ObservationIgnored private let performanceLog = Logger(subsystem: "com.soundflux.ipadagent", category: "TurnTiming")
    @ObservationIgnored private var preparedSession: (model: LanguageModelSession, instructions: String)?
    @ObservationIgnored private let qwenModel = QwenLanguageModel()
    @ObservationIgnored private var waitingSince: ContinuousClock.Instant?
    @ObservationIgnored private var speechQueuedAt: ContinuousClock.Instant?
    @ObservationIgnored private var analyzer: SpeechAnalyzer?
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var recordingURL: URL?
    @ObservationIgnored private var utterance: AVSpeechUtterance?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private let pocketVoice = PocketVoice()
    @ObservationIgnored private let supertonicVoice = SupertonicVoice()
    @ObservationIgnored private var speechLocale: Locale?
    private let recordings = FileManager.default.temporaryDirectory.appendingPathComponent("SoundFluxRecordings", isDirectory: true)

    var busy: Bool { phase != .ready }
    var canRecord: Bool { !busy && modelIssue == nil && userContext.issue == nil && speechReady && cleanupIssue == nil && voiceReady }
    var canSend: Bool {
        !busy && modelIssue == nil && userContext.issue == nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    override init() {
        let defaultText = Bundle.main.url(forResource: "Instructions.de", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        systemPrompt = SystemPrompt(defaultText: defaultText)
        super.init()
        synthesizer.delegate = self
        // Remove only our own temporary recordings left by an interrupted process.
        cleanRecordings()
    }

    private var germanVoice: AVSpeechSynthesisVoice? {
        AVSpeechSynthesisVoice.speechVoices()
            .map { (voice: $0, rank: germanVoiceRank(language: $0.language, quality: $0.quality.rawValue)) }
            .filter { $0.rank > 0 }
            .max { $0.rank < $1.rank }?.voice
    }

    private func modelReadiness() -> String? {
        if replyModel != .apple {
            return qwenModel.loadedModel == replyModel ? nil : "\(replyModel.rawValue) ist noch nicht bereit."
        }
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return model.supportsLocale(Locale(identifier: "de-DE")) ? nil : "Das lokale Sprachmodell unterstützt Deutsch derzeit nicht."
        case .unavailable(.deviceNotEligible):
            return "Dieses Gerät unterstützt das lokale Sprachmodell nicht. Benötigt wird ein Gerät mit Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled):
            return "Bitte Apple Intelligence in den Einstellungen aktivieren und Deutsch als Geräte- und Siri-Sprache wählen."
        case .unavailable(.modelNotReady):
            return "Apple Intelligence ist noch nicht bereit. Bitte die Modelldownloads in den Einstellungen abschließen."
        case .unavailable:
            return "Das lokale Sprachmodell ist momentan nicht verfügbar. Bitte später erneut prüfen."
        }
    }

    func start() async {
        guard !didStart else { return }
        didStart = true
        let id = conversation.turnID
        await refresh()
        guard conversation.accepts(id), !Task.isCancelled else { return }
        prepareSelection()
    }

    func refresh() async {
        guard !busy else { return }
        let id = conversation.turnID
        modelIssue = modelReadiness()
        if let voice = germanVoice {
            voiceHint = "Stimme: \(voice.name)."
            if voice.quality == .default {
                voiceHint += " Für natürlicheren Klang lade eine deutsche Premium- oder erweiterte Stimme unter Einstellungen → Bedienungshilfen → Lesen & Sprechen → Stimmen."
            }
        } else {
            voiceHint = "Keine deutsche Stimme verfügbar. Antworten werden als Text angezeigt."
        }
        prewarmNextSession()
        guard SpeechTranscriber.isAvailable,
              let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "de-DE")) else {
            guard conversation.accepts(id) else { return }
            speechReady = false
            speechIssue = "Deutsche Spracherkennung ist auf diesem Gerät nicht verfügbar. Du kannst eine Nachricht schreiben."
            return
        }
        let status = await AssetInventory.status(forModules: [SpeechTranscriber(locale: locale, preset: .transcription)])
        guard conversation.accepts(id), !busy else { return }
        speechLocale = locale
        speechReady = status == .installed
        speechIssue = status == .downloading
            ? "Apple lädt die deutsche Spracherkennung. Tippe auf „Deutsch vorbereiten“, um den Fortschritt zu verfolgen."
            : "„Deutsch vorbereiten“ lädt die deutsche Spracherkennung. Dafür kann Internet erforderlich sein. Apple Intelligence wird separat in den Einstellungen vorbereitet."
    }

    func prepareSpeech() {
        guard !busy else { return }
        stop()
        let id = conversation.turnID
        phase = .preparing
        speechDiagnostic = nil
        speechDownload = SpeechDownload()
        setPreparationStep("Deutsche Sprachunterstützung wird geprüft …")
        preparationMonitor = Task {
            while !Task.isCancelled, conversation.accepts(id), phase == .preparing {
                speechDownload.sample(downloadProgress)
                if speechDownload.timedOut {
                    fail(AgentError("Die Vorbereitung wurde nach zehn Minuten ohne Abschluss beendet. Bitte die Internetverbindung und freien Speicher prüfen und erneut versuchen."), for: id)
                    return
                }
                do { try await Task.sleep(for: .seconds(1)) }
                catch { return }
            }
        }
        work = Task {
            do {
                try ensureCurrent(id)
                guard SpeechTranscriber.isAvailable,
                      let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "de-DE")) else {
                    throw AgentError("Deutsche Spracherkennung ist auf diesem Gerät nicht verfügbar.")
                }
                try ensureCurrent(id)
                setPreparationStep("Deutsche Sprachdateien werden reserviert …")
                try await AssetInventory.reserve(locale: locale)
                try ensureCurrent(id)
                let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
                setPreparationStep("Vorhandene Sprachdateien werden geprüft …")
                let initialStatus = await AssetInventory.status(forModules: [transcriber])
                try ensureCurrent(id)
                setupLog.info("German speech asset status: \(String(describing: initialStatus), privacy: .public)")
                guard initialStatus != .unsupported else { throw AgentError("Die deutschen Sprachdateien werden auf diesem Gerät nicht unterstützt.") }
                if initialStatus != .installed {
                    setPreparationStep("Download wird bei Apple angefragt …")
                    let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
                    try ensureCurrent(id)
                    if let request {
                        downloadProgress = request.progress
                        setPreparationStep("Deutsche Spracherkennung wird geladen …")
                        try await request.downloadAndInstall()
                        try ensureCurrent(id)
                    }
                }
                setPreparationStep("Installation wird geprüft …")
                let status = await AssetInventory.status(forModules: [transcriber])
                try ensureCurrent(id)
                setupLog.info("German speech asset status after setup: \(String(describing: status), privacy: .public)")
                guard status == .installed else { throw AgentError("Die Sprachdateien sind noch nicht installiert. Bitte den Status erneut prüfen oder die Vorbereitung wiederholen.") }
                speechLocale = locale
                speechReady = true
                preparationMonitor?.cancel()
                preparationMonitor = nil
                downloadProgress = nil
                phase = .ready
                work = nil
                await refresh()
            } catch { fail(error, for: id) }
        }
    }

    private func setPreparationStep(_ message: String) {
        preparationStep = message
        setupLog.info("\(message, privacy: .public)")
    }

    func startRecording() {
        guard canRecord else { return }
        let warmedSession = preparedSession
        stop()
        timeline = TurnTimeline()
        preparedSession = warmedSession
        let id = conversation.turnID
        phase = .permission
        work = Task {
            do {
                try ensureCurrent(id)
                let allowed = await AVAudioApplication.requestRecordPermission()
                try ensureCurrent(id)
                guard allowed else { throw AgentError("Bitte das Mikrofon in den App-Einstellungen erlauben. Du kannst auch schreiben.") }
                modelIssue = modelReadiness()
                if let modelIssue { throw AgentError(modelIssue) }
                if replyModel == .apple, preparedSession == nil { preparedSession = try makeSession() }
                let audio = AVAudioSession.sharedInstance()
                try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try audio.setActive(true)
                try FileManager.default.createDirectory(at: recordings, withIntermediateDirectories: true,
                                                       attributes: [.protectionKey: FileProtectionType.complete])
                let url = recordings.appendingPathComponent("\(id).caf")
                recordingURL = url
                // Native recorder handles the hardware format and the 60-second cap.
                let capture = try AVAudioRecorder(url: url, settings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: audio.sampleRate,
                    AVNumberOfChannelsKey: 1,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false
                ])
                recorder = capture
                capture.delegate = self
                guard capture.record(forDuration: 60) else { throw AgentError("Die Aufnahme konnte nicht gestartet werden.") }
                userText = ""
                reply = ""
                phase = .listening
                preparedSession?.model.prewarm()
                work = nil
            } catch { fail(error, for: id) }
        }
    }

    func finishRecording() {
        guard phase == .listening, let url = recordingURL, let locale = speechLocale else { return }
        let finishedAt = ContinuousClock.now
        timeline.start("Aufnahme beendet", at: finishedAt)
        let capture = recorder
        recorder = nil
        capture?.stop()
        deactivateAudio()
        phase = .transcribing
        waitingSince = finishedAt
        let id = conversation.turnID
        // Let an immediate answer win; avoid cutting off a filler phrase for a simple greeting.
        feedbackTask = Task {
            do { try await Task.sleep(for: .milliseconds(250)) }
            catch { return }
            guard conversation.accepts(id), phase == .transcribing || phase == .thinking else { return }
            beginFeedback(for: id)
        }
        work = Task {
            do {
                let text = try await transcribe(url, locale: locale, id: id)
                try ensureCurrent(id)
                cleanRecordings()
                draft = text
                userText = text
                try await respond(to: text, id: id)
            } catch { fail(error, for: id) }
        }
    }

    private func transcribe(_ url: URL, locale: Locale, id: UUID) async throws -> String {
        try ensureCurrent(id)
        let started = ContinuousClock.now
        timeline.record("Transkription gestartet", at: started)
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        let analysis = SpeechAnalyzer(modules: [transcriber])
        analyzer = analysis
        async let text = Self.collect(transcriber)
        do {
            let file = try AVAudioFile(forReading: url)
            try await analysis.start(inputAudioFile: file, finishAfterFile: true)
            let result = try await text
            try ensureCurrent(id)
            logTiming("Transcription", since: started, timelineLabel: "Transkript bereit")
            analyzer = nil
            return result.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            await analysis.cancelAndFinishNow()
            throw error
        }
    }

    nonisolated private static func collect(_ transcriber: SpeechTranscriber) async throws -> String {
        var text = ""
        for try await result in transcriber.results {
            try Task.checkCancellation()
            if result.isFinal { text += String(result.text.characters) }
        }
        return text
    }

    func send() {
        guard canSend else { return }
        let warmedSession = preparedSession
        stop()
        preparedSession = warmedSession
        let id = conversation.turnID
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        phase = .thinking
        let sentAt = ContinuousClock.now
        waitingSince = sentAt
        timeline.start("Nachricht gesendet", at: sentAt)
        work = Task {
            do { try await respond(to: text, id: id) }
            catch { fail(error, for: id) }
        }
    }

    private func modelInstructions() throws -> String {
        guard !systemPrompt.text.isEmpty else {
            throw AgentError("Die Gesprächsanweisungen fehlen. Bitte die App erneut installieren.")
        }
        if let issue = userContext.issue { throw AgentError(issue) }
        return try systemPrompt.text + "\n\n" + userContext.promptContext()
    }

    func addContextRow() {
        guard !busy else { return }
        userContext.add()
        preparedSession = nil
    }

    func updateContextRow(_ id: UUID, key: String? = nil, value: String? = nil) {
        guard !busy else { return }
        userContext.update(id, key: key, value: value)
        preparedSession = nil
    }

    func removeContextRow(_ id: UUID) {
        guard !busy else { return }
        userContext.remove(id)
        preparedSession = nil
    }

    func applySystemPrompt(_ text: String) {
        guard !busy, systemPrompt.save(text) else { return }
        preparedSession = nil
        prewarmNextSession()
        notice = "Systemprompt gespeichert. Gilt ab der nächsten Nachricht für alle drei Modelle."
    }

    func resetSystemPrompt() {
        guard !busy else { return }
        systemPrompt.reset()
        preparedSession = nil
        prewarmNextSession()
        notice = "Der Standard-Systemprompt wurde wiederhergestellt."
    }

    private func makeSession(includeHistory: Bool = true) throws -> (model: LanguageModelSession, instructions: String) {
        let instructions = try modelInstructions()
        let session = LanguageModelSession(model: .default, instructions: instructions)
        guard includeHistory, !conversation.exchanges.isEmpty else { return (session, instructions) }
        var entries = Array(session.transcript)
        for exchange in conversation.exchanges {
            entries.append(.prompt(.init(segments: [.text(.init(content: exchange.user))])))
            entries.append(.response(.init(assetIDs: [], segments: [.text(.init(content: exchange.reply))])))
        }
        return (LanguageModelSession(model: .default, transcript: Transcript(entries: entries)), instructions)
    }

    private func prewarmNextSession() {
        guard replyModel == .apple, !busy, modelIssue == nil else { return }
        guard preparedSession == nil || preparedSession?.instructions != (try? modelInstructions()) else { return }
        preparedSession = try? makeSession()
        preparedSession?.model.prewarm()
    }

    private func beginFeedback(for id: UUID) {
        guard speaksReplies, voiceReady, !UIAccessibility.isVoiceOverRunning else { return }
        let started = waitingSince ?? ContinuousClock.now
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            switch speechOutput {
            case .supertonic:
                try supertonicVoice.acknowledge(voice: supertonicSpeaker)
                logTiming("Acknowledgement queued", since: started)
                timeline.record("Zwischenmeldung zur Wiedergabe eingereiht")
            case .pocket:
                feedbackTask = Task {
                    do {
                        try await pocketVoice.speak("Einen Moment bitte.") { [weak self] in
                            guard let self, self.conversation.accepts(id) else { return }
                            self.logTiming("Acknowledgement startup", since: started)
                            self.timeline.record("Zwischenmeldung gestartet")
                        }
                    } catch { /* The actual answer must continue if feedback fails. */ }
                }
            case .apple:
                guard let voice = germanVoice else { return }
                let speech = AVSpeechUtterance(string: "Einen Moment bitte.")
                speech.voice = voice
                feedbackUtterance = speech
                feedbackQueuedAt = started
                synthesizer.speak(speech)
            }
        } catch { performanceLog.notice("Spoken acknowledgement unavailable; continuing the answer") }
    }

    private func stopFeedback() {
        feedbackTask?.cancel()
        feedbackTask = nil
        if feedbackUtterance != nil { synthesizer.stopSpeaking(at: .immediate) }
        feedbackUtterance = nil
        feedbackQueuedAt = nil
        pocketVoice.stop()
        supertonicVoice.stop()
    }

    private func respond(to text: String, id: UUID) async throws {
        try ensureCurrent(id)
        if Conversation.isEndCommand(text) { endSession(); return }
        guard !text.isEmpty else { throw AgentError("Ich habe keine Worte erkannt. Bitte erneut sprechen oder schreiben.") }
        guard text.count <= Conversation.maximumInputLength else {
            throw AgentError("Die Nachricht ist zu lang. Bitte auf höchstens 1.000 Zeichen kürzen.")
        }
        modelIssue = modelReadiness()
        if let modelIssue { throw AgentError(modelIssue) }
        userText = text
        reply = ""
        phase = .thinking
        let started = ContinuousClock.now
        let answer: String
        let greeting = systemPrompt.usesDefault ? Conversation.greetingReply(text, firstName: userContext.firstName) : nil
        if let greeting {
            timeline.record("Lokale Begrüßung · kein LLM-Aufruf")
            answer = greeting
            preparedSession = nil
        } else if replyModel != .apple {
            timeline.record("LLM-Anfrage gestartet · \(replyModel.rawValue)")
            answer = try await qwenModel.respond(to: text, instructions: modelInstructions(),
                                                 history: conversation.exchanges) { [weak self] in
                guard let self, self.conversation.accepts(id) else { return }
                self.timeline.record("Erster LLM-Text · \(self.replyModel.rawValue)", since: started)
            }
        } else {
            // Context edits and a calendar-year change must never reuse stale instructions.
            let instructions = try modelInstructions()
            let session = try (preparedSession?.instructions == instructions ? preparedSession : nil) ?? makeSession()
            preparedSession = nil
            let options = GenerationOptions(temperature: 0.5, maximumResponseTokens: 120)
            timeline.record("LLM-Anfrage gestartet · Apple")
            do {
                answer = try await session.model.respond(to: text, options: options).content
            } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
                try ensureCurrent(id)
                let session = try makeSession(includeHistory: false)
                timeline.record("LLM-Anfrage erneut · ohne Verlauf")
                answer = try await session.model.respond(to: text, options: options).content
            }
        }
        try ensureCurrent(id)
        logTiming("Response generation", since: started,
                  timelineLabel: greeting == nil ? "LLM-Antwort bereit" : "Lokale Antwort bereit")
        let clean = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { throw AgentError("Es kam keine Antwort. Bitte erneut versuchen.") }
        guard conversation.complete(id, user: text, reply: clean) else { return }
        reply = clean
        draft = ""
        phase = .ready
        work = nil
        if speaksReplies { speakReply() }
        if phase != .speaking {
            waitingSince = nil
            timeline.finish("Antwort als Text bereit")
        }
        prewarmNextSession()
    }

    func selectSpeechOutput(_ output: SpeechOutput) {
        guard !busy else { return }
        speechOutput = output
        UserDefaults.standard.set(output.rawValue, forKey: "speechOutput")
        notice = nil
        voiceStatus = voiceReady ? "\(output.rawValue) · Deutsch · bereit." : "Die Stimme wird vorbereitet …"
        prepareSelection()
    }

    func selectReplyModel(_ model: ReplyModel) {
        guard !busy else { return }
        if replyModel != model {
            preparedSession = nil
            qwenModel.unload()
        }
        replyModel = model
        UserDefaults.standard.set(model.rawValue, forKey: "replyModel")
        modelProgress = nil
        modelIssue = modelReadiness()
        modelStatus = model == .apple ? "Apple · lokales Sprachmodell" : "\(model.rawValue) · lokal · 4-Bit"
        notice = nil
        prepareSelection()
    }

    func selectSupertonicSpeaker(_ voice: Supertonic3Voice) {
        guard !busy else { return }
        supertonicSpeaker = voice
        UserDefaults.standard.set(voice.rawValue, forKey: "supertonicSpeaker")
        notice = nil
    }

    func prepareSelection() {
        guard !busy else { return }
        let needsModel = replyModel != .apple && qwenModel.loadedModel != replyModel
        guard needsModel || !voiceReady else { prewarmNextSession(); return }
        stop()
        let id = conversation.turnID
        let model = replyModel
        let output = speechOutput
        phase = needsModel ? .preparingModel : .preparingVoice
        modelProgress = nil
        voiceProgress = nil
        if needsModel { modelStatus = "\(model.rawValue) wird vorbereitet …" }
        if !voiceReady { voiceStatus = "\(output.rawValue)-Sprachdateien werden geprüft …" }
        work = Task {
            do {
                try ensureCurrent(id)
                if needsModel {
                    try await qwenModel.prepare(model) { [weak self] fraction in
                        Task { @MainActor in
                            guard let self, self.conversation.accepts(id), self.phase == .preparingModel else { return }
                            self.modelProgress = max(self.modelProgress ?? 0, fraction)
                            if fraction >= 1 { self.modelStatus = "Sprachmodell wird im Speicher vorbereitet …" }
                        }
                    }
                    try ensureCurrent(id)
                    modelIssue = modelReadiness()
                    modelStatus = "\(model.rawValue) · bereit · lokal · 4-Bit"
                }
                if !voiceReady {
                    phase = .preparingVoice
                    let progress: @Sendable (DownloadProgress) -> Void = { [weak self] progress in
                        Task { @MainActor in
                            guard let self, self.conversation.accepts(id), self.phase == .preparingVoice else { return }
                            self.voiceProgress = progress.fractionCompleted
                            switch progress.phase {
                            case .listing: self.voiceStatus = "\(output.rawValue)-Download wird vorbereitet …"
                            case .downloading:
                                self.voiceStatus = "\(output.rawValue) wird geladen: \(Int(progress.fractionCompleted * 100)) %"
                            case .compiling:
                                self.voiceStatus = "\(output.rawValue) wird auf diesem Gerät geladen. Das kann beim ersten Mal etwas dauern …"
                            }
                        }
                    }
                    if output == .pocket { try await pocketVoice.prepare(progress: progress) }
                    else { try await supertonicVoice.prepare(progress: progress) }
                    try ensureCurrent(id)
                    readyVoices.insert(output)
                    voiceProgress = nil
                    voiceStatus = "\(output.rawValue) · Deutsch · bereit."
                }
                phase = .ready
                work = nil
                prewarmNextSession()
            } catch { fail(error, for: id) }
        }
    }

    func testVoice() {
        guard !busy, voiceReady else { return }
        timeline.start("Stimmtest gestartet")
        speak("\(Conversation.daytimeGreeting()). Schön, Sie zu hören. Wir haben Zeit und können in Ruhe miteinander sprechen.")
    }

    func speakReply() {
        guard !busy, !reply.isEmpty else { return }
        if !timeline.isRunning { timeline.start("Antwort erneut vorlesen") }
        speak(reply)
    }

    private func speak(_ text: String) {
        guard !busy else { return }
        // VoiceOver reads the visible reply; avoid two simultaneous voices.
        guard !UIAccessibility.isVoiceOverRunning else {
            timeline.finish("Ausgabe über VoiceOver")
            return
        }
        stopFeedback()
        if speechOutput != .apple {
            guard voiceReady else {
                notice = "Bitte die Stimme zuerst vorbereiten oder Apple auswählen."
                timeline.finish("Stimme noch nicht bereit")
                return
            }
            let id = conversation.turnID
            let output = speechOutput
            let speaker = supertonicSpeaker
            speechQueuedAt = .now
            timeline.record("\(output.rawValue): Sprachausgabe angefragt")
            phase = .speaking
            work = Task {
                do {
                    let audio = AVAudioSession.sharedInstance()
                    try audio.setCategory(.playback, mode: .spokenAudio)
                    try audio.setActive(true)
                    let onStart: @MainActor () -> Void = { [weak self] in
                        guard let self, self.conversation.accepts(id) else { return }
                        if let started = self.speechQueuedAt {
                            self.logTiming("\(output.rawValue) speech startup", since: started, timelineLabel: "Sprachausgabe gestartet")
                        }
                        if let started = self.waitingSince { self.logTiming("Total wait until \(output.rawValue) playback", since: started) }
                        self.speechQueuedAt = nil
                        self.waitingSince = nil
                    }
                    if output == .pocket { try await pocketVoice.speak(text, onStart: onStart) }
                    else { try await supertonicVoice.speak(text, voice: speaker, onStart: onStart) }
                    try ensureCurrent(id)
                    phase = .ready
                    work = nil
                    deactivateAudio()
                    timeline.finish("Wiedergabe beendet")
                    prewarmNextSession()
                } catch { fail(error, for: id) }
            }
            return
        }
        guard let voice = germanVoice else {
            notice = "Keine deutsche Stimme gefunden. Bitte in den Einstellungen unter Bedienungshilfen eine deutsche Stimme laden."
            timeline.finish("Keine deutsche Stimme verfügbar")
            return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            let speech = AVSpeechUtterance(string: text)
            speech.voice = voice
            speech.rate = AVSpeechUtteranceDefaultSpeechRate
            utterance = speech
            speechQueuedAt = .now
            timeline.record("Apple: Sprachausgabe angefragt")
            phase = .speaking
            performanceLog.info("Speech voice: \(voice.name, privacy: .public), quality: \(voice.quality.rawValue)")
            synthesizer.speak(speech)
        } catch {
            deactivateAudio()
            notice = "Die Antwort konnte nicht vorgelesen werden. Du kannst sie lesen oder erneut vorlesen lassen."
            timeline.finish("Sprachausgabe fehlgeschlagen")
        }
    }

    func stop() {
        timeline.finish("Abgebrochen")
        conversation.invalidate()
        work?.cancel()
        work = nil
        stopFeedback()
        voiceProgress = nil
        if phase == .preparingVoice { voiceStatus = "Vorbereitung abgebrochen. Du kannst es erneut versuchen oder Apple verwenden." }
        if phase == .preparingModel {
            modelProgress = nil
            modelStatus = "Vorbereitung abgebrochen. Erneut vorbereiten oder Apple auswählen."
        }
        preparedSession = nil
        waitingSince = nil
        speechQueuedAt = nil
        preparationMonitor?.cancel()
        preparationMonitor = nil
        let analysis = analyzer
        analyzer = nil
        if let analysis { Task { await analysis.cancelAndFinishNow() } }
        downloadProgress?.cancel()
        downloadProgress = nil
        let capture = recorder
        recorder = nil
        capture?.stop()
        utterance = nil
        synthesizer.stopSpeaking(at: .immediate)
        cleanRecordings()
        deactivateAudio()
        phase = .ready
        notice = nil
    }

    func endSession() {
        stop()
        timeline = TurnTimeline()
        conversation.clear()
        draft = ""
        userText = ""
        reply = ""
        notice = "Das Gespräch ist beendet. Der Gesprächsinhalt wurde verworfen."
    }

    private func ensureCurrent(_ id: UUID) throws {
        try Task.checkCancellation()
        guard conversation.accepts(id) else { throw CancellationError() }
    }

    private func logTiming(_ stage: String, since started: ContinuousClock.Instant, timelineLabel: String? = nil) {
        performanceLog.info("\(stage, privacy: .public): \(started.duration(to: .now).description, privacy: .public)")
        if let timelineLabel { timeline.record(timelineLabel, since: started) }
    }

    func cleanRecordings() {
        guard recorder == nil else { return }
        do {
            try FileManager.default.removeItem(at: recordings)
            recordingURL = nil
            cleanupIssue = nil
        } catch CocoaError.fileNoSuchFile {
            recordingURL = nil
            cleanupIssue = nil
        } catch {
            cleanupIssue = "Eine temporäre Aufnahme konnte nicht gelöscht werden. Bitte erneut löschen, bevor du wieder aufnimmst."
        }
    }

    private func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func fail(_ error: Error, for id: UUID) {
        guard conversation.accepts(id) else { return }
        let failedPhase = phase
        timeline.finish(error is CancellationError ? "Abgebrochen" : "Fehler · siehe Hinweis oben")
        stop()
        if error is CancellationError { return }
        if failedPhase == .preparingModel || (failedPhase == .thinking && replyModel != .apple) {
            notice = "\(replyModel.rawValue): \(error.localizedDescription). Bitte erneut versuchen oder Apple auswählen."
            modelIssue = modelReadiness()
            return
        }
        if failedPhase == .preparingVoice || (failedPhase == .speaking && speechOutput != .apple && !(error is LanguageModelSession.GenerationError)) {
            notice = "\(speechOutput.rawValue) konnte nicht gestartet werden: \(error.localizedDescription). Du kannst es erneut versuchen oder Apple auswählen."
            if !voiceReady { voiceStatus = "\(speechOutput.rawValue) ist noch nicht bereit." }
            return
        }
        if failedPhase == .preparing {
            let problem = error as NSError
            var details = "\(preparationStep)\n\(problem.domain) (\(problem.code)): \(problem.localizedDescription)"
            if let underlying = problem.userInfo[NSUnderlyingErrorKey] as? NSError {
                details += "\n\(underlying.domain) (\(underlying.code)): \(underlying.localizedDescription)"
            }
            speechDiagnostic = details
            setupLog.error("\(details, privacy: .public)")
            notice = (error as? AgentError)?.message ?? "Die deutsche Spracherkennung konnte nicht geladen werden. Bitte Internetverbindung und freien Speicher prüfen. Unter „Fehlerdetails“ steht Apples Fehlermeldung."
            return
        }
        if let error = error as? AgentError { notice = error.message; return }
        if let error = error as? LanguageModelSession.GenerationError {
            switch error {
            case .guardrailViolation, .refusal:
                notice = "Darauf kann ich leider nicht antworten. Magst du etwas anderes fragen?"
            case .unsupportedLanguageOrLocale:
                notice = "Bitte auf Deutsch sprechen oder schreiben."
            default:
                notice = "Die lokale Antwort ist fehlgeschlagen. Bitte erneut versuchen."
            }
        } else {
            notice = "Die Aufnahme oder Spracherkennung ist fehlgeschlagen. Bitte erneut sprechen oder schreiben."
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let identity = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map(ObjectIdentifier.init) == identity, self.phase == .listening else { return }
            if flag {
                self.notice = "60 Sekunden erreicht. Die Aufnahme wird verarbeitet."
                self.finishRecording()
            } else {
                self.stop()
                self.notice = "Die Aufnahme wurde unterbrochen. Bitte erneut versuchen."
            }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let identity = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map(ObjectIdentifier.init) == identity else { return }
            self.stop()
            self.notice = "Die Aufnahme ist fehlgeschlagen. Bitte freien Speicher prüfen und erneut versuchen."
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let identity = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            if let self, self.feedbackUtterance.map(ObjectIdentifier.init) == identity {
                if let started = self.feedbackQueuedAt { self.logTiming("Acknowledgement startup", since: started) }
                self.timeline.record("Zwischenmeldung gestartet")
                return
            }
            guard let self, self.utterance.map(ObjectIdentifier.init) == identity else { return }
            if let started = self.speechQueuedAt {
                self.logTiming("Speech startup", since: started, timelineLabel: "Sprachausgabe gestartet")
            }
            if let started = self.waitingSince { self.logTiming("Total wait until speech", since: started) }
            self.speechQueuedAt = nil
            self.waitingSince = nil
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speechEnded(ObjectIdentifier(utterance))
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechEnded(ObjectIdentifier(utterance))
    }

    nonisolated private func speechEnded(_ identity: ObjectIdentifier) {
        Task { @MainActor [weak self] in
            guard let self, self.utterance.map(ObjectIdentifier.init) == identity else { return }
            self.utterance = nil
            self.phase = .ready
            self.deactivateAudio()
            self.timeline.finish("Wiedergabe beendet")
            self.prewarmNextSession()
        }
    }
}

private struct AgentError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
