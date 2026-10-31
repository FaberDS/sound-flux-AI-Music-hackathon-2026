import Foundation

struct TurnTimeline {
    struct Entry: Identifiable {
        let id: Int
        let label: String
        let elapsed: Double
        let duration: Double?
    }

    private(set) var entries: [Entry] = []
    private var started: ContinuousClock.Instant?
    private var ended: ContinuousClock.Instant?
    private var nextID = 0
    var isRunning: Bool { started != nil && ended == nil }

    mutating func start(_ label: String, at now: ContinuousClock.Instant = .now) {
        self = TurnTimeline()
        started = now
        record(label, at: now)
    }

    mutating func record(_ label: String, since stageStart: ContinuousClock.Instant? = nil,
                         at now: ContinuousClock.Instant = .now) {
        guard isRunning, let elapsed = elapsed(at: now) else { return }
        entries.append(Entry(id: nextID, label: label, elapsed: elapsed,
                             duration: stageStart.map { Self.seconds($0.duration(to: now)) }))
        nextID += 1
        // Keep only the current operation, bounded even if future retries add more events.
        if entries.count > 32 { entries.removeFirst(entries.count - 32) }
    }

    mutating func finish(_ label: String, at now: ContinuousClock.Instant = .now) {
        guard isRunning else { return }
        record(label, at: now)
        ended = now
    }

    func elapsed(at now: ContinuousClock.Instant = .now) -> Double? {
        started.map { Self.seconds($0.duration(to: ended ?? now)) }
    }

    private static func seconds(_ duration: Duration) -> Double {
        let parts = duration.components
        return max(0, Double(parts.seconds) + Double(parts.attoseconds) / 1e18)
    }
}
