// 反馈通道（问卷星）：配置校验、入口面板与 App 内拉起。
// 真正的页面加载在原生侧完成（Android: FeedbackActivity；桌面端暂不提供），
// 网页层只负责展示入口和调用桥，不直接打开外部地址。

import {call} from './bridge.mjs';

const DEFAULT_TITLE = '意见反馈';
const DEFAULT_INTRO = '遇到问题或有建议？填一份问卷，帮我们把课表做得更稳。';
const MAX_TITLE = 40;
const MAX_INTRO = 200;
const MAX_URL = 2048;
// 问卷星常用域名；只接受 https，且必须是完整子域，避免 wjx.cn.evil.example 这类伪装。
const FEEDBACK_DOMAINS = ['wjx.cn', 'wjx.top', 'sojump.com', 'wjx.com'];

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

// 与 Android FeedbackConfig.isAllowed 保持同一口径：https、无凭据、默认端口、问卷星域名。
export function isFeedbackUrl(value) {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL) return false;
  if (/[\s\\]/.test(raw)) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (!FEEDBACK_DOMAINS.some(domain => hostMatches(host, domain))) return false;
  return url.pathname.length > 1 && url.pathname.startsWith('/');
}

function cleanText(value, limit, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, limit) : fallback;
}

export function normalizeFeedbackInfo(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const url = typeof source.url === 'string' ? source.url.trim() : '';
  const enabled = source.enabled !== false && isFeedbackUrl(url);
  return {
    enabled,
    title: cleanText(source.title, MAX_TITLE, DEFAULT_TITLE),
    intro: cleanText(source.intro, MAX_INTRO, DEFAULT_INTRO),
    url
  };
}

export function disabledFeedback() {
  return {enabled: false, title: DEFAULT_TITLE, intro: DEFAULT_INTRO, url: ''};
}

// 只有 Android 原生壳实现了 feedbackInfo/openFeedback；浏览器与桌面端隐藏入口。
export async function loadFeedbackInfo() {
  if (!globalThis.Android) return disabledFeedback();
  try {
    return normalizeFeedbackInfo(await call('feedbackInfo'));
  } catch {
    return disabledFeedback();
  }
}

export async function openFeedback(info) {
  if (!info?.enabled || !isFeedbackUrl(info.url)) throw Error('反馈通道尚未配置');
  await call('openFeedback');
}

export function feedbackPanel(info) {
  if (!info?.enabled) return '';
  return `<section class="panel" id="feedback-panel"><h2>${escapeHtml(info.title)}</h2><p>${escapeHtml(info.intro)}</p><div class="actions"><button class="button primary" data-action="feedback">打开反馈问卷</button></div><p class="disabled-note">问卷由问卷星提供，在应用内打开；请勿在问卷中填写学校密码。</p></section>`;
}
