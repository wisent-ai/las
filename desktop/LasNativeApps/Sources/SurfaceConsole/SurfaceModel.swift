import Combine
import Foundation

@MainActor
public final class SurfaceModel: ObservableObject {
    @Published public private(set) var workspaceRoot: URL?
    @Published public private(set) var snapshot: SurfaceSnapshot?
    @Published public private(set) var isRefreshing = false
    @Published public private(set) var errorMessage: String?

    public let definition: SurfaceDefinition
    private let defaults: UserDefaults
    private var generation = 0

    public init(definition: SurfaceDefinition, defaults: UserDefaults = .standard) {
        self.definition = definition
        self.defaults = defaults
        let key = "lasNativeApps.\(definition.id).workspaceRoot"
        workspaceRoot = WorkspaceLocator.resolve(savedPath: defaults.string(forKey: key))
        if workspaceRoot == nil {
            errorMessage = "Choose the local Wisent workspace to inspect this surface."
        }
    }

    public var availableCheckCount: Int {
        snapshot?.checks.filter(\.isAvailable).count ?? 0
    }

    public var aggregateTotal: Int {
        snapshot?.aggregates.compactMap(\.count).reduce(0, +) ?? 0
    }

    public func refresh() async {
        guard !isRefreshing else { return }
        guard let workspaceRoot else {
            errorMessage = "A local Wisent workspace has not been selected."
            return
        }
        let currentGeneration = generation
        isRefreshing = true
        defer {
            if currentGeneration == generation { isRefreshing = false }
        }

        let loader = SurfaceLoader(workspaceRoot: workspaceRoot, definition: definition)
        let loaded = await Task.detached(priority: .userInitiated) {
            loader.load()
        }.value
        guard generation == currentGeneration, !Task.isCancelled else { return }
        snapshot = loaded
        errorMessage = nil
    }

    public func selectWorkspace(_ url: URL) {
        let standardized = url.standardizedFileURL
        guard WorkspaceLocator.isWorkspace(standardized) else {
            errorMessage = "The selected folder is not the Wisent workspace containing Las."
            return
        }
        generation &+= 1
        workspaceRoot = standardized
        snapshot = nil
        errorMessage = nil
        defaults.set(standardized.path, forKey: "lasNativeApps.\(definition.id).workspaceRoot")
        Task { await refresh() }
    }
}
