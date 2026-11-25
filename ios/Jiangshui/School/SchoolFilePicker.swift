// 【这个文件干什么】网页里点「选择文件 / 上传照片」时，帮用户弹出选照片或选文件的界面，
//   并把选中的东西复制成临时文件，再把临时文件的地址交给网页去上传。
// 【什么时候会用到它】请假页要上传证明材料（病例、照片、PDF）时；平时不出现。
// 【它和谁配合】由 SchoolWebViewHost 在网页说「我要选文件」时创建；选完把地址清单回调给
//   WebKit，WebKit 再去读这些临时文件并上传。
// 【为什么复制一份】系统选出来的文件（尤其相册照片）只是张「借条」，网页稍后去读时可能已经
//   没权限了；所以先复制到 App 的临时目录，5 分钟后自动删——删早了上传就会失败。
// 【注意】这个类目前还没接线（为 iOS 18.4+ 预留），现在不会生效。
import Foundation
import UIKit
import PhotosUI
import UniformTypeIdentifiers

// <input type=file> 的文件选择实现（对应 Android MainActivity.java:405-452 的
// onShowFileChooser 与回调处理）。
//
// WKWebView 只把「打开选择面板 + 回填 URL」交给我们，不像 Android 有 Uri[] 回调；
// 因此这里把选中的照片/文件复制到临时目录，再把临时文件 URL 交给 WebKit。
// 临时文件保留 5 分钟：页面拿到 URL 后可能还要上传，过早删除会让上传失败。
// 本机 Windows 无 Xcode/swiftc，未编译验证。
/// 文件/照片选择器。用法：创建 → 调 start() → 等 completion 拿回临时文件地址（取消时给 nil）。
/// 一次只弹一个面板；同一个对象只回调一次结果（内部用 finished 标记挡住重复回调）。
final class SchoolFilePicker: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {

    // presenter 是「从哪个界面弹出来」，用 weak（弱引用）避免两边互相强引用、谁都释放不掉。
    // completion 是选完之后的回话通道：拿到地址就给数组，取消就给 nil。
    private weak var presenter: UIViewController?
    private let allowsMultiple: Bool
    private let completion: ([URL]?) -> Void
    private var finished = false
    private var sheet: UIAlertController?
    private var temporaryURLs: [URL] = []
    private let lock = NSLock()

    /// 造一个选择器。presenter 是弹出面板的界面；allowsMultiple 表示能不能一次选多个；
    /// completion 是选完的回调（只会被调用一次）。
    init(presenter: UIViewController, allowsMultiple: Bool, completion: @escaping ([URL]?) -> Void) {
        self.presenter = presenter
        self.allowsMultiple = allowsMultiple
        self.completion = completion
        super.init()
    }

