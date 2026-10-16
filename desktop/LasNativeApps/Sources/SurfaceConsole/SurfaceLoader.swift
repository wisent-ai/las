import Foundation

struct SurfaceLoader: Sendable {
    let workspaceRoot: URL
    let definition: SurfaceDefinition

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
        func unavailable(_ cause: String) -> ContractCheck {
            return ContractCheck(
                id: spec.id,
                title: spec.title,
                detail: "\(spec.detail)\n\(cause)",
                relativePath: spec.relativePath,
                isAvailable: false,
                modifiedAt: nil
            )
        }
        guard let url = safeURL(spec.relativePath, repositoryRoot: repositoryRoot) else {
            return unavailable("Refused path outside repository: \(spec.relativePath)")
        }
        let values: URLResourceValues
        do {
            values = try url.resourceValues(forKeys: [
                .isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey,
            ])
        } catch {
            return unavailable("Cannot read resource properties for \(url.path): \(error)")
        }
        guard values.isSymbolicLink != true else {
            return unavailable("Refused symbolic link: \(url.path)")
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
            detail: available ? spec.detail : "\(spec.detail)\n\(url.path) does not satisfy required kind \(spec.kind).",
            relativePath: spec.relativePath,
            isAvailable: available,
            modifiedAt: values.contentModificationDate
        )
    }

    private func inspectAggregate(_ spec: AggregateSpec, repositoryRoot: URL) -> SafeAggregate {
        func unavailable(_ cause: String) -> SafeAggregate {
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: "\(spec.detail)\n\(cause)",
                count: nil
            )
        }
        guard let root = safeURL(spec.relativePath, repositoryRoot: repositoryRoot) else {
            return unavailable("Refused path outside repository: \(spec.relativePath)")
        }
        do {
            let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                return unavailable("Expected a non-symbolic-link directory at \(root.path)")
            }
        } catch {
            return unavailable("Cannot read directory properties for \(root.path): \(error)")
        }

        switch spec.mode {
        case .immediateFiles, .immediateDirectories:
            let entries: [URL]
            do {
                entries = try FileManager.default.contentsOfDirectory(
                    at: root,
                    includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
                    options: [.skipsHiddenFiles]
                )
            } catch {
                return unavailable("Cannot list directory \(root.path): \(error)")
            }
            var count = 0
            for entry in entries {
                let values: URLResourceValues
                do {
                    values = try entry.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
                } catch {
                    return unavailable("Cannot read resource properties for \(entry.path): \(error)")
                }
                guard values.isSymbolicLink != true else { continue }
                let matchesKind = spec.mode == .immediateFiles
                    ? values.isRegularFile == true
                    : values.isDirectory == true
                guard matchesKind, extensionAllowed(entry, spec: spec) else { continue }
                count += 1
            }
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                count: count
            )

        case .recursiveFiles:
            var traversalError: String?
            guard let enumerator = FileManager.default.enumerator(
                at: root,
                includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants],
                errorHandler: { url, error in
                    traversalError = "Cannot enumerate \(url.path): \(error)"
                    return false
                }
            ) else {
                return unavailable("Cannot create directory enumerator for \(root.path)")
            }
            var count = 0
            while let entry = enumerator.nextObject() as? URL {
                let values: URLResourceValues
                do {
                    values = try entry.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
                } catch {
                    return unavailable("Cannot read resource properties for \(entry.path): \(error)")
                }
                if values.isSymbolicLink == true {
                    if values.isDirectory == true { enumerator.skipDescendants() }
                    continue
                }
                guard values.isRegularFile == true, extensionAllowed(entry, spec: spec) else { continue }
                count += 1
            }
            if let traversalError {
                return unavailable(traversalError)
            }
            return SafeAggregate(
                id: spec.id,
                title: spec.title,
                detail: spec.detail,
                count: count
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
