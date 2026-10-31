import Foundation

struct Conversation {
    struct Exchange {
        let user: String
        let reply: String
    }

    static let maximumInputLength = 1_000
    private(set) var exchanges: [Exchange] = []
    private(set) var turnID = UUID()

    mutating func invalidate() { turnID = UUID() }

    mutating func clear() {
        invalidate()
        exchanges.removeAll()
    }

    func accepts(_ id: UUID) -> Bool { id == turnID }

    @discardableResult
    mutating func complete(_ id: UUID, user: String, reply: String) -> Bool {
        guard accepts(id) else { return false }
        exchanges.append(Exchange(user: user, reply: reply))
        // ponytail: conservative character budget; use token counting for longer histories.
        while exchanges.count > 3 || exchanges.reduce(0, { $0 + $1.user.count + $1.reply.count }) > 3_000 {
            exchanges.removeFirst()
        }
        return true
    }

    static func isEndCommand(_ text: String) -> Bool {
        ["stopp", "stop", "gespräch beenden", "ich möchte jetzt aufhören"].contains(normalizedCommand(text))
    }

    static func daytimeGreeting(at date: Date = .now, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        switch calendar.component(.hour, from: date) {
        case 5..<11: return "Guten Morgen"
        case 11..<18: return "Guten Tag"
        case 18..<22: return "Guten Abend"
        default: return "Hallo"
        }
    }

    static func greetingReply(_ text: String, firstName: String? = nil, at date: Date = .now, timeZone: TimeZone = .current) -> String? {
        guard ["hallo", "guten morgen", "guten tag", "guten abend"].contains(normalizedCommand(text)) else { return nil }
        let greeting = daytimeGreeting(at: date, timeZone: timeZone)
        let name = firstName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "\(greeting)\(name.isEmpty ? "" : ", \(name)"). Wie geht es dir heute?"
    }

    private static func normalizedCommand(_ text: String) -> String {
        var normalized = text.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        while let last = normalized.last, ".!?,;:".contains(last) { normalized.removeLast() }
        return normalized
    }
}
