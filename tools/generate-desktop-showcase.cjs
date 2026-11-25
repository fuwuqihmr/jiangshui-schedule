const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputRoot = path.resolve(process.env.TOMORROW_OUTPUT || path.resolve(root, '../../outputs'));
const screenshotRoot = path.join(outputRoot, '电脑版功能截图-1.0.1');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const showcaseDay = '2026-10-05';

async function writeScreenshot(page, name, options = {}) {
  await page.screenshot({ path: path.join(screenshotRoot, name), fullPage: true, scale: 'device', animations: 'disabled', ...options });
}
async function setDate(page, value) {
  await page.evaluate(date => { const input = document.querySelector('#day-date'); input.value = date; input.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await page.locator('.hero').waitFor();
}
async function closeModal(page) {
  if (await page.locator('.modal').count()) { await page.locator('.modal [data-action="close"]').first().click(); await page.locator('.modal').waitFor({ state: 'detached' }); }
}

(async () => {
  await fs.rm(screenshotRoot, { recursive: true, force: true });
  await fs.mkdir(screenshotRoot, { recursive: true });
  const { createState, effectiveDay, saveOverride } = await import('../web/core.mjs');
  const { withStudyPolicy } = await import('../web/study.mjs');
  const base = JSON.parse(await fs.readFile(path.join(root, 'web/data/baseline.json'), 'utf8'));
  const calendar = JSON.parse(await fs.readFile(path.join(root, 'web/data/holidays.json'), 'utf8'));
  const snapshot = withStudyPolicy(base, { enrollmentYear: 2026 }, calendar);
  let fixture = createState(snapshot); fixture.theme = 'blue';
  const sourceCourse = effectiveDay(fixture.snapshot, showcaseDay, [], [], fixture.courseSettings)[0];
  if (sourceCourse) {
    fixture = saveOverride(fixture, sourceCourse, { room: '固定 A301' }, '2026-10-10T10:00:00+08:00');
    fixture.events = [{ id: 'showcase-change-1', key: sourceCourse.key, date: showcaseDay, name: sourceCourse.name,
      before: { ...sourceCourse }, after: { ...sourceCourse, room: '固定 A301' }, fields: ['room'], type: '换教室', source: 'sample',
      read: false, notifiedAt: null, detectedAt: '2026-10-10T10:00:00+08:00' }];
  }
  fixture.lastSuccess = '2026-10-10T09:58:00+08:00';
  const app = await electron.launch({ args: ['--force-device-scale-factor=2', root], env: { ...process.env, TOMORROW_TEST: '1' } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.setPosition(-5000, 0); window.showInactive(); }));
    const page = await app.firstWindow(); await page.setViewportSize({ width: 1920, height: 1200 });
    await page.locator('#consent-check').waitFor(); await writeScreenshot(page, '01-首次启动-用户协议.png');
    await page.locator('#consent-check').check(); await page.getByRole('button', { name: '同意并使用', exact: true }).click(); await page.locator('.hero').waitFor();
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')); await fs.writeFile(path.join(userData, 'state.json'), JSON.stringify(fixture)); await page.reload(); await page.locator('.hero').waitFor();
    await setDate(page, showcaseDay); await writeScreenshot(page, '02-今日课表-首页.png');
    await page.locator('.nav [data-tab="week"]').click(); await page.selectOption('#week-select', '6'); await page.locator('.week-grid').waitFor(); await writeScreenshot(page, '03-完整课表-周视图.png');
    await page.locator('#search').fill('高数'); await sleep(250); await writeScreenshot(page, '04-完整课表-模糊搜索.png'); await page.locator('#search').fill('');
    await page.locator('.nav [data-tab="tomorrow"]').click(); await setDate(page, showcaseDay); await page.locator('.course-card:not(.vacant)').first().click(); await page.locator('.modal').waitFor(); await writeScreenshot(page, '05-课程详情.png');
    await page.getByRole('button', { name: '修改这一天', exact: true }).click(); await page.locator('#edit-form').waitFor(); await writeScreenshot(page, '06-单日课程修改.png'); await closeModal(page);
    await page.getByRole('button', { name: '调休安排', exact: true }).click(); await page.locator('#remap-form').waitFor(); await writeScreenshot(page, '07-调休安排.png');
    await page.locator('#remap-form input[name="date"]').fill('2026-10-10'); await page.locator('#remap-form input[name="fromDate"]').fill('2026-10-09'); await page.getByRole('button', { name: '保存调休', exact: true }).click(); await page.locator('.modal').waitFor({ state: 'detached' });
    await page.locator('.nav [data-tab="week"]').click(); await page.selectOption('#week-select', '6'); await page.locator('.week-grid').waitFor(); await writeScreenshot(page, '07b-调休后课表-灰色空位.png');
    await page.locator('.nav [data-tab="tomorrow"]').click(); await setDate(page, showcaseDay);
    await page.getByRole('button', { name: '晚自习设置', exact: true }).click(); await page.locator('#study-settings-form').waitFor(); await writeScreenshot(page, '08-晚自习设置.png'); await closeModal(page);
    await page.getByRole('button', { name: '课程统一设置', exact: true }).click(); await page.locator('.settings-list').waitFor(); await writeScreenshot(page, '09-课程统一设置列表.png');
    const firstCourseButton = page.locator('[data-action="course-settings"]').first();
    if (await firstCourseButton.count()) { await firstCourseButton.click(); await page.locator('#course-settings-form').waitFor(); await writeScreenshot(page, '10-同名课程属性设置.png'); await closeModal(page); } else await closeModal(page);
    await page.locator('.nav [data-tab="changes"]').click(); await page.locator('.event-list').waitFor(); await writeScreenshot(page, '11-变更记录.png');
    await page.locator('.nav [data-tab="settings"]').click(); await page.locator('.settings-grid').waitFor(); await writeScreenshot(page, '12-设置与数据.png');
    await page.locator('.nav [data-tab="tomorrow"]').click(); await setDate(page, showcaseDay); await page.getByRole('button', { name: '外观主题', exact: true }).click(); await page.locator('.theme-options').waitFor(); await writeScreenshot(page, '13-外观主题选择.png');
    await page.locator('[data-action="set-theme"][data-theme="dark"]').click(); await page.locator('.modal [data-action="close"]').first().click(); await page.locator('.hero').waitFor(); await writeScreenshot(page, '14-黑色主题.png');
    await page.getByRole('button', { name: '外观主题', exact: true }).first().click(); await page.locator('[data-action="set-theme"][data-theme="blue"]').click(); await closeModal(page);
    await page.locator('.nav [data-tab="settings"]').click(); await page.locator('.settings-grid').waitFor(); await page.getByRole('button', { name: '查看用户协议与 Cookie 授权', exact: true }).click(); await page.locator('.agreement-review').waitFor(); await writeScreenshot(page, '15-用户协议与隐私说明.png'); await closeModal(page);
    await app.evaluate(({ ipcMain }) => { ipcMain.__showcaseFail = false; ipcMain.removeHandler('app:request'); ipcMain.handle('app:request', async (_event, action) => { if (action === 'saveState') return { ok: true }; if (['sync', 'capture', 'openSchool'].includes(action)) { await new Promise(resolve => setTimeout(resolve, 1600)); if (ipcMain.__showcaseFail) return { message: '演示：学校响应超时，保留上次课表' }; return { semesterId: '2026-2027-1', totalWeeks: 25, rows: [{ kc_mc: '合成测试课', jg0101mc: '测试教师', sktime: '周二第3、4节{第5-16周}(全部)', skddmc: '测试教室', jx0404id: 'plan-test', kch: 'test' }] }; } return { ok: true }; }); });
    await page.getByRole('button', { name: '登录学校门户', exact: true }).click(); await page.getByText('正在检查学校会话…', { exact: true }).waitFor(); await writeScreenshot(page, '16-读取课表-进行中.png'); await page.getByRole('button', { name: '暂不采用', exact: true }).waitFor(); await page.getByRole('button', { name: '暂不采用', exact: true }).click(); await closeModal(page);
    await app.evaluate(({ ipcMain }) => { ipcMain.__showcaseFail = true; }); await page.getByRole('button', { name: '读取学校课表', exact: true }).click(); await page.getByText('未能确认最新课表', { exact: true }).waitFor(); await writeScreenshot(page, '16b-读取失败-保留上次课表.png');
    await page.locator('.nav [data-tab="tomorrow"]').click(); await setDate(page, '2026-10-10'); await writeScreenshot(page, '17-最终江水蓝首页.png');
    const manifest = ['01-首次启动-用户协议.png', '02-今日课表-首页.png', '03-完整课表-周视图.png', '04-完整课表-模糊搜索.png', '05-课程详情.png', '06-单日课程修改.png', '07-调休安排.png', '07b-调休后课表-灰色空位.png', '08-晚自习设置.png', '09-课程统一设置列表.png', '10-同名课程属性设置.png', '11-变更记录.png', '12-设置与数据.png', '13-外观主题选择.png', '14-黑色主题.png', '15-用户协议与隐私说明.png', '16-读取课表-进行中.png', '16b-读取失败-保留上次课表.png', '17-最终江水蓝首页.png'];
    await fs.writeFile(path.join(screenshotRoot, '截图清单.txt'), manifest.map((name, index) => `${String(index + 1).padStart(2, '0')}. ${name}`).join('\n') + '\n', 'utf8');
    console.log(`Desktop showcase screenshots written to ${screenshotRoot}`);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });