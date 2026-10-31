import Foundation

struct SystemPrompt {
    static let maximumLength = 4_000
    private static let key = "systemPrompt"
    private let defaults: UserDefaults
    let defaultText: String
    private(set) var text: String
    var usesDefault: Bool { text == defaultText }

    init(defaultText: String, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.defaultText = defaultText.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = defaults.string(forKey: Self.key) ?? ""
        text = Self.isValid(saved) ? saved : self.defaultText
    }

    static func isValid(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= maximumLength
    }

    @discardableResult
    mutating func save(_ candidate: String) -> Bool {
        guard Self.isValid(candidate) else { return false }
        text = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        if usesDefault { defaults.removeObject(forKey: Self.key) }
        else { defaults.set(text, forKey: Self.key) }
        return true
    }

    mutating func reset() {
        defaults.removeObject(forKey: Self.key)
        text = defaultText
    }
}
