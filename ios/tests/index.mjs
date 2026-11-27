// 目录入口：让 node --test ios/tests/ 在 Node 24（Windows）下也能发现全部测试。
// Node 24 不会把目录参数递归展开，但会按 package.json main 解析该目录；
// 这里用 import 触发各测试文件注册用例。直接跑单个文件不受影响。
import './pbxproj.test.mjs';
import './actions.test.mjs';
import './permission.test.mjs';
import './plist-bridge.test.mjs';
import './baseline.test.mjs';
import './reminder-schedule.test.mjs';
import './live-activity.test.mjs';
import './exam-passthrough.test.mjs';
import './p0-fixes.test.mjs';
import './v152-sync.test.mjs';
import './full-suite.test.mjs';
