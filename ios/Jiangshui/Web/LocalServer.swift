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
///
/// 生命周期状态在主线程处理；监听器 ready 后仍可能 failed/cancelled/waiting，
/// 这些情况都会先清 listener 和 port，再自动重启。
final class LocalServer {
    // 固定端口区间让网页 origin 不变，localStorage 才不会丢；10 个都占用就报错。
    static let firstPort: UInt16 = 47851
    static let lastPort: UInt16 = 47860
    // 请求头最大 32KB；超过就回 431，防止超大请求把内存撑爆。
    static let maxRequestBytes = 32 * 1024
    // 单个连接最多等 15 秒；超时主动关掉，避免连接越积越多。
    static let connectionTimeout: TimeInterval = 15
    static let waitingTimeout: TimeInterval = 1.5 // waiting 超时后换端口

    /// 主线程回调：服务就绪，参数是实际绑定端口。
    var onReady: ((UInt16) -> Void)?
    /// 主线程回调：10 个端口都失败时的中文提示。
    var onFailure: ((String) -> Void)?
    /// 主线程回调：ready 后监听器失效（port 已清空）；本类会自动重启。
    var onInterrupted: (() -> Void)?

    private let assets: WebAssets // 把请求路径变成 App 包里的真实文件
    // 所有网络事件都在这个串行队列里排队，避免多线程同时改连接表。
    private let queue = DispatchQueue(label: "cn.local.tomorrow.loopback-server")
    // NWListener（监听端口、等浏览器来连的“门卫”）；仅主线程读写。
    private var listener: NWListener?
    // 活连接表；连接对象不能直接做 key，用 ObjectIdentifier；仅 queue 读写。
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var starting = false // 防止连点“重试”重复启动
    private var shouldRun = false // stop()/全部端口失败时置 false
    // 旧回调拿着旧 token 一律丢弃。
    private var generation: UInt64 = 0
    // waiting 超时的待执行任务；换端口/ready/failed 时取消。
    private var waitingTimer: DispatchWorkItem?

    private(set) var port: UInt16? // 仅主线程读写；nil 表示没有可用监听
    init(assets: WebAssets) {
        self.assets = assets
    }

    var isRunning: Bool { return shouldRun }

    var isHealthy: Bool { return shouldRun && listener != nil && port != nil }

    // MARK: - 生命周期（主线程调用）

    /// 主线程调用：按 47851→47860 顺序试；重复调用是安全的。
    func start() {
        guard !shouldRun, !starting, listener == nil else { return }
        shouldRun = true
        starting = true
        generation &+= 1
        startLocked(from: LocalServer.firstPort)
    }

    /// 主线程：关监听/连接并清 port；可重入、可重复调用。
    func stop() {
        shouldRun = false
        starting = false
        generation &+= 1
        cancelWaitingLocked()
        if let listener = listener {
            listener.stateUpdateHandler = nil
            listener.cancel()
            self.listener = nil
        }
        port = nil
        queue.async { [weak self] in
            guard let self = self else { return }
            let alive = Array(self.connections.values)
            self.connections.removeAll()
            for connection in alive {
                connection.stateUpdateHandler = nil
                connection.cancel()
            }
        }
    }

    // MARK: - 端口尝试（主线程）

    /// 主线程：从 candidate 开始逐个端口尝试，直到成功或试完。
    private func startLocked(from candidate: UInt16) {
        guard shouldRun else { return }
        cancelWaitingLocked()
        guard listener == nil else { return }
        guard candidate <= LocalServer.lastPort else {
            failLocked()
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
            self.listener = listener
            generation &+= 1
            let token = generation
            // 监听器状态变化：ready=端口拿到了；failed/cancelled/waiting 都要收拾干净再决定下一步。
            listener.stateUpdateHandler = { [weak self, weak listener] state in
                DispatchQueue.main.async {
                    guard let self = self, let listener = listener else { return }
                    guard self.generation == token, self.listener === listener else {
                        listener.cancel()
                        return
                    }
                    self.handleStateLocked(state, listener: listener, candidate: candidate, token: token)
                }
            }
            listener.newConnectionHandler = { [weak self, weak listener] connection in
                // 先回主线程确认这个 listener 仍是当前监听器，避免 stop 之后还接受旧连接。
                DispatchQueue.main.async {
                    guard let self = self, let listener = listener, self.listener === listener else {
                        connection.cancel()
                        return
                    }
                    self.queue.async { [weak self] in
                        self?.acceptLocked(connection)
                    }
                }
            }
            listener.start(queue: queue)
        } catch {
            NSLog("江水课表 loopback 端口 \(candidate) 创建失败：\(error)")
            // 创建失败没有 listener，继续下一个端口；starting 保持 true 直到成功/全部失败。
            startLocked(from: candidate + 1)
        }
    }

