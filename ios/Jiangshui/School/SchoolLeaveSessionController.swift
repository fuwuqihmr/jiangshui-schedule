// 【这个文件干什么】管「打开请假网页」这一路的顺序：先确认有没有登录，没登录先过统一身份认证，
//   登录完可能被弹回首页而不是请假表单，于是再引导一次，直到请假表单真正出现。
// 【为什么不能只打开一次】学校登录会重定向好几次，回来时未必是你想去的那一页；表单还可能提示
//   「请重新登录」。所以它像门卫，按顺序盯住五道「关卡」逐个放行，不是一锤子买卖。
// 【什么时候会用到它】点「请假 / 销假 / 续假」打开请假页面时；关掉页面就结束。
// 【它和谁配合】SchoolProvider 创建它并转交网页事件；它通过 SchoolWebViewHost 加载网址、显示
//   顶部提示，通过 WKHTTPCookieStore（浏览器的 cookie 仓库）查「现在算不算登录了」。
// 【注意】所有方法都必须在主线程调用——网页回调和界面更新本来都在主线程。
import Foundation
import WebKit

// 请假 WebView 的状态机（对应 MainActivity.java:336-404）。
//
// 为什么不能只把深链 load 一次：学校统一身份认证完成后可能落回 xgxt 首页而不是请假表单；
// 请假表单自身还会在 UID 失效时显示「请重新登录」。Android 用 warmupPending /
// targetRequested / officeLoaded / reloginTried / retargetTried 五个标志处理这些回跳，
// 本文件逐条移植，避免 iOS 停在「请假主界面但点不进去」。
//
// 线程模型：所有方法必须在主线程调用（provider / WKWebView 回调都在主线程）。
// 本机 Windows 无 Xcode/swiftc，未编译验证。
/// 请假 WebView 的「流程管家」。五个布尔标志就是五道门，按顺序问：
/// 预热页到了吗 / 目标页要了吗 / 请假表单出来了吗 / 重登试过了吗 / 重定向试过了吗。
final class SchoolLeaveSessionController {

    // 下面这些字段就是这个管家的全部记忆：
    // host 是承载网页的界面（弱引用，界面没了这里也不会硬拽着它不放）；
    // targetURL 是最终想去的请假表单地址，warmupURL 是先去「暖场」的登录入口地址；
    // 五个布尔 = 五道关卡；isOpen 表示这一轮流程还活着；
    // generation 是「批次号」：页面一换就加一，旧批次回来的回调会被丢掉，避免串台。
    private weak var host: SchoolWebViewHost?
    private var targetURL: String?
    private var warmupURL: String?

    private var warmupPending = false
    private var targetRequested = false
    private var officeLoaded = false
    private var reloginTried = false
    private var retargetTried = false

    private var isOpen = false
    private var generation = 0
    private var slowTimer: DispatchWorkItem?
    private var retryTimer: DispatchWorkItem?

    // Android openWebApp：先复位 5 个标志，再决定加载 warmup 还是目标深链。
    /// 打开请假页面。url 是最终目标（请假表单），warmupUrl 是先去登录的入口（可以为空），
    /// host 是显示网页的界面。会先把五道关卡全部复位，再决定「先去登录」还是「直接冲目标」。
    func open(url: String, warmupUrl: String?, host: SchoolWebViewHost) {
        assert(Thread.isMainThread)
        self.host = host
        self.targetURL = url
        self.warmupURL = warmupUrl
        targetRequested = false
        reloginTried = false
        warmupPending = false
        officeLoaded = false
        retargetTried = false
        isOpen = true
        generation += 1
        cancelSlowTimer()
        cancelRetryTimer()
        host.updateNote("正在加载学校登录页面…")
        let token = generation
        hasXgxtSession { [weak self] hasSession in
            guard let self = self, self.isCurrent(token) else { return }
            if hasSession == false, let warmup = self.warmupURL {
                self.warmupPending = true
                self.host?.updateNote("正在加载学校登录页面…")
                self.startSlowTimer()
                self.host?.load(urlString: warmup)
            } else {
                self.loadTarget()
            }
        }
    }

