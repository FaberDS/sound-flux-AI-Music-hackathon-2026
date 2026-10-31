// AVSpeechSynthesisVoice quality: default = 1, enhanced = 2, premium = 3.
enum SpeechOutput: String, CaseIterable {
    case apple = "Apple"
    case pocket = "Pocket"
    case supertonic = "Supertonic"
}

// Prefer quality first, then de-DE when the quality is equal. Zero excludes other languages.
func germanVoiceRank(language: String, quality: Int) -> Int {
    guard language.hasPrefix("de-") else { return 0 }
    return quality * 2 + (language == "de-DE" ? 1 : 0)
}
