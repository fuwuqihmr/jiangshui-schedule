// 【这个文件干什么】把「请假 + 续假」两次网络请求并成一次同步，并保证同一时间只跑一个；
//   销假则单独走一条请求。它负责超时、并发保护和结果合并，不直接解析字段。
// 【什么时候会用到它】网页点「同步假条」（请假+续假）或销假页刷新（销假）时。
// 【它和谁配合】LeaveRecordsService 负责真正发请求；SchoolProvider 把网页请求转给它。
// 【超时规则】整体最多 15 秒（Android 的 watchdog）；续假最多再等请假开始后的 12 秒，
//   来不及就取消续假并只记诊断，绝不拖慢或改坏请假结果。
// 【为什么续假失败不报错】web v1.5.0 没有 NEED_RENEW_SESSION 文案；续假失败只写日志，
//   请假记录照常返回。
import Foundation

// 请假同步协调器（P3，对齐 Android v1.5.0 MainActivity.java:867-938）。
//
// 对照点：
// - :867-882 mergeRenewRecords（请假在前、续假在后，按 id 去重）
// - :883-907 fetchLeaveRecordsWithRenew（并行续假，最多再等 12 秒，SKIPPED 诊断）
// - :909-916 finishLeaveSync（只回一次）
// - :918-938 beginLeaveRecordSync（并发回「正在同步假条，请稍候」，15 秒 watchdog）
//
// 与 Android 的差异：
// - Android 用两个单线程 executor + FutureTask；iOS 用 Swift 并发 Task + 一次性 continuation。
// - Android 结果通过 web handler 回投；iOS 直接作为 async 返回值，由 BridgeDispatcher 回包。
// - 15 秒超时后迟到的真实结果会被一次性闸门丢弃（Android 的 finishLeaveSync 同一语义）。
/// 请假同步协调器：串行化同步、15 秒看门狗、请假+续假合并、销假单跑。
final class LeaveSyncCoordinator {

    // 续假最多再等 12 秒（Android :895-896 的 12000L）；整体看门狗 15 秒（:926）。
    private static let renewWaitSeconds: TimeInterval = 12
    private static let watchdogSeconds: TimeInterval = 15

    private let records: LeaveRecordsService
    // 一把小锁保护 active：Android 用 synchronized(leaveSyncLock) 达到同样效果。
    private let lock = NSLock()
    private var active = false

    init(records: LeaveRecordsService) {
        self.records = records
    }

    // MARK: - 入口

    /// 同步请假记录（请假 278616 + 续假 278618）。已在同步时抛「正在同步假条，请稍候」。
    func leaveRecordSync() async throws -> JSONObject {
        try begin()
        defer { end() }
        return await withWatchdog(seconds: Self.watchdogSeconds) { [records] in
            return await Self.fetchLeaveWithRenew(records)
        }
    }

    /// 同步销假记录（278615）。与请假同步共用同一把并发锁和 15 秒看门狗。
    func cancelRecordSync() async throws -> JSONObject {
        try begin()
        defer { end() }
        return await withWatchdog(seconds: Self.watchdogSeconds) { [records] in
            return await records.fetchCancel()
        }
    }

    // MARK: - 并发闸门（MainActivity.beginLeaveRecordSync）

    /// 抢占同步权；已有同步在跑时回中文错误。
    private func begin() throws {
        lock.lock()
        if active {
            lock.unlock()
            throw BridgeFailure.message("正在同步假条，请稍候")
        }
        active = true
        lock.unlock()
    }

    /// 释放同步权；无论成功、失败还是超时都要走到这里。
    private func end() {
        lock.lock()
        active = false
        lock.unlock()
    }

    // MARK: - 15 秒看门狗

    /// 跑 operation，最多等 seconds 秒；超时回 {ok:false, code:"TIMEOUT"} 并取消网络任务。
    /// 用一次性闸门保证 continuation 只 resume 一次，迟到结果不会二次回包。
    private func withWatchdog(seconds: TimeInterval, operation: @escaping () async -> JSONObject) async -> JSONObject {
        return await withCheckedContinuation { continuation in
            let gate = ContinuationGate<JSONObject>(continuation)
            let task = Task {
                let value = await operation()
                gate.resume(value)
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + seconds) {
                task.cancel()
                gate.resume(["ok": false, "code": "TIMEOUT"])
            }
        }
    }

    // MARK: - 请假 + 续假（MainActivity.fetchLeaveRecordsWithRenew）

