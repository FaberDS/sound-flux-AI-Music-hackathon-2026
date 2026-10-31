import Foundation

struct SpeechDownload {
    private let started: ContinuousClock.Instant
    private(set) var elapsedSeconds = 0
    private(set) var fraction: Double?

    init(started: ContinuousClock.Instant = .now) { self.started = started }

    mutating func sample(_ progress: Progress?, now: ContinuousClock.Instant = .now) {
        elapsedSeconds = max(0, Int(started.duration(to: now).components.seconds))
        if let progress, progress.totalUnitCount > 0, progress.fractionCompleted.isFinite {
            fraction = min(1, max(0, progress.fractionCompleted))
        } else {
            fraction = nil
        }
    }

    // ponytail: one generous deadline, rather than treating sparse Apple progress as a stall.
    var timedOut: Bool { elapsedSeconds >= 600 }

    var description: String {
        if let fraction, fraction >= 1 { return "Download beendet. Installation wird geprüft …" }
        if let fraction, fraction > 0 { return "Sprachdateien werden geladen: \(Int(fraction * 100)) %" }
        return "Warte auf Download-Fortschritt von Apple …"
    }
}
