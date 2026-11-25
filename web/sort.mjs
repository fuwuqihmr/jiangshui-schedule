// 江水课表 · 排序语义唯一出口（1.5.0 决策 D-2 / task-65）
//
// 混合方案（作者 2026-11-18 拍板）：
// 1) 中文/混排自由文本（课程名、教师、教室）→ 显式 Intl.Collator('zh-Hans-CN') 拼音序。
//    不带 numeric：带数字后缀的课名保持现状（"大学英语10" 在 "大学英语2" 前），
//    自然数字序属额外行为变更，需单独拍板。显式 locale 保证不跟随设备/CI 默认 locale。
// 2) 日期、时间、技术键/id/编号等 ASCII 契约字段 → UTF-16 码元比较（a<b?-1:a>b?1:0），
//    与 Android Java String.compareTo、鸿蒙 ArkTS 字符串比较同口径，跨端逐位确定。
// 3) 无 ICU / 极老 WebView（无 Intl.Collator）→ zhCollator 为 null，cmpText 降级为码元序：
//    确定、不抛错；该降级分支只在 3 行自由文本排序上影响观感，真机未验证。
//
// 约定：web/ 下的页面与导出排序一律从这里取比较器，不得再调用无参
// String.prototype.localeCompare（tests/locale-order.test.mjs 有静态护栏）。
const collatorAvailable =
  typeof Intl === 'object' && Intl !== null && typeof Intl.Collator === 'function';

function createZhCollator() {
  if (!collatorAvailable) return null;
  try {
    return new Intl.Collator('zh-Hans-CN');
  } catch {
    // 引擎声明有 Intl.Collator 但构造失败（locale 数据不可用等）：降级码元序，不崩溃。
    return null;
  }
}

// 只在模块加载时创建一次；排序回调里禁止再 new Intl.Collator（性能 + 确定性）。
export const zhCollator = createZhCollator();

/** 技术键/日期/时间/id/编号：UTF-16 码元比较（与 Java String.compareTo 同口径）。 */
export function cmp(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 自由文本（课程名/教师/教室）：显式 zh-Hans-CN 拼音序；无 ICU 时降级码元序。 */
export function cmpText(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return zhCollator ? zhCollator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0;
}
