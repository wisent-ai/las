import Foundation

public enum WorkspaceLocator {
    public static func resolve(savedPath: String?) -> URL? {
        let manager = FileManager.default
        var candidates: [URL] = []

        if let savedPath, !savedPath.isEmpty {
            candidates.append(URL(fileURLWithPath: savedPath, isDirectory: true))
        }
        if let environment = ProcessInfo.processInfo.environment["WISENT_WORKSPACE_ROOT"], !environment.isEmpty {
            candidates.append(URL(fileURLWithPath: environment, isDirectory: true))
        }
        candidates.append(URL(fileURLWithPath: manager.currentDirectoryPath, isDirectory: true))
        candidates.append(
            manager.homeDirectoryForCurrentUser
                .appendingPathComponent("Documents/CodingProjects/Wisent", isDirectory: true)
        )

        var ancestor = Bundle.main.bundleURL.standardizedFileURL
        for _ in 0..<14 {
            candidates.append(ancestor)
            ancestor.deleteLastPathComponent()
        }

        var seen = Set<String>()
        for candidate in candidates {
            var current = candidate.standardizedFileURL
            for _ in 0..<10 {
                let path = current.path
                if seen.insert(path).inserted, isWorkspace(current) {
                    return current
                }
                let parent = current.deletingLastPathComponent()
                if parent.path == current.path { break }
                current = parent
            }
        }
        return nil
    }

    public static func isWorkspace(_ url: URL) -> Bool {
        let manager = FileManager.default
        return manager.fileExists(atPath: url.appendingPathComponent("las/src/registry.mjs").path)
            && manager.fileExists(atPath: url.appendingPathComponent("weles", isDirectory: true).path)
            && manager.fileExists(atPath: url.appendingPathComponent("wisent-compute", isDirectory: true).path)
    }
}
