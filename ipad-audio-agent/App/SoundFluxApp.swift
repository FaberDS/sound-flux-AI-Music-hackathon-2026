import AVFoundation
import FluidAudio
import SwiftUI

@main
struct SoundFluxApp: App {
    var body: some Scene {
        WindowGroup { ConversationView() }
    }
}

private struct ConversationView: View {
    private enum Panel: String, Identifiable {
        case context = "Benutzerkontext"
        case prompt = "Systemprompt"
        case voice = "Stimme & Wiedergabe"
        case timeline = "Ablauf & Zeiten"
        case setup = "Einrichtung & Hilfe"
        case licenses = "Lizenzen & Quellen"
        var id: String { rawValue }
    }

    @State private var agent = VoiceAgent()
    @State private var panel: Panel?
    @State private var promptDraft = ""
    @Environment(\.scenePhase) private var scenePhase
    private let brown = Color(red: 0.345, green: 0.231, blue: 0.169)
    private let paper = Color(red: 0.984, green: 0.980, blue: 0.969)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tante Emma").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                        Label("Auf diesem Gerät · Deutsch", systemImage: "lock.shield").font(.subheadline)
                    }
                    Spacer()
                    optionsMenu
                }

                VStack(spacing: 8) {
                    HStack {
                        Text("Sprachmodell")
                        Spacer()
                        Picker("Sprachmodell", selection: Binding(get: { agent.replyModel }, set: { agent.selectReplyModel($0) })) {
                            ForEach(ReplyModel.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }.labelsHidden()
                    }
                    HStack {
                        Text("Stimme")
                        Spacer()
                        Picker("Stimme", selection: Binding(get: { agent.speechOutput }, set: { agent.selectSpeechOutput($0) })) {
                            ForEach(SpeechOutput.allCases, id: \.self) { output in
                                Text(output == .supertonic ? "Supertonic · \(agent.supertonicSpeaker.rawValue)" : output.rawValue).tag(output)
                            }
                        }.labelsHidden()
                    }
                }
                .pickerStyle(.menu).disabled(agent.busy)
                .font(.body).padding(12)
                .background(.white, in: RoundedRectangle(cornerRadius: 16))

                preparationStatus
                if !agent.busy, let issue = agent.modelIssue {
                    Text(issue).font(.callout)
                    Button("Erneut versuchen", systemImage: "arrow.clockwise") {
                        Task { await agent.refresh(); agent.prepareSelection() }
                    }
                }
                if !agent.busy, agent.modelIssue == nil, !agent.voiceReady {
                    Button("Stimme erneut laden", systemImage: "arrow.clockwise") { agent.prepareSelection() }
                }
                if !agent.speechReady, agent.phase != .preparing {
                    Button("Spracherkennung einrichten", systemImage: "mic.badge.plus") { panel = .setup }
                        .font(.callout)
                }
                if let issue = agent.userContext.issue {
                    Text(issue).font(.callout)
                    Button("Benutzerkontext korrigieren") { panel = .context }
                }

                VStack(spacing: 16) {
                    Image(systemName: agent.phase == .listening ? "mic.fill" : "waveform.circle.fill")
                        .font(.system(size: 64)).accessibilityHidden(true)
                    Text(agent.phase != .ready || agent.modelIssue == nil ? agent.phase.rawValue : "Einrichtung abschließen")
                        .font(.title2.bold()).multilineTextAlignment(.center)
                    if agent.phase == .listening {
                        Text("Sprich in Ruhe. Tippe danach auf „Fertig“. Maximal 60 Sekunden.")
                            .multilineTextAlignment(.center)
                    }
                    Button(action: primaryAction) {
                        Label(primaryLabel, systemImage: agent.phase == .ready ? "mic.fill" : "stop.fill")
                            .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(agent.phase == .ready && !agent.canRecord)
                }
                .frame(maxWidth: .infinity).padding(24)
                .background(.white, in: RoundedRectangle(cornerRadius: 24))

                if let notice = agent.notice {
                    Text(notice).font(.callout).accessibilityIdentifier("notice")
                }
                if let issue = agent.cleanupIssue {
                    Text(issue)
                    Button("Temporäre Aufnahme löschen") { agent.cleanRecordings() }.disabled(agent.busy)
                }
                if !agent.userText.isEmpty { message("Du", text: agent.userText) }
                if !agent.reply.isEmpty {
                    message("Tante Emma", text: agent.reply)
                    Button("Antwort vorlesen", systemImage: "speaker.wave.2") { agent.speakReply() }
                        .disabled(agent.busy || !agent.voiceReady)
                }
                messageComposer
            }
            .padding(24).frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .background(paper).foregroundStyle(brown).tint(brown)
        .font(.title3)
        .buttonStyle(.bordered).controlSize(.large)
        .safeAreaInset(edge: .bottom) {
            Button { agent.endSession() } label: {
                Label("Gespräch beenden", systemImage: "xmark.circle")
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(.horizontal, 24).padding(.vertical, 12)
            .background(paper)
        }
        .task {
            promptDraft = agent.systemPrompt.text
            await agent.start()
        }
        .sheet(item: $panel) { selected in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        switch selected {
                        case .context: userContextEditor
                        case .prompt: promptEditor
                        case .voice:
                            preparationStatus
                            voiceSettings
                        case .timeline: timelineDetails
                        case .setup:
                            if agent.phase != .preparing { preparationStatus }
                            speechSetup
                            Text(agent.modelIssue ?? agent.modelStatus)
                            Text("Modelle und Stimmen werden bei Auswahl automatisch vorbereitet. Vorhandene Downloads werden wiederverwendet.")
                            Button("Bereitschaft erneut prüfen") {
                                Task { await agent.refresh(); agent.prepareSelection() }
                            }.disabled(agent.busy)
                            Text("Gespräche bleiben nur für diese Sitzung erhalten. „Gespräch beenden“ verwirft den Inhalt.")
                            Button("App-Einstellungen öffnen", systemImage: "gearshape") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }
                        case .licenses: Text(licenseText).font(.footnote).textSelection(.enabled)
                        }
                        if selected == .voice || selected == .setup, let notice = agent.notice {
                            Text(notice).font(.callout)
                        }
                    }
                    .padding(24).frame(maxWidth: 760).frame(maxWidth: .infinity, alignment: .center)
                }
                .background(paper).foregroundStyle(brown).tint(brown)
                .font(.title3).buttonStyle(.bordered).controlSize(.large)
                .navigationTitle(selected.rawValue)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { panel = nil } } }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { agent.stop() }
            if phase == .active { Task { await agent.refresh() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            if let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               type == AVAudioSession.InterruptionType.began.rawValue { agent.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.mediaServicesWereResetNotification)) { _ in
            agent.stop()
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in
            if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               [AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue,
                AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue].contains(reason) { agent.stop() }
        }
        .onChange(of: agent.phase) { _, phase in
            announce(phase == .ready && !agent.reply.isEmpty ? agent.reply : phase.rawValue)
        }
        .onChange(of: agent.notice) { _, notice in if let notice { announce(notice) } }
        .onChange(of: agent.cleanupIssue) { _, issue in if let issue { announce(issue) } }
    }

    private var optionsMenu: some View {
        Menu {
            Button("Benutzerkontext", systemImage: "person.crop.circle") { panel = .context }
            Button("Systemprompt", systemImage: "text.alignleft") { panel = .prompt }
            Button("Stimme & Wiedergabe", systemImage: "speaker.wave.2") { panel = .voice }
            Button("Ablauf & Zeiten", systemImage: "clock") { panel = .timeline }
            Divider()
            Button("Testnachricht einsetzen", systemImage: "text.badge.plus") { agent.draft = ReplyModel.exampleInput }
                .disabled(agent.busy)
            Button("Einrichtung & Hilfe", systemImage: "gearshape") { panel = .setup }
            Button("Lizenzen & Quellen", systemImage: "doc.text") { panel = .licenses }
        } label: {
            Image(systemName: "ellipsis.circle").font(.title2).frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("Weitere Optionen")
    }

    @ViewBuilder
    private var preparationStatus: some View {
        if agent.phase == .preparingModel || agent.phase == .preparingVoice || agent.phase == .preparing {
            VStack(alignment: .leading, spacing: 8) {
                if agent.phase == .preparingModel {
                    ProgressView(value: agent.modelProgress) { Text(agent.modelStatus) }
                } else if agent.phase == .preparingVoice {
                    ProgressView(value: agent.voiceProgress) { Text(agent.voiceStatus) }
                } else {
                    ProgressView(value: agent.speechDownload.fraction) { Text(agent.preparationStep) }
                }
                Text("Bitte die App geöffnet lassen.").font(.caption)
                Button("Vorbereitung abbrechen") { agent.stop() }
            }
            .font(.callout).padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private var messageComposer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nachricht schreiben").font(.headline)
            TextField("Deine Nachricht …", text: $agent.draft, axis: .vertical)
                .lineLimit(3...8).textFieldStyle(.roundedBorder)
                .accessibilityLabel("Nachricht schreiben")
                .disabled(agent.busy)
            Text("\(agent.draft.count) / 1.000 Zeichen").font(.caption)
            Button("Nachricht senden", systemImage: "arrow.up.circle.fill") { agent.send() }
                .disabled(!agent.canSend)
        }
    }

    private var promptEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Gilt für alle Sprachmodelle. Änderungen mit „Übernehmen“ speichern. Benutzerkontext und aktuelles Jahr werden automatisch ergänzt.")
                .font(.footnote)
            TextEditor(text: $promptDraft)
                .frame(minHeight: 240)
                .padding(8).background(.white, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.3)))
                .accessibilityLabel("Systemprompt")
                .disabled(agent.busy)
            Text("\(promptDraft.count) / \(SystemPrompt.maximumLength) Zeichen")
                .font(.caption)
            Button("Übernehmen", systemImage: "checkmark") {
                agent.applySystemPrompt(promptDraft)
                promptDraft = agent.systemPrompt.text
            }
            .disabled(agent.busy || !SystemPrompt.isValid(promptDraft) || promptDraft == agent.systemPrompt.text)
            Button("Auf Standard zurücksetzen", systemImage: "arrow.counterclockwise") {
                agent.resetSystemPrompt()
                promptDraft = agent.systemPrompt.text
            }
            .disabled(agent.busy || (agent.systemPrompt.usesDefault && promptDraft == agent.systemPrompt.text))
        }
        .padding(.top, 12)
    }

    private var voiceSettings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Stimme").font(.headline)
            Picker("Stimme", selection: Binding(get: { agent.speechOutput }, set: { agent.selectSpeechOutput($0) })) {
                ForEach(SpeechOutput.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.menu).disabled(agent.busy)
            Text(agent.speechOutput == .apple ? agent.voiceHint : agent.voiceStatus).font(.footnote)
            if !agent.busy, !agent.voiceReady {
                Button("Erneut versuchen", systemImage: "arrow.clockwise") { agent.prepareSelection() }
            }
            if agent.speechOutput == .supertonic {
                Picker("Supertonic-Stimme", selection: Binding(get: { agent.supertonicSpeaker }, set: { agent.selectSupertonicSpeaker($0) })) {
                    ForEach(Supertonic3Voice.allCases, id: \.self) { voice in
                        Text("\(voice.rawValue) · \(voice.rawValue.hasPrefix("F") ? "Weiblich" : "Männlich")").tag(voice)
                    }
                }
                .pickerStyle(.menu).disabled(agent.busy)
                Text("KI-generierte Stimme · Supertonic 3 · \(agent.supertonicSpeaker.rawValue). Nutzung gemäß OpenRAIL-M; siehe Lizenzen & Quellen.").font(.footnote)
            }
            Button("Stimme testen", systemImage: "speaker.wave.2") { agent.testVoice() }
                .disabled(agent.busy || !agent.voiceReady)
            Toggle("Antworten vorlesen", isOn: $agent.speaksReplies).disabled(agent.busy)
            Link(destination: URL(string: "https://www.readspeaker.com/demo/")!) {
                Label("ReadSpeaker online ausprobieren", systemImage: "safari")
            }
            .disabled(agent.busy)
            Text("Öffnet die ReadSpeaker-Webseite im Browser. Wähle dort Deutsch. Internet erforderlich; Gesprächsinhalte werden nicht übergeben. ReadSpeaker ist noch nicht als Stimme für diese App verfügbar.")
                .font(.footnote)
        }
    }

    @ViewBuilder
    private var speechSetup: some View {
        if !agent.speechReady {
            VStack(alignment: .leading, spacing: 12) {
                Text(agent.speechIssue)
                Button("Deutsch vorbereiten", systemImage: "arrow.down.circle") { agent.prepareSpeech() }
                    .disabled(agent.busy)
                if agent.phase == .preparing {
                    Text(agent.preparationStep).font(.headline)
                    if let fraction = agent.speechDownload.fraction {
                        ProgressView(value: fraction) { Text(agent.speechDownload.description) }
                    } else {
                        ProgressView(agent.speechDownload.description)
                    }
                    Text("Seit \(agent.speechDownload.elapsedSeconds) Sekunden. Bitte die App geöffnet lassen.").font(.footnote)
                    Text("Bei einem Mobilfunk-Hotspot kann Apple den Download zurückstellen. Bitte ein reguläres WLAN verwenden und bei Bedarf erneut versuchen.").font(.footnote)
                    Button("Vorbereitung abbrechen") { agent.stop() }
                } else {
                    Button("Status erneut prüfen") { Task { await agent.refresh() } }.disabled(agent.busy)
                }
                if let details = agent.speechDiagnostic {
                    DisclosureGroup("Fehlerdetails") {
                        Text(details).font(.footnote).textSelection(.enabled)
                    }
                }
            }
        }
    }

    private var timelineDetails: some View {
        VStack(alignment: .leading, spacing: 12) {
            if agent.timeline.entries.isEmpty {
                Text("Der Ablauf erscheint nach „Fertig“, „Senden“ oder einem Stimmtest.")
                    .font(.footnote)
            } else {
                if agent.timeline.isRunning {
                    TimelineView(.periodic(from: .now, by: 0.2)) { _ in timelineClock }
                } else {
                    timelineClock
                }
                ForEach(agent.timeline.entries) { entry in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("+\(entry.elapsed.formatted(.number.precision(.fractionLength(2)))) s")
                            .monospacedDigit().font(.caption)
                            .fixedSize(horizontal: true, vertical: false)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(entry.label).font(.footnote)
                            if let duration = entry.duration {
                                Text("Dauer: \(duration.formatted(.number.precision(.fractionLength(2)))) s")
                                    .monospacedDigit().font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                Text("Zeit seit Start des aktuellen Ablaufs. Die Zwischenmeldung ist noch nicht die eigentliche Antwort.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12)
        .textSelection(.enabled)
    }

    private var primaryLabel: String {
        switch agent.phase {
        case .ready: "Mit Tante Emma sprechen"
        case .listening: "Fertig"
        case .speaking: "Antwort stoppen"
        default: "Abbrechen"
        }
    }

    private var userContextEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Benutzerkontext").font(.headline)
            ForEach(agent.userContext.rows) { row in
                HStack(alignment: .top, spacing: 8) {
                    TextField("Schlüssel", text: Binding(
                        get: { row.key }, set: { agent.updateContextRow(row.id, key: $0) }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .frame(maxWidth: 180)
                        .accessibilityLabel("Schlüssel")
                    TextField("Wert", text: Binding(
                        get: { row.value }, set: { agent.updateContextRow(row.id, value: $0) }), axis: .vertical)
                        .lineLimit(1...3)
                        .accessibilityLabel(row.key.isEmpty ? "Wert" : "Wert für \(row.key)")
                    Button(role: .destructive) { agent.removeContextRow(row.id) } label: {
                        Image(systemName: "minus.circle")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(row.key.isEmpty ? "Leere Zeile entfernen" : "\(row.key) entfernen")
                }
                .textFieldStyle(.roundedBorder)
            }
            Button("Zeile hinzufügen", systemImage: "plus") { agent.addContextRow() }
                .disabled(agent.userContext.rows.count >= UserContext.maximumRows)
            Text("Wird auf diesem Gerät gespeichert und ab der nächsten Nachricht verwendet. Nur vollständig ausgefüllte Paare werden verwendet.")
                .font(.footnote)
            Text("Aktuelles Datum, Uhrzeit und Zeitzone werden bei jeder Nachricht automatisch ergänzt.")
                .font(.footnote)
            if let issue = agent.userContext.issue {
                Text(issue).font(.footnote).foregroundStyle(.red)
            }
        }
        .disabled(agent.busy)
    }

    private var timelineClock: some View {
        Text("\((agent.timeline.elapsed() ?? 0).formatted(.number.precision(.fractionLength(1)))) s · \(agent.timeline.isRunning ? "läuft" : "beendet")")
            .font(.footnote.bold()).monospacedDigit()
    }

    private var licenseText: String {
        guard let url = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "Lizenzhinweise fehlen." }
        return text
    }

    private func primaryAction() {
        switch agent.phase {
        case .ready: agent.startRecording()
        case .listening: agent.finishRecording()
        default: agent.stop()
        }
    }

    private func message(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(text).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private func announce(_ text: String) {
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: text) }
    }
}
