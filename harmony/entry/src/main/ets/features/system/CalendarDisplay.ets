// 职责：日历能力/授权状态的展示归一（纯逻辑，无 Kit 依赖）。
// 依赖方向：features -> 无；供 SystemIntegrationService 与权限卡共用，确保同页只认一个来源。
// 规则：能力不可用或授权未知一律返回 unavailable；只有明确 granted/denied/prompt/unverified 才透传。

export function calendarDisplayState(available: boolean, permission: string): string {
  if (!available) {
    return 'unavailable';
  }
  if (permission === 'granted') {
    return 'granted';
  }
  if (permission === 'denied') {
    return 'denied';
  }
  if (permission === 'prompt') {
    return 'prompt';
  }
  if (permission === 'unverified') {
    return 'unverified';
  }
  return 'unavailable';
}
