// 【这个文件干什么】网页（JavaScript）传来的 JSON 类型很松，Swift 类型很严，这里是两者之间的翻译。
// 【什么时候会用到它】桥接层每次收到网页参数、服务每次读字段时都会用。
// 【它和谁配合】ServiceProtocols.swift 的 JSONObject，以及所有 Services/ 下的服务。
// 【小白提示】JSON 里的 null 到 Swift 会变成 NSNull（“空值占位符”），这里统一当成“没有”。
// 【小白提示】网页可能把 true 写成 "true"、把数字写成 "123"，这里都帮忙转成真正的布尔/整数。
import Foundation

/// Shared, dependency-free helpers for reading the loosely typed JSON objects that
/// arrive from the WebView bridge. Field names mirror the Android JSONObject usage.
/// 一组不依赖第三方库的 JSON 取值小工具，名字里的 opt 是 optional（可选）的缩写。
enum JSONCompat {
    /// 尝试把任意值转成 JSON 对象；不是对象或为 null 时返回 nil（表示“没有”）。
    static func object(_ value: Any?) -> JSONObject? {
        guard let value = value, !(value is NSNull) else { return nil }
        return value as? JSONObject
    }

    /// 尝试转成 JSON 数组；不是数组或为 null 时返回 nil。
    static func array(_ value: Any?) -> [Any]? {
        guard let value = value, !(value is NSNull) else { return nil }
        return value as? [Any]
    }

    /// 尝试转成字符串；数字也允许转成文字，null 和其他类型返回 nil。
    static func string(_ value: Any?) -> String? {
        guard let value = value, !(value is NSNull) else { return nil }
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    /// 尝试转成布尔值；兼容 true/false、"true"/"false" 和 1/0 两种写法。
    static func bool(_ value: Any?) -> Bool? {
        guard let value = value, !(value is NSNull) else { return nil }
        if value is Bool, let flag = value as? Bool { return flag }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String {
            if text == "true" { return true }
            if text == "false" { return false }
            if text == "1" { return true }
            if text == "0" { return false }
        }
        return nil
    }

    /// 尝试转成整数；只接受“整整齐齐”的数，1.5 这种小数会返回 nil。
    static func int(_ value: Any?) -> Int? {
        guard let value = value, !(value is NSNull) else { return nil }
        if value is Bool { return nil }
        if let number = value as? NSNumber {
            let doubleValue = number.doubleValue
            if doubleValue.isFinite && doubleValue.rounded() == doubleValue { return number.intValue }
            return nil
        }
        if let text = value as? String { return Int(text) }
        return nil
    }

    /// 同 int，但用能装下更大数字的 Int64（64 位整数），用于毫秒时间戳。
    static func int64(_ value: Any?) -> Int64? {
        guard let value = value, !(value is NSNull) else { return nil }
        if value is Bool { return nil }
        if let number = value as? NSNumber {
            let doubleValue = number.doubleValue
            if doubleValue.isFinite && doubleValue.rounded() == doubleValue { return number.int64Value }
            return nil
        }
        if let text = value as? String { return Int64(text) }
        return nil
    }

    /// 把 Swift 值编码成 JSON 二进制；编码不了（例如含自定义对象）就返回 nil。
    static func jsonData(_ value: Any) -> Data? {
        guard JSONSerialization.isValidJSONObject(value) else { return nil }
        return try? JSONSerialization.data(withJSONObject: value, options: [])
    }

    /// 把 Swift 值编码成 JSON 文本，便于写日志或存进 UserDefaults。
    static func jsonString(_ value: Any) -> String? {
        guard let data = jsonData(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// 给 [String: Any] 这种 JSON 字典加的快捷取值方法，例如 state.optString("name")。
extension Dictionary where Key == String, Value == Any {
    // 下面这些方法都带默认值：字段不存在或类型不对时，返回调用者给的 fallback。
    func optObject(_ key: String) -> JSONObject? { return JSONCompat.object(self[key]) }

    func optArray(_ key: String) -> [Any]? { return JSONCompat.array(self[key]) }

    func optString(_ key: String, _ fallback: String = "") -> String {
        return JSONCompat.string(self[key]) ?? fallback
    }

    func optBool(_ key: String, _ fallback: Bool = false) -> Bool {
        return JSONCompat.bool(self[key]) ?? fallback
    }

    func optInt(_ key: String, _ fallback: Int = 0) -> Int {
        return JSONCompat.int(self[key]) ?? fallback
    }

    func optInt64(_ key: String, _ fallback: Int64 = 0) -> Int64 {
        return JSONCompat.int64(self[key]) ?? fallback
    }

    func hasKey(_ key: String) -> Bool {
        return self.keys.contains(key)
    }
}
