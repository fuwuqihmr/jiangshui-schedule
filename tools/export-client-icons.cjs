const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputRoot = path.resolve(process.env.TOMORROW_OUTPUT || path.resolve(root, '../../outputs'));
const out = path.join(outputRoot, '客户端图标导出-1.0.1');
const svgDir = path.join(out, 'SVG-可编辑');
const pngDir = path.join(out, 'PNG-透明');
const previewDir = path.join(out, '预览');

const icons = {
  today: { label: '今日课表 · 日历', file: '01-今日课表-日历', path: 'M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2zM8 13h3v3H8' },
  week: { label: '完整课表 · 周网格', file: '02-完整课表-网格', path: 'M3 3h18v18H3zM3 9h18M9 3v18M15 3v18M3 15h18' },
  changes: { label: '变更记录 · 历史', file: '03-变更记录-历史', path: 'M18 8a7 7 0 1 0 1 8M18 3v5h-5M12 8v5l3 2' },
  settings: { label: '设置与数据 · 齿轮', file: '04-设置与数据-齿轮', path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 9l-2 1v4l2 1 2 3v2h4l2-2 2 2h4v-3l2-2 2-1v-4l-2-1-2-3V3h-4l-2 2-2-2H6v3z' },
  refresh: { label: '检查更新 · 刷新', file: '05-检查更新-刷新', path: 'M20 6v5h-5M4 18v-5h5M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3' },
  left: { label: '上一项 · 左箭头', file: '06-上一项-左箭头', path: 'M15 5l-7 7 7 7' },
  right: { label: '下一项 · 右箭头', file: '07-下一项-右箭头', path: 'M9 5l7 7-7 7' },
  pin: { label: '地点 · 图钉', file: '08-地点-图钉', path: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0-0-6' },
  person: { label: '教师 · 人物', file: '09-教师-人物', path: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0-0-8M4 21v-3a8 8 0 0 1 16 0v3' },
  check: { label: '完成 · 勾选', file: '10-完成-勾选', path: 'M5 12l4 4L19 6' },
  close: { label: '关闭 · 叉号', file: '11-关闭-叉号', path: 'M5 5l14 14M19 5L5 19' },
  bell: { label: '通知 · 铃铛', file: '12-通知-铃铛', path: 'M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3zM9 21h6' },
  arrow: { label: '前往 · 箭头', file: '13-前往-箭头', path: 'M4 12h16M14 6l6 6-6 6' },
  moon: { label: '无课 · 月亮', file: '14-无课-月亮', path: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12' },
  file: { label: '文件 · 文档', file: '15-文件-文档', path: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h6' },
};
const bottomKeys = ['today', 'week', 'changes', 'settings'];
const colors = { active: '#287fb0', inactive: '#7b8798' };
const svgFor = (item, color = colors.active) => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24" fill="none" role="img" aria-label="${item.label}"><title>${item.label}</title><path d="${item.path}" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>\n`;
const svgForCurrentColor = item => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24" fill="none" role="img" aria-label="${item.label}" color="#287fb0"><title>${item.label}</title><path d="${item.path}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>\n`;

(async () => {
  await fs.rm(out, { recursive: true, force: true });
  await Promise.all([fs.mkdir(svgDir, { recursive: true }), fs.mkdir(pngDir, { recursive: true }), fs.mkdir(previewDir, { recursive: true })]);
  const rows = [];
  for (const [key, item] of Object.entries(icons)) {
    await fs.writeFile(path.join(svgDir, `${item.file}.svg`), svgForCurrentColor(item), 'utf8');
    await fs.writeFile(path.join(svgDir, `${item.file}-蓝色.svg`), svgFor(item, colors.active), 'utf8');
    await fs.writeFile(path.join(svgDir, `${item.file}-灰色.svg`), svgFor(item, colors.inactive), 'utf8');
    rows.push({ key, label: item.label, source: `${item.file}.svg`, path: item.path });
  }
  await fs.writeFile(path.join(out, 'icon-paths.json'), JSON.stringify({ viewBox: '0 0 24 24', strokeWidth: 1.7, linecap: 'round', linejoin: 'round', bottomBar: bottomKeys, icons: rows }, null, 2) + '\n', 'utf8');
  await fs.copyFile(path.join(root, 'assets', 'app-icon.png'), path.join(out, '江水课表-水宝宝图标-原始.png'));
  await fs.copyFile(path.join(root, 'assets', 'app-icon.ico'), path.join(out, '江水课表-水宝宝图标-原始.ico'));

  const app = await electron.launch({ args: [root], env: { ...process.env, TOMORROW_TEST: '1' } });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.setPosition(-5000, 0); window.showInactive(); }));
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1024, height: 1024 });
  for (const [key, item] of Object.entries(icons)) {
    for (const [variant, color] of Object.entries(colors)) {
      await page.setContent(`<html><body style="margin:0;background:transparent;width:1024px;height:1024px">${svgFor(item, color)}</body></html>`);
      await page.screenshot({ path: path.join(pngDir, `${item.file}-${variant}.png`), omitBackground: true });
    }
  }
  const previewItems = bottomKeys.map((key, index) => `<div class="cell"><div class="icon active">${svgFor(icons[key], colors.active)}</div><div class="icon inactive">${svgFor(icons[key], colors.inactive)}</div><strong>${index + 1}. ${icons[key].label}</strong><small>${icons[key].file}.svg</small></div>`).join('');
  await page.setContent(`<html><body style="margin:0;background:#f6f7f9;font-family:Arial,'Microsoft YaHei',sans-serif"><main style="width:1600px;height:900px;padding:64px;box-sizing:border-box"><h1 style="font-size:36px;color:#293343;margin:0 0 16px">江水课表 · 手机底部栏四个图标</h1><p style="font-size:20px;color:#707b8d;margin:0 0 42px">左：当前选中蓝色　右：未选中灰色　SVG 与透明 PNG 已分别导出</p><section style="display:grid;grid-template-columns:repeat(4,1fr);gap:26px">${previewItems}</section></main><style>.cell{background:#fff;border:1px solid #e1e5ea;border-radius:18px;padding:28px;display:flex;flex-direction:column;align-items:center;gap:12px}.icon{width:220px;height:220px;border-radius:22px;display:grid;place-items:center}.icon.active{background:#edf5fa}.icon.inactive{background:#f4f6f8}.icon svg{width:120px;height:120px}.cell strong{color:#293343;font-size:21px;text-align:center}.cell small{color:#7b8798;font-size:15px;text-align:center}</style></body></html>`);
  await page.screenshot({ path: path.join(previewDir, '手机底部栏四图标-蓝灰对照.png'), fullPage: true });
  await app.close();

  const readme = [
    '# 江水课表客户端图标导出',
    '',
    '导出时间：2026-10-11',
    '',
    '这套文件从当前客户端源码导出，重点是手机底部栏四个图标：',
    '',
    '1. 今日课表 · 日历',
    '2. 完整课表 · 网格',
    '3. 变更记录 · 历史',
    '4. 设置与数据 · 齿轮',
    '',
    '## 文件说明',
    '',
    '- SVG-可编辑：可直接在 Figma、Illustrator、Sketch、Inkscape 中修改。默认 SVG 使用 currentColor，蓝色和灰色版本也一并提供。',
    '- PNG-透明：1024×1024 透明背景，分为 active 蓝色和 inactive 灰色两种状态。',
    '- 预览：四个底部栏图标的蓝灰对照总览。',
    '- 江水课表-水宝宝图标-原始.png / .ico：当前客户端使用的原始应用图标。',
    '- icon-paths.json：图标名称、路径、ViewBox、线宽和底部栏顺序，方便批量修改。',
    '',
    '## 当前绘制规范',
    '',
    '- ViewBox：0 0 24 24',
    '- 描边：无填充，线宽 1.7',
    '- 端点和拐角：round',
    '- 选中颜色：#287fb0',
    '- 未选中颜色：#7b8798',
    '',
    '修改时建议优先编辑 SVG；PNG 是按当前线宽渲染出的交付预览。',
    '',
  ].join('\n');  await fs.writeFile(path.join(out, '图标说明.md'), readme, 'utf8');
  console.log(`Exported ${Object.keys(icons).length} icons to ${out}`);
})().catch(error => { console.error(error); process.exitCode = 1; });