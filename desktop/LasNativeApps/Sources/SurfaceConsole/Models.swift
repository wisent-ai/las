import Foundation

public enum SurfaceAccent: String, Sendable {
    case blue, cyan, green, indigo, orange, purple, teal
}

public enum CheckKind: String, Sendable {
    case file
    case directory
    case executable
}

public struct CheckSpec: Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let relativePath: String
    public let kind: CheckKind

    public init(id: String, title: String, detail: String, relativePath: String, kind: CheckKind) {
        self.id = id
        self.title = title
        self.detail = detail
        self.relativePath = relativePath
        self.kind = kind
    }
}

public enum AggregateMode: String, Sendable {
    case immediateFiles
    case immediateDirectories
    case recursiveFiles
}

public struct AggregateSpec: Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let relativePath: String
    public let mode: AggregateMode
    public let allowedExtensions: Set<String>

    public init(
        id: String,
        title: String,
        detail: String,
        relativePath: String,
        mode: AggregateMode,
        allowedExtensions: Set<String> = []
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.relativePath = relativePath
        self.mode = mode
        self.allowedExtensions = allowedExtensions
    }
}

public struct SurfaceDefinition: Sendable {
    public let id: String
    public let name: String
    public let subtitle: String
    public let symbol: String
    public let accent: SurfaceAccent
    public let repositoryPath: String
    public let privacyBoundary: String
    public let checks: [CheckSpec]
    public let aggregates: [AggregateSpec]
    public let environmentNames: [String]

    public init(
        id: String,
        name: String,
        subtitle: String,
        symbol: String,
        accent: SurfaceAccent,
        repositoryPath: String,
        privacyBoundary: String,
        checks: [CheckSpec],
        aggregates: [AggregateSpec],
        environmentNames: [String]
    ) {
        self.id = id
        self.name = name
        self.subtitle = subtitle
        self.symbol = symbol
        self.accent = accent
        self.repositoryPath = repositoryPath
        self.privacyBoundary = privacyBoundary
        self.checks = checks
        self.aggregates = aggregates
        self.environmentNames = environmentNames
    }
}

public struct ContractCheck: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let relativePath: String
    public let isAvailable: Bool
    public let modifiedAt: Date?
}

public struct SafeAggregate: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let count: Int?
    public let isTruncated: Bool
}

public struct SurfaceSnapshot: Sendable {
    public let repositoryRoot: URL
    public let checks: [ContractCheck]
    public let aggregates: [SafeAggregate]
    public let configuredEnvironmentCount: Int
    public let declaredEnvironmentCount: Int
    public let loadedAt: Date
}

public enum ConsoleDestination: String, CaseIterable, Identifiable, Hashable {
    case overview
    case contracts
    case inventory
    case configuration

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .overview: "Overview"
        case .contracts: "Contracts"
        case .inventory: "Inventory"
        case .configuration: "Configuration"
        }
    }

    public var symbol: String {
        switch self {
        case .overview: "gauge.with.dots.needle.67percent"
        case .contracts: "checkmark.shield"
        case .inventory: "list.bullet.rectangle"
        case .configuration: "gearshape.2"
        }
    }
}
