import Foundation

enum PocketAssets {
    static let revision = "91748676fe3c8b2eb3007b3125253bcd898202c3"
    static let directory = "v2.1/german"
    // Alba MacKenna's supplied recording is explicitly CC BY 4.0.
    // Other catalog voices include noncommercial material: never fetch the whole catalog.
    static let voice = "alba"
    static let models: Set<String> = [
        "cond_prefill.mlmodelc", "flowlm_step.mlmodelc",
        "flow_decoder_fused.mlmodelc", "mimi_decoder.mlmodelc"
    ]
    static let constants: Set<String> = [
        "alba.safetensors", "bos_before_voice.bin", "bos_emb.bin",
        "text_embed_table.bin", "tokenizer.model"
    ]

    static func includes(_ path: String) -> Bool {
        let prefix = directory + "/"
        guard path.hasPrefix(prefix) else { return false }
        let parts = path.dropFirst(prefix.count).split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.contains(".."), !parts.contains("."), !parts.contains("") else { return false }
        if parts.first == "constants_bin" {
            return parts.count == 1 || (parts.count == 2 && constants.contains(String(parts[1])))
        }
        return parts.first.map { models.contains(String($0)) } ?? false
    }
}

// A directory can exist after a cancelled download; require the completion marker too.
func voiceAssetsComplete(at root: URL, revision: String, required: Set<String>, markerName: String = ".soundflux-complete") -> Bool {
    let marker = root.appendingPathComponent(markerName)
    return (try? String(contentsOf: marker, encoding: .utf8)) == revision
        && required.allSatisfy { FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path) }
}