    // Android hideWebApp / destroyWebApp：停止计时并把状态清空，WebView 本身由 provider 关闭。
    /// 关闭流程：停掉所有计时器、把记忆清空（网页本身由上层负责关掉）。
    func close() {
        assert(Thread.isMainThread)
        isOpen = false
        generation += 1
        cancelSlowTimer()
        cancelRetryTimer()
        host = nil
        targetURL = nil
        warmupURL = nil
        warmupPending = false
        targetRequested = false
        officeLoaded = false
        reloginTried = false
        retargetTried = false
    }

    // 由 SchoolWebViewHost.onPageFinished 转交（主线程）。
    /// 网页每加载完一页就叫这里一次（由 SchoolWebViewHost 转交），是整个流程的「中枢」：
    /// 落在统一身份认证页 → 只提示请登录；落在请假系统的页面 → 按五道关卡决定下一步怎么走。
    func pageFinished(_ rawURL: String) {
        assert(Thread.isMainThread)
        guard isOpen, let host = host else { return }
        cancelSlowTimer()
        if SchoolURLPolicy.isCasUrl(rawURL) {
            host.updateNote("请在学校页面完成统一身份认证登录（本应用不保存密码）")
            return
        }
        guard SchoolURLPolicy.isXgxtUrl(rawURL) else { return }
        let token = generation

        if warmupPending {
            hasXgxtSession { [weak self] hasSession in
                guard let self = self, self.isCurrent(token) else { return }
                self.warmupPending = false
                if hasSession {
                    if self.targetRequested == false { self.loadTarget() }
                    return
                }
                // Cookie 写入可能滞后于 onPageFinished：Android 在这里 450ms 后复检一次 UID。
                self.host?.updateNote("登录未完成，请在学校页面完成登录")
                self.scheduleWarmupRecheck(token: token)
            }
            return
        }

        if targetRequested == false {
            // Android: if(!webAppTargetRequested){if(hasXgxtSession())loadWebAppTarget();return;}
            hasXgxtSession { [weak self] hasSession in
                guard let self = self, self.isCurrent(token) else { return }
                if hasSession { self.loadTarget() }
            }
            return
        }

        if SchoolURLPolicy.isOfficePath(rawURL) {
            officeLoaded = true
            host.updateNote("请在学校页面完成请假、销假或续假操作")
            checkReloginPrompt(token: token)
            return
        }

        // UID 存在但已失效：CAS 登录后可能落回 xgxt 首页而不是 office 表单。
        // 只自动重载目标一次，避免循环；之后保留页面让用户手动刷新。
        if officeLoaded == false && retargetTried == false && targetURL != nil {
            retargetTried = true
            host.updateNote("正在打开请假页面…")
            startSlowTimer()
            if let target = targetURL { host.load(urlString: target) }
            return
        }
        host.updateNote("请在学校页面完成请假、销假或续假操作")
    }

    // Android onReceivedError 的请假页文案。
    /// 请假页加载失败（断网、域名解析不了）时只更新顶部提示，不打断整个流程。
    func navigationFailed() {
        assert(Thread.isMainThread)
        cancelSlowTimer()
        host?.updateNote("学校页面暂时无法连接，请检查网络后点刷新")
    }

    // Android onRenderProcessGone：状态复位，页面已由 WebKit 回收。
    /// 网页的渲染进程被系统回收了（手机内存紧张时会发生）——相当于页面被强杀，只能复位重来。
    func processTerminated() {
        assert(Thread.isMainThread)
        let oldHost = host
        close()
        oldHost?.updateNote("请假页面已关闭，请重新打开")
    }

    // MARK: - 目标 / 复检

    /// 加载最终目标（请假表单），记下「目标页已经请求过」，并启动「加载较慢」的提示计时器。
    private func loadTarget() {
        guard isOpen, let host = host, let target = targetURL else { return }
        targetRequested = true
        warmupPending = false
        host.updateNote("正在打开请假页面…")
        startSlowTimer()
        host.load(urlString: target)
    }

