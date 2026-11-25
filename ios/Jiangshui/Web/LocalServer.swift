// 【这个文件干什么】在手机内部开一个“只给本机看”的小网站，把 App 包里的网页发给 WKWebView。
// 【什么时候会用到它】App 启动、回到前台时；网页加载不出来时也会重新启动它。
// 【它和谁配合】WebAssets 负责找文件，WebHost 拿到实际端口后加载 http://127.0.0.1:端口/index.html。
import Foundation
import Network

/// 本机小网站：只服务 App 自己，局域网里的其他设备访问不到。
///
/// loopback 只读 HTTP/1.1 服务（契约 §1）。
///
/// - 只监听 127.0.0.1，端口从 47851 顺序试到 47860（固定端口是为了 localStorage 的 origin 稳定）
/// - 只支持 GET / HEAD；`Cache-Control: no-store`；`Connection: close`；单连接处理完即关
/// - 请求头累计超过 32KB → 431；每个连接 15 秒 watchdog
final class LocalServer {
    // 端口从 47851 开始试；固定区间是为了每次启动的网页地址（origin）不变，localStorage 才不会丢。
    static let firstPort: UInt16 = 47851
    // 最多试到 47860；10 个都占用就报错，不再乱试。
    static let lastPort: UInt16 = 47860
    // 请求头最大 32KB；超过就回 431，防止超大请求把内存撑爆。
    static let maxRequestBytes = 32 * 1024
    // 单个连接最多等 15 秒；超时主动关掉，避免连接越积越多。
    static let connectionTimeout: TimeInterval = 15

    /// 主线程回调：服务就绪，参数是实际绑定端口。
    var onReady: ((UInt16) -> Void)?
    /// 主线程回调：10 个端口都失败时的中文提示。
    var onFailure: ((String) -> Void)?

    // 资源读取器：把浏览器请求的路径变成 App 包里的真实文件。
    private let assets: WebAssets
    // 所有网络事件都在这个串行队列里排队，避免多线程同时改连接表。
    private let queue = DispatchQueue(label: "cn.local.tomorrow.loopback-server")
    // NWListener（监听端口、等浏览器来连的“门卫”）；nil 表示还没开张。
    private var listener: NWListener?
    // 当前还活着的连接；用 ObjectIdentifier 当钥匙，连接对象本身不能直接做字典 key。
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    // 防止用户连点“重试”时重复启动。
    private var starting = false

    /// 仅主线程读写；nil 表示当前没有监听。
    private(set) var port: UInt16?

    /// 传入资源读取器；真正的端口监听要等 start() 才会发生。
    init(assets: WebAssets) {
        self.assets = assets
    }

    /// 是否已经绑定端口（给外部判断服务在不在）。
    var isRunning: Bool { port != nil }

    // MARK: - 生命周期（主线程调用）

    /// 主线程调用：把“开始监听”丢到后台队列，按 47851→47860 顺序试。
    func start() {
        guard port == nil, !starting else { return }
        starting = true
        queue.async { [weak self] in
            guard let self = self else { return }
            self.startLocked(from: LocalServer.firstPort)
        }
    }