    /// 先启动续假任务，再等请假；请假失败就取消续假、原样返回请假错误。
    /// 请假成功后最多再等 12 秒续假；超时按 SKIPPED 记日志，合并时只保留请假记录。
    private static func fetchLeaveWithRenew(_ records: LeaveRecordsService) async -> JSONObject {
        let started = Date()
        let renewTask = Task { await records.fetchRenew() }
        let leave = await records.fetchLeave()
        guard isOK(leave) else {
            renewTask.cancel()
            return leave
        }
        let remaining = renewWaitSeconds - Date().timeIntervalSince(started)
        var renew: JSONObject?
        if remaining > 0.5 {
            renew = await waitForRenew(renewTask, timeout: remaining)
        } else {
            // 请假自己就快用完 12 秒预算：不再等续假，对齐 Android 的 SKIPPED 分支。
            renewTask.cancel()
        }
        let fallback = remaining > 0.5 ? "NO_RESULT" : "SKIPPED"
        if let code = failureCode(renew, fallback: fallback) {
            // 诊断行只含固定错误码，不带 cookie / uid / pageEnc 等会话值。
            SchoolDiagnosticLog.write("leave-renew-sync failed code=" + safeCode(code))
        }
        return mergeRenewRecords(leave: leave, renew: renew)
    }

    /// 等续假结果但不超过 timeout；超时就取消 Task 并返回 nil（对应 FutureTask.get + cancel）。
    private static func waitForRenew(_ task: Task<JSONObject, Never>, timeout: TimeInterval) async -> JSONObject? {
        return await withCheckedContinuation { continuation in
            let gate = ContinuationGate<JSONObject?>(continuation)
            let waiter = Task {
                let value = await task.value
                gate.resume(value)
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                task.cancel()
                waiter.cancel()
                gate.resume(nil)
            }
        }
    }

    // MARK: - 合并（MainActivity.mergeRenewRecords）

    /// 请假在前、续假在后，按 id 去重；续假失败/为空时原样返回请假结果。
    private static func mergeRenewRecords(leave: JSONObject, renew: JSONObject?) -> JSONObject {
        guard isOK(leave) else { return leave }
        guard let renew = renew, isOK(renew) else { return leave }
        var merged: [Any] = []
        var ids = Set<String>()
        appendLeaveRecords(from: leave["records"], to: &merged, ids: &ids)
        appendLeaveRecords(from: renew["records"], to: &merged, ids: &ids)
        var out: JSONObject = ["ok": true, "records": merged]
        if let fetchedAt = leave["fetchedAt"] { out["fetchedAt"] = fetchedAt }
        return out
    }

    /// 逐条追加；id 非空且已出现过就跳过（保留先到的请假记录）。
    private static func appendLeaveRecords(from source: Any?, to target: inout [Any], ids: inout Set<String>) {
        guard let list = source as? [Any] else { return }
        for element in list {
            guard let record = JSONCompat.object(element) else { continue }
            let identifier = record.optString("id")
            if identifier.isEmpty == false && ids.insert(identifier).inserted == false { continue }
            target.append(record)
        }
    }

    // MARK: - 诊断 / 工具

    /// 续假失败码；成功返回 nil。renew 为 nil 时用调用方给的兜底码（NO_RESULT / SKIPPED）。
    private static func failureCode(_ renew: JSONObject?, fallback: String) -> String? {
        guard let renew = renew else { return fallback }
        if isOK(renew) { return nil }
        let code = renew.optString("code")
        return code.isEmpty ? fallback : code
    }

    /// 错误码只允许 [A-Za-z0-9_]{1,40}，否则记 UNKNOWN，防止把奇怪字符写进日志。
    private static func safeCode(_ code: String) -> String {
        let pattern = "^[A-Za-z0-9_]{1,40}$"
        if code.range(of: pattern, options: .regularExpression) != nil { return code }
        return "UNKNOWN"
    }

    /// 判断结果是不是 {ok:true}；NSNumber 与 Swift Bool 都兼容。
    private static func isOK(_ object: JSONObject) -> Bool {
        if let flag = object["ok"] as? Bool { return flag }
        if let number = object["ok"] as? NSNumber { return number.boolValue }
        return false
    }
}

/// 一次性闸门：并发回来的两个结果里只有第一个能真正 resume continuation。
/// 15 秒超时与真实网络结果可能同时到达，没有它就会触发
/// 「SWIFT TASK CONTINUATION MISUSE: tried to resume its continuation more than once」。
private final class ContinuationGate<Value> {

    private let lock = NSLock()
    private var finished = false
    private let continuation: CheckedContinuation<Value, Never>

    init(_ continuation: CheckedContinuation<Value, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: Value) {
        lock.lock()
        if finished {
            lock.unlock()
            return
        }
        finished = true
        lock.unlock()
        continuation.resume(returning: value)
    }
}
