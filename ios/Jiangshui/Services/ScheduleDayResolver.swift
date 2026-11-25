// 【这个文件干什么】把学校给的“第几周、星期几、第几节”算成某一天具体有哪些课、几点上课。
// 【什么时候会用到它】上课提醒、日历同步、桌面小组件数据、网页显示某天课表时。
// 【它和谁配合】StateStore 里的课表 JSON、ClassReminderService、CalendarService。
// 【小白提示】它像“课程表翻译官”：把规则（每周三第 3 节）翻译成“10 月 28 日 10:00 有课”。
// 【注意】所有日期都按北京时间算，避免手机时区变化导致课程跑到别的天。
import Foundation
/// One resolved course entry for a calendar day. Field names follow
/// ScheduleWidgetData.Item from the Android implementation.
/// 某一天的一节课（已经解析成具体日期和时间），字段名对齐 Android 的 ScheduleWidgetData.Item。
struct DayCourse {
    // date=yyyy-MM-dd；key=当天唯一标识；ruleId=来源规则；start/end=HH:mm。
    var date = ""
    var key = ""
    var ruleId = ""
    var name = ""
    var teacher = ""
    var room = ""
    var start = "00:00"
    var end = "00:00"
    var cancelled = false
    var localActivity = false
    var customCourse = false
    /// 转成网页/小组件用的 JSON；字段名必须和 Android 完全一致。
    func jsonObject() -> JSONObject {
        return ["date": date, "key": key, "ruleId": ruleId, "name": name, "teacher": teacher,
                "room": room, "startTime": start, "endTime": end,
                "cancelled": cancelled, "localActivity": localActivity, "customCourse": customCourse]
    }
}
/// Port of android/app/src/main/java/cn/local/tomorrow/ScheduleWidgetData.java.
/// Only the day-resolution surface is ported; widget rendering stays in web/.
/// 课表日期解析器：处理学期周次、调课、停课、节假日、自定义课程和晚自习。
enum ScheduleDayResolver {
    // 字段缺失时统一显示的破折号，和 Android 的占位符一致。
    static let dash = "—"
    // 固定北京时间；万一系统认不出时区名，就退回东八区偏移。
    static let zone: TimeZone = TimeZone(identifier: "Asia/Shanghai") ?? TimeZone(secondsFromGMT: 8 * 3600) ?? TimeZone.current
    /// 生成“yyyy-MM-dd”格式器；每次新建，避免多线程共用同一个 DateFormatter。
    static func dayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
    /// 把“2026-10-27”这样的日期字符串转成 Date；格式不对返回 nil。
    static func date(fromDay day: String) -> Date? { return dayFormatter().date(from: day) }
    /// 把“日期 + HH:mm”合成毫秒时间戳；时间不合法返回 nil。
    static func timestamp(day: String, time: String) -> Int64? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let normalized = normalizeClock(time)
        if normalized.isEmpty { return nil }
        guard let parsed = formatter.date(from: day + " " + normalized) else { return nil }
        return Int64((parsed.timeIntervalSince1970 * 1000).rounded())
    }
    /// 把 8:05、08:05、08:05:30 统一成 HH:mm:ss；小时/分钟越界返回空串。
    private static func normalizeClock(_ value: String) -> String {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return "" }
        guard hour >= 0, hour <= 23, minute >= 0, minute <= 59 else { return "" }
        var second = 0
        if parts.count >= 3 { second = Int(parts[2]) ?? 0 }
        return String(format: "%02d:%02d:%02d", hour, minute, max(0, min(59, second)))
    }
    /// 把 HH:mm 转成“从零点起第几分钟”，方便比较课程先后。
    static func minutes(_ value: String) -> Int {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return 0 }
        return hour * 60 + minute
    }
    /// 算两个日期相差几天；用于把日期换算成学期第几周。
    private static func daysBetween(_ start: String, _ end: String) -> Int {
        guard let from = date(fromDay: start), let to = date(fromDay: end) else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.dateComponents([.day], from: from, to: to).day ?? 0
    }
    /// 向下取整的除法（负数也向下），保证开学前的日期算出的周次和 Java 一致。
    private static func floorDiv(_ value: Int, _ divisor: Int) -> Int {
        if divisor == 0 { return 0 }
        let quotient = value / divisor
        if value % divisor != 0, (value < 0) != (divisor < 0) { return quotient - 1 }
        return quotient
    }
    /// 返回 Java 风格的星期：1=周一 … 7=周日（iOS 默认 1=周日，所以要换算）。
    private static func javaWeekday(_ day: String) -> Int {
        guard let date = date(fromDay: day) else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return (calendar.component(.weekday, from: date) + 5) % 7 + 1
    }
    /// 今天（北京时间）的 yyyy-MM-dd 字符串。
    static func today() -> String { return dayFormatter().string(from: Date()) }
    /// 在日期上加减天数；解析失败时原样返回，避免调用方拿到空值。
    static func addDays(_ day: String, _ amount: Int) -> String {
        guard let date = date(fromDay: day) else { return day }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        guard let moved = calendar.date(byAdding: .day, value: amount, to: date) else { return day }
        return dayFormatter().string(from: moved)
    }
    // MARK: - Resolution
    /// 算某一天最终要显示的课：基础周课表 + 调课 + 停课/补课 + 自定义课 + 晚自习。
    /// 然后套用课程设置、手动覆盖，去掉与活动时间冲突的条目，最后按开始时间排序。
    /// 这是整个文件的主入口，网页和提醒服务都调用它。
    static func effectiveDay(state: JSONObject, snapshot: JSONObject?, date: String) -> [DayCourse] {
        guard let snapshot = snapshot else { return [] }
        var list: [DayCourse] = []
        let holiday = isHoliday(state: state, date: date)
        let movedOut = hasOutgoingMap(maps: snapshot.optArray("remaps"), date: date)
            || hasOutgoingMap(maps: state.optArray("localMaps"), date: date)
        if holiday == false {
            if movedOut == false && contains(snapshot.optArray("closedDates"), date) == false {
                list.append(contentsOf: baseDay(snapshot: snapshot, date: date))
            }
            applyMaps(maps: snapshot.optArray("remaps"), snapshot: snapshot, date: date, list: &list, local: false)
            applyMaps(maps: state.optArray("localMaps"), snapshot: snapshot, date: date, list: &list, local: true)
            applyExceptions(exceptions: snapshot.optArray("exceptions"), date: date, list: &list)
            addCustomCourses(state: state, snapshot: snapshot, date: date, list: &list)
        }
        addEveningStudy(state: state, snapshot: snapshot, date: date, list: &list)
        applyCourseSettings(settings: state.optObject("courseSettings"), list: &list)
        let suppressed = holiday || movedOut || hasIncomingMap(maps: state.optArray("localMaps"), date: date)
        applyOverrides(overrides: state.optArray("overrides"), date: date, list: &list, suppressed: suppressed)
        removeActivityOverlap(list: &list)
        list = list.enumerated().sorted { left, right in
            if left.element.start == right.element.start { return left.offset < right.offset }
            return left.element.start < right.element.start
        }.map { $0.element }
        return list
    }
    /// 如果“活动”和普通课程时间重叠，隐藏活动，避免同一天显示两节冲突课。
    private static func removeActivityOverlap(list: inout [DayCourse]) {
        let snapshotList = list
        list = snapshotList.filter { item in
            if item.localActivity == false { return true }
            let overlaps = snapshotList.contains { other in
                if other.key == item.key && other.date == item.date { return false }
                if other.localActivity || other.cancelled { return false }
                return other.start < item.end && other.end > item.start
            }
            return overlaps == false
        }
    }
    /// 按学期开始日期和周次，找出“每周固定规则”里当天该上的课。
    private static func baseDay(snapshot: JSONObject, date: String) -> [DayCourse] {
        guard let semester = snapshot.optObject("semester") else { return [] }
        let startDate = semester.optString("startDate")
        let week = daysBetween(startDate, date) / 7 + 1
        if week < 1 || week > semester.optInt("weeks", 0) { return [] }
        let weekday = javaWeekday(date)
        var result: [DayCourse] = []
        for entry in snapshot.optArray("rules") ?? [] {
            guard let rule = JSONCompat.object(entry) else { continue }
            if rule.optInt("weekday") != weekday || containsInt(rule.optArray("weeks"), week) == false { continue }
            let ruleId = rule.optString("id")
            result.append(fromJson(row: rule, date: date, key: date + "/" + ruleId, ruleId: ruleId))
        }
        return result
    }
    /// 判断某天是否在寒暑假或法定节假日列表里；节假日不显示普通课程。
    private static func isHoliday(state: JSONObject, date: String) -> Bool {
        guard let settings = state.optObject("holidaySettings") else { return false }
        for name in ["winter", "summer"] {
            guard let range = settings.optObject(name) else { continue }
            if date.compare(range.optString("startDate")) != .orderedAscending
                && date.compare(range.optString("endDate")) != .orderedDescending { return true }
        }
        return holidayDay(settings: settings, date: date) != nil
    }
    /// 在节假日特殊设置里找当天条目（例如“这天不排晚自习”）。
    private static func holidayDay(settings: JSONObject?, date: String) -> JSONObject? {
        guard let settings = settings else { return nil }
        for entry in settings.optArray("days") ?? [] {
            guard let item = JSONCompat.object(entry) else { continue }
            if item.optString("date") == date { return item }
        }
        return nil
    }
    /// 是否有“调到这一天”的调课记录；有的话要抑制原来的手动覆盖。
    private static func hasIncomingMap(maps: [Any]?, date: String) -> Bool {
        for entry in maps ?? [] {
            guard let map = JSONCompat.object(entry) else { continue }
            if map.optString("date") == date { return true }
        }
        return false
    }
    /// 是否有“从这一天调走”的记录；有的话当天不再显示原课程。
    private static func hasOutgoingMap(maps: [Any]?, date: String) -> Bool {
        for entry in maps ?? [] {
            guard let map = JSONCompat.object(entry) else { continue }
            if map.optString("fromDate") == date && map.optString("date") != date { return true }
        }
        return false
    }
    /// 应用调课：把 fromDate 那天的课搬到 date；replace 模式会先清空当天课程。
    /// 本地调课（local=true）优先级更高，总是覆盖。
    private static func applyMaps(maps: [Any]?, snapshot: JSONObject, date: String, list: inout [DayCourse], local: Bool) {
        for entry in maps ?? [] {
            guard let map = JSONCompat.object(entry) else { continue }
            if map.optString("date") != date { continue }
            if local || map.optString("mode") == "replace" { list.removeAll() }
            let from = map.optString("fromDate")
            let mapId = map.optString("id")
            for item in baseDay(snapshot: snapshot, date: from) {
                var moved = item
                moved.date = date
                moved.key = date + "/" + moved.ruleId + "/map-" + mapId
                list.append(moved)
            }
        }
    }
    /// 应用单条课程的例外：cancel=true 删除该课，否则把 patch 里的字段改到课上。
    private static func applyExceptions(exceptions: [Any]?, date: String, list: inout [DayCourse]) {
        for entry in exceptions ?? [] {
            guard let exception = JSONCompat.object(entry) else { continue }
            if exception.optString("date") != date { continue }
            let ruleId = exception.optString("ruleId")
            var index = list.count - 1
            while index >= 0 {
                if list[index].ruleId == ruleId {
                    if exception.optBool("cancel") {
                        list.remove(at: index)
                    } else {
                        applyPatch(&list[index], patch: exception.optObject("patch"))
                    }
                }
                index -= 1
            }
        }
    }
    /// 加入用户自己添加的课程（每周重复或只上一次），并处理它们跟随调课移动。
    private static func addCustomCourses(state: JSONObject, snapshot: JSONObject, date: String, list: inout [DayCourse]) {
        guard let courses = state.optArray("customCourses") else { return }
        var custom = contains(snapshot.optArray("closedDates"), date)
            ? [] : regularCustomDay(courses: courses, snapshot: snapshot, date: date)
        let groups: [[Any]?] = [snapshot.optArray("remaps"), state.optArray("localMaps")]
        for groupIndex in 0..<groups.count {
            for entry in groups[groupIndex] ?? [] {
                guard let map = JSONCompat.object(entry) else { continue }
                if map.optString("date") != date { continue }
                if groupIndex == 1 || map.optString("mode") == "replace" { custom.removeAll() }
                let from = map.optString("fromDate")
                let mapId = map.optString("id")
                for item in regularCustomDay(courses: courses, snapshot: snapshot, date: from) {
                    var moved = item
                    moved.date = date
                    moved.key = date + "/" + moved.ruleId + "/map-" + mapId
                    custom.append(moved)
                }
            }
        }
        if hasOutgoingMap(maps: state.optArray("localMaps"), date: date) {
            custom = custom.filter { $0.key.contains("/map-") }
        }
        for entry in courses {
            guard let course = JSONCompat.object(entry) else { continue }
            if course.optString("mode") == "once" && course.optString("date") == date {
                var item = fromJson(row: course, date: date, key: date + "/" + course.optString("id"), ruleId: course.optString("id"))
                item.customCourse = true
                custom.append(item)
            }
        }
        list.append(contentsOf: custom)
    }
    /// 算“每周重复”的自定义课当天是否要上：检查学期、周次、单双周和星期几。
    private static func regularCustomDay(courses: [Any], snapshot: JSONObject, date: String) -> [DayCourse] {
        guard let semester = snapshot.optObject("semester") else { return [] }
        let startDate = semester.optString("startDate")
        let week = floorDiv(daysBetween(startDate, date), 7) + 1
        if week < 1 || week > semester.optInt("weeks", 0) { return [] }
        let weekday = javaWeekday(date)
        let semesterId = semester.optString("id")
        var result: [DayCourse] = []
        for entry in courses {
            guard let course = JSONCompat.object(entry) else { continue }
            if course.optString("mode") != "weekly" { continue }
            if course.optString("semesterId") != semesterId { continue }
            if course.optString("semesterStartDate") != startDate { continue }
            if containsInt(course.optArray("weekdays"), weekday) == false { continue }
            if week < course.optInt("startWeek") || week > course.optInt("endWeek") { continue }
            let pattern = course.optString("weekPattern", "every")
            if pattern == "odd" && week % 2 == 0 { continue }
            if pattern == "even" && week % 2 != 0 { continue }
            var item = fromJson(row: course, date: date, key: date + "/" + course.optString("id"), ruleId: course.optString("id"))
            item.customCourse = true
            result.append(item)
        }
        return result
    }
    /// 按学校设置给大一学生加“晚自习”；调课后的晚自习会跟着原上课日走。
    private static func addEveningStudy(state: JSONObject, snapshot: JSONObject, date: String, list: inout [DayCourse]) {
        guard let policy = snapshot.optObject("studyPolicy") else { return }
        if policy.optBool("userEnabled", false) == false || policy.optBool("enabled", false) == false { return }
        if isFirstYear(snapshot: snapshot, date: date) == false { return }
        guard let semester = snapshot.optObject("semester") else { return }
        let offset = daysBetween(semester.optString("startDate"), date)
        if offset < 0 || offset >= semester.optInt("weeks") * 7 { return }
        let exception = holidayDay(settings: state.optObject("holidaySettings"), date: date)
        if exception != nil && exception?.optBool("skipStudy") == true { return }
        var origin = date
        let weekday = javaWeekday(date)
        if weekday != 7 && (weekday < 1 || weekday > 4) {
            let groups: [[Any]?] = [snapshot.optArray("remaps"), state.optArray("localMaps")]
            for maps in groups {
                for entry in maps ?? [] {
                    guard let map = JSONCompat.object(entry) else { continue }
                    if map.optString("date") != date { continue }
                    let candidate = map.optString("fromDate")
                    let candidateDay = javaWeekday(candidate)
                    if candidateDay == 7 || (candidateDay >= 1 && candidateDay <= 4) {
                        origin = candidate
                        break
                    }
                }
                if origin != date { break }
            }
            if origin == date { return }
        }
        var evening = DayCourse()
        evening.date = date
        evening.ruleId = "local-evening-study"
        evening.key = date + "/local-evening-study"
        evening.name = "晚自习"
        evening.teacher = dash
        evening.room = dash
        evening.start = policy.optString("startTime", "19:00")
        evening.end = policy.optString("endTime", "20:30")
        evening.localActivity = true
        list.append(evening)
    }
    /// 应用用户对某门课的改名/换教室/改时间等设置；普通课按课名匹配，自定义课按 ID。
    private static func applyCourseSettings(settings: JSONObject?, list: inout [DayCourse]) {
        guard let settings = settings else { return }
        for index in 0..<list.count {
            let item = list[index]
            var key = normalize(item.name)
            if item.customCourse {
                key = "custom/" + item.ruleId
            } else if item.localActivity {
                key = "local-evening-study"
            }
            guard let setting = settings.optObject(key) else { continue }
            applyPatch(&list[index], patch: setting.optObject("patch"))
        }
    }
    /// 应用“手动覆盖”：能找到原课就改它；找不到时，如果当天没被停课/调走，就新建一条。
    private static func applyOverrides(overrides: [Any]?, date: String, list: inout [DayCourse], suppressed: Bool) {
        for entry in overrides ?? [] {
            guard let override = JSONCompat.object(entry) else { continue }
            if override.optString("date") != date { continue }
            let key = override.optString("key")
            var targetIndex: Int? = nil
            for index in 0..<list.count where list[index].key == key {
                targetIndex = index
                break
            }
            if targetIndex == nil && suppressed == false, let base = override.optObject("base") {
                if base.optBool("localActivity") || base.optBool("customCourse") { continue }
                var item = fromJson(row: base, date: date, key: key, ruleId: base.optString("ruleId"))
                applyPatch(&item, patch: override.optObject("patch"))
                list.append(item)
                continue
            }
            guard let index = targetIndex else { continue }
            applyPatch(&list[index], patch: override.optObject("patch"))
        }
    }
    /// 把一条课程 JSON 转成 DayCourse；缺字段时用“未命名课程/破折号/00:00”兜底。
    static func fromJson(row: JSONObject, date: String, key: String, ruleId: String) -> DayCourse {
        var item = DayCourse()
        item.date = date
        item.key = key
        item.ruleId = ruleId
        item.name = row.optString("name", "未命名课程")
        item.teacher = row.optString("teacher", dash)
        item.room = row.optString("room", dash)
        item.start = row.optString("startTime", "00:00")
        item.end = row.optString("endTime", "00:00")
        item.cancelled = row.optBool("cancelled", false)
        item.localActivity = row.optBool("localActivity", false)
        item.customCourse = row.optBool("customCourse", false)
        return item
    }
    /// 只覆盖 patch 里明确出现的字段，没出现的保持原值，避免把课程改空。
    private static func applyPatch(_ item: inout DayCourse, patch: JSONObject?) {
        guard let patch = patch else { return }
        if patch.hasKey("name") { item.name = patch.optString("name", item.name) }
        if patch.hasKey("teacher") { item.teacher = patch.optString("teacher", item.teacher) }
        if patch.hasKey("room") { item.room = patch.optString("room", item.room) }
        if patch.hasKey("startTime") { item.start = patch.optString("startTime", item.start) }
        if patch.hasKey("endTime") { item.end = patch.optString("endTime", item.end) }
        if patch.hasKey("cancelled") { item.cancelled = patch.optBool("cancelled", item.cancelled) }
    }
    /// 判断学生在该学年是否大一；晚自习只给大一安排。
    private static func isFirstYear(snapshot: JSONObject, date: String) -> Bool {
        var profile = snapshot.optObject("studentProfile")
        if profile == nil { profile = snapshot.optObject("studyPolicy")?.optObject("profile") }
        guard let profile = profile, let day = Self.date(fromDay: date) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let year = calendar.component(.year, from: day)
        let month = calendar.component(.month, from: day)
        let academicYear = month >= 9 ? year : year - 1
        if profile.hasKey("enrollmentYear") {
            return academicYear - profile.optInt("enrollmentYear") + 1 == 1
        }
        return profile.optInt("academicYear", -1) == academicYear && profile.optInt("grade", -1) == 1
    }
    /// 字符串数组里是否包含某个值（用于停课日期列表）。
    private static func contains(_ array: [Any]?, _ value: String) -> Bool {
        for entry in array ?? [] where JSONCompat.string(entry) == value { return true }
        return false
    }
    /// 整数数组里是否包含某个值（用于周次列表）。
    private static func containsInt(_ array: [Any]?, _ value: Int) -> Bool {
        for entry in array ?? [] where JSONCompat.int(entry) == value { return true }
        return false
    }
    /// 把课名去掉空格/标点并转小写，用于匹配“用户对某门课的设置”。
    static func normalize(_ value: String) -> String {
        let folded = value.precomposedStringWithCompatibilityMapping.lowercased()
        var result = ""
        for character in folded where character.isWhitespace || character.isLetter || character.isNumber {
            result.append(character)
        }
        return result
    }
}
