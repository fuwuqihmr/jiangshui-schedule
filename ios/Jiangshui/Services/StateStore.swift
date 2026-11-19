// 【这个文件干什么】把整份课表数据存成手机里的一个 JSON 文件（state.json），下次打开还能恢复。
// 【什么时候会用到它】网页每次保存课表、读取课表、写诊断日志时。
// 【它和谁配合】网页的 state-sync/app.mjs、上课提醒服务（保存后重排提醒）、诊断服务。
// 【为什么有版本号】像多人改同一份文档：每次保存版本号加 1，旧页面拿旧版本号来存会被拒绝。
// 【怎么防丢数据】先写临时文件 state.tmp，成功后再替换正式文件；中途失败旧文件还在。
import Foundation

/// Port of android/app/src/main/java/cn/local/tomorrow/StateStore.java.
/// state.json lives in Application Support; writes go through state.tmp + rename.
/// 课表文件管家：读、写、清空 state.json，并提供简单的诊断日志追加。
final class StateStore: StateStoring {
    // 单个课表文件最多 8MB；超过就认为不是正常课表，避免读进超大文件把内存撑爆。
    static let maxBytes = 8000000
    /// Called after a successful save (Android: ClassReminders.onStateChanged).
    // 保存成功后的回调；容器会把它接到“重排上课提醒”上。
    var onChange: (() -> Void)?

    private let fileManager = FileManager.default

    // 所有文件都放在 Application Support（应用支持目录），系统不会随便清理它。
    private var directory: URL? {
        return try? fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    }

    private var stateURL: URL? { return directory?.appendingPathComponent("state.json") }
    private var tmpURL: URL? { return directory?.appendingPathComponent("state.tmp") }
    private var logURL: URL? { return directory?.appendingPathComponent("applog.txt") }

    /// 读取课表；文件不存在返回 nil（网页据此显示空课表），读坏则记日志后返回 nil。
    func load() -> JSONObject? {
        guard let url = stateURL, fileManager.fileExists(atPath: url.path) else { return nil }
        do {
            let data = try Data(contentsOf: url)
            if data.count > StateStore.maxBytes { throw BridgeFailure.message("文件过大") }
            let root = try JSONSerialization.jsonObject(with: data, options: [])
            guard let object = JSONCompat.object(root) else { throw BridgeFailure.message("课表数据格式无效") }
            return object
        } catch {
            log("state-load failed " + shortError(error))
            return nil
        }
    }

    /// 保存课表并返回新版本号。expectedRevision 是网页上次看到的版本号。
    /// 如果磁盘上的版本已经变了（别的页面先保存过），抛“课表已在后台更新，请稍后重试”。
    /// 写入采用“临时文件 + 替换”，避免写一半断电把原课表弄坏。
    func save(_ state: JSONObject, expectedRevision: Int64) throws -> Int64 {
        let old = load()
        let revision = old == nil ? 0 : (old?.optInt64("_revision", 0) ?? 0)
        if expectedRevision >= 0 && expectedRevision != revision {
            // 诊断日志：记录期望值与磁盘 revision，便于排查并发保存（对齐 Android 冲突时写 applog 的做法）。
            log("state-save conflict expected=\(expectedRevision) disk=\(revision)")
            throw BridgeFailure.message("课表已在后台更新，请稍后重试")
        }
        var next = state
        next["_revision"] = revision + 1
        guard let data = JSONCompat.jsonData(next), let tmp = tmpURL, let destination = stateURL else {
            throw BridgeFailure.message("课表保存失败")
        }
        do {
            try data.write(to: tmp, options: [.atomic])
            if fileManager.fileExists(atPath: destination.path) {
                // Atomic replacement keeps the old state if anything fails mid-write.
                _ = try fileManager.replaceItemAt(destination, withItemAt: tmp)
            } else {
                try fileManager.moveItem(at: tmp, to: destination)
            }
        } catch {
            log("state-save failed " + shortError(error))
            throw BridgeFailure.message("课表保存失败")
        }
        onChange?()
        return revision + 1
    }

    /// 注销时删除正式文件和临时文件；删不掉也不报错，尽量继续。
    func clear() {
        if let url = stateURL { try? fileManager.removeItem(at: url) }
        if let url = tmpURL { try? fileManager.removeItem(at: url) }
    }

    /// 往 applog.txt 追加一行“月-日 时:分:秒 + 内容”，诊断页会读它。
    /// 日志文件不存在就先新建；写日志失败静默忽略，不能影响主流程。
    func log(_ line: String) {
        guard let url = logURL else { return }
        let stamp: String
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MM-dd HH:mm:ss"
        stamp = formatter.string(from: Date())
        let text = stamp + " " + line + "\n"
        guard let data = text.data(using: .utf8) else { return }
        if fileManager.fileExists(atPath: url.path) == false {
            try? data.write(to: url, options: [])
            return
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }

    /// 把错误对象转成短文本写进日志，避免日志里出现很长的调试描述。
    private func shortError(_ error: Error) -> String {
        return String(describing: error)
    }
}
