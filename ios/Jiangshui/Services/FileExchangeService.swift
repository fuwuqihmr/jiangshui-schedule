// 【这个文件干什么】负责和“文件”打交道：让用户选一个 JSON 导入课表，或把文件导出到“文件”App。
// 【什么时候会用到它】网页点“导入课表”“导出快照”“导出图片/PDF”“导出诊断日志”时。
// 【它和谁配合】网页桥接层、iOS 的 UIDocumentPickerViewController（系统文件选择框）。
// 【小白提示】Android 用 SAF（存储访问框架），iOS 用系统文件选择框；用户选完文件，App 只拿到临时访问权。
// 【注意】同一时间只允许一个文件操作，避免两个选择框叠在一起。
import Foundation
import UIKit
import UniformTypeIdentifiers

/// Port of the document picker branches in MainActivity.java (beginDocument/onActivityResult).
/// Android uses the Storage Access Framework; iOS uses UIDocumentPickerViewController.
/// 文件交换器：弹系统文件框导入/导出，并在服务内部做大小、类型、文件名校验。
final class FileExchangeService: NSObject, FileExchanging, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private let presenting: () -> UIViewController?
    // busy 像“洗手间有人”的牌子：一次只允许一个文件操作，结束后必须翻回去。
    private var busy = false
    private let lock = NSLock()
    private var pendingCompletion: (([URL]?) -> Void)?
    private var pendingExport = false
    private var pendingResult: ((Bool) -> Void)?
    private var finished = false

    /// presenting 由 App 层注入，用来找到当前最上层的页面来弹文件框。
    init(presenting: @escaping () -> UIViewController?) {
        self.presenting = presenting
        super.init()
    }

    /// 进入文件操作：如果已有操作在进行，抛“请先完成上一次文件操作”。
    private func begin() throws {
        lock.lock()
        let active = busy
        if active == false { busy = true }
        lock.unlock()
        if active { throw BridgeFailure.message("请先完成上一次文件操作") }
    }

    /// 结束文件操作，释放 busy 锁；无论成功、取消还是失败都要走到这里。
    private func end() {
        lock.lock()
        busy = false
        lock.unlock()
    }

    /// 找当前能弹框的页面；找不到就按 Android 同款文案提示“文件读写失败…”。
    private func presenter() throws -> UIViewController {
        guard let controller = presenting() else {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        return controller
    }

    /// 让用户选一个 JSON 文件并读出文本；用户取消返回空字典，文件过大提示“文件超过2MB”。
    /// 读取时申请安全作用域权限，读完立刻释放，避免长期占用用户文件。
    func importTextFile() async throws -> JSONObject {
        try begin()
        defer { end() }
        let controller = try presenter()
        let urls = await presentImport(from: controller)
        guard let url = urls?.first else { return [:] }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        guard data.count <= 2000000 else { throw BridgeFailure.message("文件超过2MB") }
        guard let text = String(data: data, encoding: .utf8) else {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        return ["text": text]
    }

    /// 把文本写进临时文件再弹“存储到文件”；返回 true 表示已保存，false 表示用户取消。
    func exportText(_ text: String, filename: String) async throws -> Bool {
        guard let data = text.data(using: .utf8) else {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        return try await exportData(data, filename: filename)
    }

    /// 导出图片/PDF/文本：先按 mime 决定后缀，再校验文件名、大小和 base64 是否合法。
    /// 任何一项不合格都抛“导出文件格式无效/文件超过32MB/文件大小无效”。
    func exportBase64(mime: String, filename: String, base64: String) async throws -> Bool {
        let fileExtension: String
        switch mime {
        case "image/png": fileExtension = ".png"
        case "application/pdf": fileExtension = ".pdf"
        case "text/plain": fileExtension = ".txt"
        default: throw BridgeFailure.message("导出文件格式无效")
        }
        guard filename.hasSuffix(fileExtension), filename.count <= 180,
              filename.rangeOfCharacter(from: CharacterSet(charactersIn: "\\/:*?\"<>|")) == nil else {
            throw BridgeFailure.message("导出文件格式无效")
        }
        guard base64.count <= 44739244 else { throw BridgeFailure.message("文件超过32MB") }
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            throw BridgeFailure.message("文件大小无效")
        }
        guard data.count > 0, data.count <= 32 * 1024 * 1024 else {
            throw BridgeFailure.message("文件大小无效")
        }
        return try await exportData(data, filename: filename)
    }

    /// 导出诊断日志：文件名必须是“江水课表-排查日志-日期.txt”，正文最多 20 万字符。
    func exportDiagnostics(filename: String, text: String) async throws -> Bool {
        // Same rule as MainActivity.java: 江水课表-排查日志-[0-9-]+.txt and at most 200000 characters.
        let prefix = "江水课表-排查日志-"
        let suffix = ".txt"
        guard filename.hasPrefix(prefix), filename.hasSuffix(suffix) else {
            throw BridgeFailure.message("排查文件格式无效")
        }
        let middle = String(filename.dropFirst(prefix.count).dropLast(suffix.count))
        guard middle.isEmpty == false, middle.allSatisfy({ $0.isNumber || $0 == "-" }) else {
            throw BridgeFailure.message("排查文件格式无效")
        }
        guard text.count <= 200000 else { throw BridgeFailure.message("排查文件格式无效") }
        guard let data = text.data(using: .utf8) else {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        return try await exportData(data, filename: filename)
    }

    /// 公共导出流程：建临时目录、写文件、弹系统保存框；结束后删掉临时目录。
    private func exportData(_ data: Data, filename: String) async throws -> Bool {
        try begin()
        defer { end() }
        let controller = try presenter()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("jiangshui-export-" + UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        defer { try? FileManager.default.removeItem(at: directory) }
        let fileURL = directory.appendingPathComponent(filename)
        do {
            try data.write(to: fileURL, options: [])
        } catch {
            throw BridgeFailure.message("文件读写失败，请重新选择保存位置")
        }
        return await presentExport(fileURL, from: controller)
    }

    /// 弹导入框并等待用户选择；用 continuation 把“回调式”API 包成 async/await。
    private func presentImport(from controller: UIViewController) async -> [URL]? {
        return await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.json], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            finished = false
            pendingExport = false
            pendingCompletion = { urls in continuation.resume(returning: urls) }
            DispatchQueue.main.async {
                controller.present(picker, animated: true) {
                    picker.presentationController?.delegate = self
                }
            }
        }
    }

    /// 弹导出框并等待用户保存；true 表示保存成功，false 表示取消或下滑关闭。
    private func presentExport(_ url: URL, from controller: UIViewController) async -> Bool {
        return await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            finished = false
            pendingExport = true
            pendingResult = { saved in continuation.resume(returning: saved) }
            DispatchQueue.main.async {
                controller.present(picker, animated: true) {
                    picker.presentationController?.delegate = self
                }
            }
        }
    }

    /// 用户选好文件/保存位置后的回调；用 finished 防止重复回调把等待方唤醒两次。
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if finished { return }
        finished = true
        if pendingExport {
            let callback = pendingResult
            pendingResult = nil
            pendingCompletion = nil
            callback?(true)
        } else {
            let callback = pendingCompletion
            pendingCompletion = nil
            pendingResult = nil
            callback?(urls)
        }
    }

    /// 用户点“取消”时的回调；导入返回 nil，导出返回 false。
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishWithCancel()
    }

    // A sheet can be dismissed by swiping it down on iPad without invoking
    // documentPickerWasCancelled. Without this the continuation would never
    // resume and the busy lock would stay closed.
    /// iPad 上把文件框向下滑关闭时，系统不一定走“取消”回调；这里兜底释放等待方。
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finishWithCancel()
    }

    /// 统一的取消收尾：只执行一次，避免连续回调导致崩溃或重复恢复 continuation。
    private func finishWithCancel() {
        if finished { return }
        finished = true
        if pendingExport {
            let callback = pendingResult
            pendingResult = nil
            pendingCompletion = nil
            callback?(false)
        } else {
            let callback = pendingCompletion
            pendingCompletion = nil
            pendingResult = nil
            callback?(nil)
        }
    }
}