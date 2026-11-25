// 【这个文件干什么】把网页请求的路径安全地对应到 App 包里的 web/ 文件。
// 【什么时候会用到它】本地小网站每收到一个 GET/HEAD 请求，都会来这里查文件。
// 【它和谁配合】LocalServer 负责网络收发，WebAssets 只负责“找文件 + 判断能不能给”。
import Foundation

/// 一次成功的静态资源查找结果。
/// 两样东西：data 是文件字节，mimeType 是浏览器该用的格式。
struct WebAsset {
    let data: Data
    let mimeType: String
}

/// 查找结果只有三种：找到了 / 没找到 / 路径不安全被拒绝。
enum WebAssetLookup {
    case found(WebAsset)
    case notFound
    /// 路径本身不安全（穿越/反斜杠/控制字符等）。服务端按 400 处理，不暴露原因给浏览器。
    case rejected(String)
}

/// 把浏览器请求的路径安全地映射到 App 包里的 web/ 文件。
///
/// `web/` folder reference 的只读访问层：安全路径校验 + 后缀→MIME 固定表。
///
/// 契约 `docs/IOS-PORT-CONTRACT.md` §1：
/// - bundle 根 = `Bundle.main.url(forResource: "web", withExtension: nil)`
/// - 拒绝 `..`、反斜杠、绝对路径、URL 解码后控制字符、非白名单后缀
/// - 只服务 GET/HEAD，其它由 LocalServer 返回 405
final class WebAssets {
    /// bundle 内 folder reference 的名字（project.yml 里 `path: ../web, type: folder`）。
    static let directoryName = "web"

    /// 后缀 → MIME 固定表（契约 §1 列出的 10 种）。
    static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "svg": "image/svg+xml",
        "ico": "image/x-icon",
        "txt": "text/plain; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
    ]

    /// 允许的后缀（不含点）。
    static let allowedExtensions: Set<String> = [
        "html", "mjs", "js", "css", "json", "png", "jpg", "jpeg", "svg", "ico", "txt", "webmanifest",
    ]

    // web/ 在手机里的真实位置；nil 表示 App 包里根本没打包网页。
    private let rootURL: URL?
    // 上面位置的字符串形式，用来检查“解析后的路径必须还在 web/ 里面”。
    private let rootPath: String

    /// 找到 App 包里的 web/ 目录；找不到也不崩，后面统一按 404 处理。
    init(bundle: Bundle = .main) {
        // folder reference 正常会用 url(forResource:) 找到；为防个别系统版本只按目录名查找失败，
        // 再用 resourceURL 拼一次（两者都指向 bundle 根下的 web/）。
        let byName = bundle.url(forResource: WebAssets.directoryName, withExtension: nil)
        let byPath = bundle.resourceURL?.appendingPathComponent(WebAssets.directoryName)
        let url = byName ?? byPath
        let resolved = url?.resolvingSymlinksInPath().standardizedFileURL
        self.rootURL = resolved
        self.rootPath = resolved?.path ?? ""
    }

    /// bundle 里是否真的存在 `web/`（缺失时服务会统一 404，UI 给出提示）。
    var isAvailable: Bool {
        guard !rootPath.isEmpty else { return false }
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: rootPath, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    /// 把 /index.html 这样的请求路径变成文件内容；任何可疑路径都拒绝。
    func lookup(requestPath: String) -> WebAssetLookup {
        guard let root = rootURL, !rootPath.isEmpty else { return .notFound }
        guard let relative = WebAssets.normalizedRelativePath(requestPath) else {
            return .rejected("请求路径不安全：\(requestPath.prefix(120))")
        }
        let fileURL = root.appendingPathComponent(relative, isDirectory: false)
        let resolved = fileURL.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.path.hasPrefix(rootPath + "/") else {
            return .rejected("请求路径越出 web/ 目录：\(relative.prefix(120))")
        }
        guard let mime = WebAssets.mimeType(forPath: resolved.path) else {
            return .notFound
        }
        guard let data = try? Data(contentsOf: resolved) else {
            return .notFound
        }
        return .found(WebAsset(data: data, mimeType: mime))
    }

    /// 根据文件后缀查固定 MIME 表；不在表里就当作不允许访问。
    static func mimeType(forPath path: String) -> String? {
        let ext = (path as NSString).pathExtension.lowercased()
        guard !ext.isEmpty, allowedExtensions.contains(ext) else { return nil }
        return mimeTypes[ext]
    }

    /// 这是路径安全的总闸门：先解码一次，再逐段检查，最后只放行白名单后缀。
    ///
    /// `/a/b.css?x=1`（query 已在服务端剥掉）→ `a/b.css`；`/` → `index.html`。
    /// 返回 nil 表示拒绝（调用方回 400），不区分「文件不存在」。
    static func normalizedRelativePath(_ raw: String) -> String? {
        guard !raw.isEmpty, !raw.contains("\\") else { return nil }
        // 只解码一次；非法百分号编码直接拒绝（removingPercentEncoding 返回 nil）。
        guard let decoded = raw.removingPercentEncoding, !decoded.isEmpty else { return nil }
        guard decoded.hasPrefix("/") else { return nil }
        if decoded.contains("\\") { return nil }
        if decoded.contains("?") || decoded.contains("#") { return nil }
        for scalar in decoded.unicodeScalars {
            if scalar.value < 0x20 || scalar.value == 0x7F { return nil }
        }
        var components: [String] = []
        for part in decoded.split(separator: "/", omittingEmptySubsequences: true) {
            let component = String(part)
            if component == "." || component == ".." { return nil }
            if component.contains(":") { return nil }
            components.append(component)
        }
        if decoded.hasSuffix("/") || components.isEmpty {
            components.append("index.html")
        }
        guard let last = components.last else { return nil }
        let ext = (last as NSString).pathExtension.lowercased()
        guard allowedExtensions.contains(ext) else { return nil }
        return components.joined(separator: "/")
    }
}