    /// 开始选择：先弹一个「照片 / 文件 / 取消」的小菜单。
    /// 如果当前已经有别的弹窗，就直接按「取消」结束，避免两个面板叠在一起。
    func start() {
        guard let presenter = presenter else {
            finish(nil)
            return
        }
        // 已经有 alert/picker 时不再叠加，直接按取消处理。
        guard presenter.presentedViewController == nil else {
            finish(nil)
            return
        }
        let sheet = UIAlertController(title: "上传附件", message: "请选择要上传的附件", preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "照片", style: .default, handler: { [weak self] _ in
            self?.dismissSheet { self?.showPhotos() }
        }))
        sheet.addAction(UIAlertAction(title: "文件", style: .default, handler: { [weak self] _ in
            self?.dismissSheet { self?.showDocuments() }
        }))
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel, handler: { [weak self] _ in
            self?.dismissSheet { self?.finish(nil) }
        }))
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1.0, height: 1.0)
            popover.permittedArrowDirections = []
        }
        self.sheet = sheet
        presenter.present(sheet, animated: true, completion: nil)
    }

    /// 先把小菜单关掉，再执行 then——关完再弹下一个面板，否则两个面板会打架。
    private func dismissSheet(_ then: @escaping () -> Void) {
        guard let sheet = sheet else {
            then()
            return
        }
        sheet.dismiss(animated: false) { [weak self] in
            self?.sheet = nil
            then()
        }
    }

    /// 弹系统相册选择器。selectionLimit 为 0 表示「不限制张数」，为 1 表示只能选一张。
    private func showPhotos() {
        guard let presenter = presenter, presenter.presentedViewController == nil else {
            finish(nil)
            return
        }
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = allowsMultiple ? 0 : 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        presenter.present(picker, animated: true, completion: nil)
    }

    /// 弹系统「文件」选择器（可挑 PDF、图片、任意文件）。asCopy: true 让系统先复制一份给 App。
    private func showDocuments() {
        guard let presenter = presenter, presenter.presentedViewController == nil else {
            finish(nil)
            return
        }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: true)
        picker.allowsMultipleSelection = allowsMultiple
        picker.delegate = self
        presenter.present(picker, animated: true, completion: nil)
    }

    // MARK: - PHPickerViewControllerDelegate

    /// 相册里点「完成 / 取消」后回调。空数组代表用户取消；有图就逐张读出来复制成临时文件。
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: false) { [weak self] in
            guard let self = self else { return }
            if results.isEmpty {
                self.finish(nil)
                return
            }
            self.loadImages(results)
        }
    }

    /// 逐张把相册图片读成文件。读图是异步的、可能多张同时进行，所以用 DispatchGroup
    /// （一个「等大家都干完再集合」的计数器）等全部结束，再在 group.notify 里统一回调。
    /// 数组读写加了锁（NSLock），因为多张图是并行回来的，避免同时改数组出错。
    private func loadImages(_ results: [PHPickerResult]) {
        let group = DispatchGroup()
        var urls: [URL] = []
        for result in results {
            group.enter()
            result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
                defer { group.leave() }
                guard let self = self, error == nil, let source = url else { return }
                guard let copied = self.copyToTemporary(source) else { return }
                self.lock.lock()
                urls.append(copied)
                self.temporaryURLs.append(copied)
                self.lock.unlock()
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let picked = urls
            self.lock.unlock()
            if picked.isEmpty {
                self.finish(nil)
            } else {
                self.finish(picked)
            }
        }
    }

    // MARK: - UIDocumentPickerDelegate

    /// 「文件」选择器选中后回调：逐个复制成临时文件；一个都没复制成就当用户取消。
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if urls.isEmpty {
            finish(nil)
            return
        }
        var copiedURLs: [URL] = []
        for url in urls {
            if let copied = copyToTemporary(url) {
                copiedURLs.append(copied)
                temporaryURLs.append(copied)
            }
        }
        if copiedURLs.isEmpty {
            finish(nil)
        } else {
            finish(copiedURLs)
        }
    }

    /// 用户在「文件」面板按了取消。
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(nil)
    }

    // MARK: - 临时文件

    /// 把用户选的文件复制到 App 的临时目录，返回新地址；复制失败返回 nil。
    /// startAccessingSecurityScopedResource 是向系统「借用」沙盒外文件权限的开关，用完要还。
    private func copyToTemporary(_ source: URL) -> URL? {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let ext = source.pathExtension.isEmpty ? "dat" : source.pathExtension
        let name = "jiangshui-upload-" + UUID().uuidString + "." + ext
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try FileManager.default.copyItem(at: source, to: destination)
            return destination
        } catch {
            return nil
        }
    }

    /// 收尾：保证结果只回调一次（finished 是闸门），然后安排 5 分钟后删掉这些临时文件。
    private func finish(_ urls: [URL]?) {
        guard finished == false else { return }
        finished = true
        completion(urls)
        guard let urls = urls, urls.isEmpty == false else { return }
        // 保留 5 分钟，给页面留出上传时间；之后无论成功失败都清理。
        DispatchQueue.main.asyncAfter(deadline: .now() + 300.0) {
            for url in urls {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    /// 对象销毁时兜底：如果还没走过 finish，就把已复制的临时文件清掉，别在手机里留垃圾。
    deinit {
        // 没有走 finish（例如容器被直接销毁）时，至少清掉已经复制的临时文件。
        if finished == false {
            for url in temporaryURLs {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}
