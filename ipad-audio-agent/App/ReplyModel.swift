import Foundation

enum ReplyModel: String, CaseIterable, Sendable {
    case apple = "Apple"
    case qwen35_2 = "Qwen3.5 2B"
    case qwen17 = "Qwen3 1.7B"
    case qwen06 = "Qwen3 0.6B"

    static let exampleInput = "Hallo, heute ist es aber echt kalt"

    var repository: String? {
        switch self {
        case .apple: nil
        case .qwen35_2: "mlx-community/Qwen3.5-2B-4bit"
        case .qwen17: "mlx-community/Qwen3-1.7B-4bit"
        case .qwen06: "mlx-community/Qwen3-0.6B-4bit"
        }
    }

    var revision: String {
        switch self {
        case .apple: ""
        case .qwen35_2: "674aaa7240b91e8012fcad5d791b7dfe5ba90207"
        case .qwen17: "3b1b1768f8f8cf8351c712464f906e86c2b8269e"
        case .qwen06: "73e3e38d981303bc594367cd910ea6eb48349da8"
        }
    }

    var downloadSize: String {
        switch self {
        case .apple: ""
        case .qwen35_2: "ca. 1,75 GB"
        case .qwen17: "ca. 983 MB"
        case .qwen06: "ca. 350 MB"
        }
    }

    var requiredFiles: Set<String> {
        let files: Set<String> = ["config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors"]
        return self == .qwen35_2 ? files.union(["chat_template.jinja"]) : files
    }
}
