// 职责：ohosTest 测试套件入口，注册 P1 核心与仓库用例。
// 依赖方向：仅测试代码；不写业务逻辑。

import timetableCoreTest from './TimetableCore.test';
import stateRepositoryTest from './StateRepository.test';

export default function testsuite() {
  timetableCoreTest();
  stateRepositoryTest();
}