    /// 0.45 秒后再查一次有没有登录成功。为什么要等这一下：cookie 写进浏览器的时机可能比
    /// 「页面加载完」稍晚，立刻查会误判成没登录（Android 也是这么复检的）。
    private func scheduleWarmupRecheck(token: Int) {
        cancelRetryTimer()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.isCurrent(token) else { return }
            // 对齐 Android: webApp != view || targetRequested || warmupPending || targetUrl == null || !visible 就放弃。
            guard self.host?.isUserVisible == true,
                  self.targetRequested == false,
                  self.warmupPending == false,
                  self.targetURL != nil else { return }
            self.hasXgxtSession { [weak self] hasSession in
                guard let self = self, self.isCurrent(token) else { return }
                if hasSession { self.loadTarget() }
            }
        }
        retryTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: work)
    }

    // Android 在 office 页面注入脚本检查 body.innerText 是否含「请重新登录」。
    /// 请假表单页里如果写着「请重新登录」，说明登录其实已经失效：自动回登录入口重来一次；
    /// 但只自动试一次，之后把页面留给用户手动刷新，避免无限转圈。
    private func checkReloginPrompt(token: Int) {
        guard let host = host else { return }
        let script = "(document.body&&document.body.innerText||'').includes('请重新登录')"
        host.evaluate(script: script) { [weak self] value, error in
            guard let self = self, self.isCurrent(token), error == nil else { return }
            guard self.host === host, self.reloginTried == false else { return }
            guard Self.isTrue(value) else { return }
            self.reloginTried = true
            self.host?.updateNote("学校会话已过期，正在重新登录…")
            if let warmup = self.warmupURL {
                self.warmupPending = true
                self.targetRequested = false
                self.officeLoaded = false
                self.startSlowTimer()
                self.host?.load(urlString: warmup)
            } else {
                self.host?.updateNote("学校会话已过期，请点刷新重新登录")
            }
        }
    }

    /// 把网页脚本返回的值判断成真假：网页可能回 true/false，也可能回数字或字符串 "true"。
    private static func isTrue(_ value: Any?) -> Bool {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String { return text.lowercased() == "true" }
        return false
    }

    // MARK: - Cookie / 计时器

    // Android hasXgxtSession：CookieManager.getCookie(XGXT_ORIGIN) 里是否存在名为 UID 的段。
    // iOS 用 WKHTTPCookieStore 异步取全量 cookie，再按 host 过滤。
    /// 查「现在算不算已登录」：看浏览器里有没有学校发的 UID 这张 cookie（相当于门禁卡）。
    /// cookie 只能在主线程读，读完统一回主线程再回调，保证调用方在熟悉的线程上继续跑。
    private func hasXgxtSession(_ completion: @escaping (Bool) -> Void) {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            var found = false
            let host = "xgxt.juwp.edu.cn"
            for cookie in cookies {
                // Android 的 CookieManager.getCookie(XGXT_ORIGIN) 会带上父域 cookie
                // （例如 .juwp.edu.cn），这里按 RFC 6265 做 domain-match，而不是只认
                // xgxt 本身，否则学校把 UID 设在父域时会被误判为未登录。
                var domain = cookie.domain.lowercased()
                while domain.hasPrefix(".") {
                    domain.removeFirst()
                }
                let matchesDomain = !domain.isEmpty
                    && (host == domain || host.hasSuffix("." + domain))
                if matchesDomain && cookie.name == "UID" {
                    found = true
                    break
                }
            }
            DispatchQueue.main.async { completion(found) }
        }
    }

    /// 判断回调回来的是不是「当前这一轮」：流程关了、或已经换了一轮（批次号变了），
    /// 就当成过期消息丢掉，避免旧请求把新页面的状态搅乱。
    private func isCurrent(_ token: Int) -> Bool {
        return isOpen && generation == token
    }

    /// 「慢速提示」闹钟：30 秒还没加载好，就在顶部提示「加载较慢，可刷新或返回」。
    private func startSlowTimer() {
        cancelSlowTimer()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.isOpen, self.host?.isUserVisible == true else { return }
            self.host?.updateNote("加载较慢，可刷新或返回")
        }
        slowTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30.0, execute: work)
    }

    /// 取消慢速提示闹钟（页面切换、流程结束时要及时取消）。
    private func cancelSlowTimer() {
        slowTimer?.cancel()
        slowTimer = nil
    }

    /// 取消「登录之后再查一次」的复检闹钟。
    private func cancelRetryTimer() {
        retryTimer?.cancel()
        retryTimer = nil
    }
}