    /// 主线程调用：关掉监听和所有连接，并把 port 清空。
    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.starting = false
            if let listener = self.listener {
                listener.stateUpdateHandler = nil
                listener.cancel()
                self.listener = nil
            }
            let alive = Array(self.connections.values)
            self.connections.removeAll()
            for connection in alive { connection.cancel() }
            DispatchQueue.main.async { self.port = nil }
        }
    }

    // MARK: - 端口尝试（串行队列）

    /// 串行队列内部：从 candidate 开始逐个端口尝试，直到成功或试完。
    private func startLocked(from candidate: UInt16) {
        guard listener == nil else {
            starting = false
            return
        }
        guard candidate <= LocalServer.lastPort else {
            starting = false
            DispatchQueue.main.async { [weak self] in
                self?.onFailure?("本机端口 47851–47860 均被占用，页面服务无法启动。请关闭占用端口的程序后重试。")
            }
            return
        }
        guard let nwPort = NWEndpoint.Port(rawValue: candidate) else {
            startLocked(from: candidate + 1)
            return
        }
        let parameters = NWParameters.tcp
        // 允许快速重启后复用同一端口，避免刚退出又启动时被系统占着。
        parameters.allowLocalEndpointReuse = true
        // 不走蓝牙/点对点，只走本机回环。
        parameters.includePeerToPeer = false
        // 关键：只绑回环地址，不暴露给局域网。
        // 端口必须写在 endpoint 里；再给 NWListener(using:on:) 传一次端口会与 endpoint 冲突，
        // 网络栈抛 "Local endpoint has port set, cannot override"，表现为 POSIX 22 (EINVAL)。
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort)
        do {
            let listener = try NWListener(using: parameters)
            // 监听器状态变化：ready=端口拿到了；failed=这个端口不行，换下一个。
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                // 端口真的空出来了：记下实际端口，并通知主线程加载网页。
                case .ready:
                    let actual = listener.port?.rawValue ?? candidate
                    self.listener = listener
                    self.starting = false
                    NSLog("江水课表 loopback 服务已启动：http://127.0.0.1:\(actual)/index.html")
                    DispatchQueue.main.async { [weak self] in
                        self?.port = actual
                        self?.onReady?(actual)
                    }
                // 这个端口不能用：清掉监听器，继续试下一个端口。
                case .failed(let error):
                    listener.stateUpdateHandler = nil
                    listener.cancel()
                    NSLog("江水课表 loopback 端口 \(candidate) 不可用：\(error)")
                    self.startLocked(from: candidate + 1)
                case .cancelled:
                    break
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.acceptLocked(connection)
            }
            listener.start(queue: queue)
        } catch {
            NSLog("江水课表 loopback 端口 \(candidate) 创建失败：\(error)")
            startLocked(from: candidate + 1)
        }
    }

    // MARK: - 连接处理（串行队列）

    /// 新连接进来：登记到连接表，开始收数据，并设置 15 秒超时。
    private func acceptLocked(_ connection: NWConnection) {
        let key = ObjectIdentifier(connection)
        connections[key] = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.discardLocked(key)
            default:
                break
            }
        }
        connection.start(queue: queue)
        receiveLocked(connection, key: key, buffer: Data())
        queue.asyncAfter(deadline: .now() + LocalServer.connectionTimeout) { [weak self] in
            guard let self = self, self.connections[key] != nil else { return }
            NSLog("江水课表 loopback 连接超时，主动关闭")
            self.closeLocked(key)
        }
    }

    /// 不断收数据，直到收齐请求头（两个空行）；超过 32KB 就回 431。
    private func receiveLocked(_ connection: NWConnection, key: ObjectIdentifier, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            guard self.connections[key] != nil else { return }
            var accumulated = buffer
            if let data = data { accumulated.append(data) }
            if error != nil {
                self.closeLocked(key)
                return
            }
            if accumulated.count > LocalServer.maxRequestBytes {
                self.sendLocked(connection, key: key, status: "431 Request Header Fields Too Large", body: LocalServer.body("请求头过大"))
                return
            }
            if LocalServer.headerEnd(in: accumulated) != nil {
                self.handleRequestLocked(accumulated, connection: connection, key: key)
                return
            }
            if isComplete {
                self.sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求格式无效"))
                return
            }
            self.receiveLocked(connection, key: key, buffer: accumulated)
        }
    }

    /// 解析 HTTP 请求行/方法/路径，再让 WebAssets 找文件并回包。
    private func handleRequestLocked(_ request: Data, connection: NWConnection, key: ObjectIdentifier) {
        guard let end = LocalServer.headerEnd(in: request) else {
            sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求格式无效"))
            return
        }
        let headBytes = Array(request.prefix(end))
        let head = String(decoding: headBytes, as: UTF8.self)
        let lines = head.split(whereSeparator: { $0 == "\r" || $0 == "\n" })
        guard let requestLine = lines.first else {
            sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求格式无效"))
            return
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求格式无效"))
            return
        }
        let method = String(parts[0]).uppercased()
        guard method == "GET" || method == "HEAD" else {
            let extra = "Allow: GET, HEAD\r\n"
            sendLocked(connection, key: key, status: "405 Method Not Allowed", body: LocalServer.body("只允许 GET/HEAD"), extraHeaders: extra)
            return
        }
        var target = String(parts[1])
        guard target.hasPrefix("/") else {
            sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求路径无效"))
            return
        }
        if let query = target.firstIndex(of: "?") { target = String(target[target.startIndex..<query]) }
        switch assets.lookup(requestPath: target) {
        case .found(let asset):
            sendLocked(connection, key: key, status: "200 OK", body: asset.data,
                       contentType: asset.mimeType, includeBody: method == "GET")
        case .notFound:
            sendLocked(connection, key: key, status: "404 Not Found", body: LocalServer.body("找不到资源"),
                       includeBody: method == "GET")
        case .rejected(let reason):
            NSLog("江水课表 loopback 拒绝请求：\(reason)")
            sendLocked(connection, key: key, status: "400 Bad Request", body: LocalServer.body("请求路径无效"),
                       includeBody: method == "GET")
        }
    }

    /// 统一拼 HTTP 响应头并发送；发完就关连接（Connection: close）。
    private func sendLocked(_ connection: NWConnection, key: ObjectIdentifier, status: String, body: Data,
                            contentType: String = "text/plain; charset=utf-8",
                            includeBody: Bool = true,
                            extraHeaders: String = "") {
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: \(contentType)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        // 每次都让浏览器重新取，避免网页更新后还拿旧缓存。
        head += "Cache-Control: no-store\r\n"
        // 回完这一条就断开，省得一直占着连接。
        head += "Connection: close\r\n"
        head += "X-Content-Type-Options: nosniff\r\n"
        head += extraHeaders
        head += "\r\n"
        var payload = Data(head.utf8)
        if includeBody { payload.append(body) }
        connection.send(content: payload, completion: .contentProcessed { [weak self] _ in
            self?.closeLocked(key)
        })
    }

    /// 主动关闭一个连接，并从连接表里删掉。
    private func closeLocked(_ key: ObjectIdentifier) {
        guard let connection = connections.removeValue(forKey: key) else { return }
        connection.stateUpdateHandler = nil
        connection.cancel()
    }

    /// 连接自己失败/取消时只清理表，不再重复 cancel。
    private func discardLocked(_ key: ObjectIdentifier) {
        if let connection = connections.removeValue(forKey: key) {
            connection.cancel()
        }
    }

    // MARK: - 工具

    /// 把中文错误文案转成 UTF-8 字节，作为响应正文。
    private static func body(_ text: String) -> Data {
        Data(text.utf8)
    }

    /// 在原始字节里找请求头结束的空行；返回结束位置（含空行），找不到返回 nil。
    /// 返回请求头结束位置（含空行）；先找 CRLFCRLF 再找 LFLF。
    static func headerEnd(in data: Data) -> Int? {
        let bytes = [UInt8](data)
        guard bytes.count >= 2 else { return nil }
        var index = 0
        while index + 1 < bytes.count {
            if index + 3 < bytes.count,
               bytes[index] == 0x0D, bytes[index + 1] == 0x0A,
               bytes[index + 2] == 0x0D, bytes[index + 3] == 0x0A {
                return index + 4
            }
            if bytes[index] == 0x0A, bytes[index + 1] == 0x0A {
                return index + 2
            }
            index += 1
        }
        return nil
    }
}
