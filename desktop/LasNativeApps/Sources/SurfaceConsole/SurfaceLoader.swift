import Foundation

struct SurfaceLoader: Sendable {
    let workspaceRoot: URL
    let definition: SurfaceDefinition

    private let maximumEntries = 10_000

    func load() -> SurfaceSnapshot {
        let repositoryRoot = workspaceRoot
            .appendingPathComponent(definition.repositoryPath, isDirectory: true)
            .standardizedFileURL
        let checks = definition.checks.map { inspectCheck($0, repositoryRoot: repositoryRoot) }
        let aggregates = definition.aggregates.map { inspectAggregate($0, repositoryRoot: repositoryRoot) }
        let environment = ProcessInfo.processInfo.environment
        let configuredCount = definition.environmentNames.reduce(into: 0) { result, name in
            if let value = environment[name], !value.isEmpty { result += 1 }
        }

        return SurfaceSnapshot(
            repositoryRoot: repositoryRoot,
            checks: checks,
            aggregates: aggregates,
            configuredEnvironmentCount: configuredCount,
            declaredEnvironmentCount: definition.environmentNames.count,
            loadedAt: Date()
        )
    }

    private func inspectCheck(_ spec: CheckSpec, repositoryRoot: URL) -> ContractCheck {
        guard let url = safeURL(spec.relativePath, repositoryRoot: repositoryRoot),
              let values = try? url.resourceValues(forKeys: [
                .isDirectoryKey,
                .isRegularFileKey,
                .isSymbolicLinkKey,
                .contentModificationDateKey,
              ]),
              values.isSymbolicLink != true else {
            return ContractCheck(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                relativePath: spec.relativePath,
                isAvailable: false,
                modifiedAt: nil
            )
        }

        let available: Bool
        switch spec.kind {
        case .file:
            available = values.isRegularFile == true
        case .directory:
            available = values.isDirectory == true
        case .executable:
            available = values.isRegularFile == true
                && FileManager.default.isExecutableFile(atPath: url.path)
        }
        return ContractCheck(
            id: spec.id,
            title: spec.title,
            detail: spec.detail,
            relativePath: spec.relativePath,
            isAvailable: available,
            modifiedAt: values.contentModificationDate
        )
    }

    private func inspectAggregate(_ spec: AggregateSpec, repositoryRoot: URL) -> SafeAggregate {
        guard let root = safeURL(spec.relativePath, repositoryRoot: repositoryRoot),
              let rootValues = try? root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
              rootValues.isDirectory == true,
              rootValues.isSymbolicLink != true else {
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                count: nil,
                isTruncated: false
            )
        }

        switch spec.mode {
        case .immediateFiles, .immediateDirectories:
            let entries = (try? FileManager.default.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
                options: [.skipsHiddenFiles]
            )) ?? []
            var count = 0
            var truncated = false
            for entry in entries {
                guard let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]),
                      values.isSymbolicLink != true else { continue }
                let matchesKind = spec.mode == .immediateFiles
                    ? values.isRegularFile == true
                    : values.isDirectory == true
                guard matchesKind, extensionAllowed(entry, spec: spec) else { continue }
                count += 1
                if count >= maximumEntries {
                    truncated = true
                    break
                }
            }
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                count: count,
                isTruncated: truncated
            )

        case .recursiveFiles:
            guard let enumerator = FileManager.default.enumerator(
                at: root,
                includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else {
                return SafeAggregate(id: spec.id, title: spec.title, detail: spec.detail, count: nil, isTruncated: false)
            }
            var count = 0
            var truncated = false
            while let entry = enumerator.nextObject() as? URL {
                guard let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]) else {
                    continue
                }
                if values.isSymbolicLink == true {
                    if values.isDirectory == true { enumerator.skipDescendants() }
                    continue
                }
                guard values.isRegularFile == true, extensionAllowed(entry, spec: spec) else { continue }
                count += 1
                if count >= maximumEntries {
                    truncated = true
                    break
                }
            }
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                count: count,
                isTruncated: truncated
            )
        }
    }

    private func safeURL(_ relativePath: String, repositoryRoot: URL) -> URL? {
        guard !relativePath.hasPrefix("/"), !relativePath.split(separator: "/").contains("..") else {
            return nil
        }
        let candidate = repositoryRoot.appendingPathComponent(relativePath).standardizedFileURL
        let prefix = repositoryRoot.standardizedFileURL.path + "/"
        guard candidate.path == repositoryRoot.path || candidate.path.hasPrefix(prefix) else { return nil }
        return candidate
    }

    private func extensionAllowed(_ url: URL, spec: AggregateSpec) -> Bool {
        spec.allowedExtensions.isEmpty || spec.allowedExtensions.contains(url.pathExtension.lowercased())
    }
}