    /// 主线程：处理当前监听器的一次状态变化。
    private func handleStateLocked(_ state: NWListener.State, listener: NWListener, candidate: UInt16, token: UInt64) {
        switch state {
        case .ready:
            cancelWaitingLocked()
            guard shouldRun else {
                dropListenerLocked(listener: listener)
                return
            }
            let actual = listener.port?.rawValue ?? candidate
            starting = false
            port = actual
            NSLog("江水课表 loopback 服务已启动：http://127.0.0.1:\(actual)/index.html")
            onReady?(actual)
        case .waiting(let error):
            NSLog("江水课表 loopback 端口 \(candidate) 等待中：\(error)")
            scheduleWaitingTimeoutLocked(listener: listener, candidate: candidate, token: token)
        case .failed(let error):
            NSLog("江水课表 loopback 端口 \(candidate) 不可用：\(error)")
            recoverLocked(listener: listener, candidate: candidate)
        case .cancelled:
            if shouldRun {
                NSLog("江水课表 loopback 端口 \(candidate) 被取消，准备重启")
                recoverLocked(listener: listener, candidate: candidate)
            } else {
                dropListenerLocked(listener: listener)
            }
        default:
            break
        }
    }

    /// waiting 超过 1.5 秒还没 ready：清掉这个监听器，换下一个端口。
    private func scheduleWaitingTimeoutLocked(listener: NWListener, candidate: UInt16, token: UInt64) {
        cancelWaitingLocked()
        let work = DispatchWorkItem { [weak self, weak listener] in
            guard let self = self, let listener = listener else { return }
            guard self.generation == token, self.listener === listener else { return }
            self.waitingTimer = nil
            NSLog("江水课表 loopback 端口 \(candidate) waiting 超时，换端口")
            let hadPort = self.port != nil
            self.dropListenerLocked(listener: listener)
            if hadPort { self.onInterrupted?() }
            guard self.shouldRun else { return }
            self.startLocked(from: hadPort ? LocalServer.firstPort : candidate + 1)
        }
        waitingTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + LocalServer.waitingTimeout, execute: work)
    }

    /// 监听器失效：先清 listener/port，再尝试重启。
    /// ready 之后的失效从 47851 重新试（保持 origin 稳定）；启动阶段的失效从下一个端口继续。
    private func recoverLocked(listener: NWListener, candidate: UInt16) {
        let hadPort = port != nil
        dropListenerLocked(listener: listener)
        if hadPort { onInterrupted?() }
        guard shouldRun else { return }
        startLocked(from: hadPort ? LocalServer.firstPort : candidate + 1)
    }

    /// 清掉一个监听器及其 port，并让所有旧回调失效；不负责重启，也不负责回调 onInterrupted。
    private func dropListenerLocked(listener: NWListener) {
        cancelWaitingLocked()
        guard self.listener === listener else {
            listener.stateUpdateHandler = nil
            listener.cancel()
            return
        }
        listener.stateUpdateHandler = nil
        listener.cancel()
        self.listener = nil
        port = nil
        generation &+= 1
    }

    /// 10 个端口都失败：停止并只回调一次失败。
    private func failLocked() {
        guard shouldRun else { return }
        shouldRun = false
        starting = false
        cancelWaitingLocked()
        listener = nil
        port = nil
        onFailure?("本机端口 47851–47860 均被占用，页面服务无法启动。请关闭占用端口的程序后重试。")
    }

    /// 取消 waiting 超时任务；可重复调用。
    private func cancelWaitingLocked() {
        waitingTimer?.cancel()
        waitingTimer = nil
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
