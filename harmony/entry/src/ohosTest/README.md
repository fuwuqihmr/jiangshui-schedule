# ohosTest

P1 规格要求的 Hypium 用例位于：

- `ets/test/TimetableCore.test.ets`：单双周、markLeave 半开区间/cancel、localMaps 原日 moved。
- `ets/test/StateRepository.test.ets`：save→load、坏 JSON、坏 snapshot 降级、写失败回滚。
- `ets/test/List.test.ets`：套件注册。

**本机没有 Harmony SDK，这些 ohosTest 暂不可运行**，仅作规格与后续设备/模拟器接入用。
当前可执行的等价验收在 `harmony/tools/run-core-tests.mjs`（Node 类型剥离 + 纯逻辑测试）。

不要在此放生产逻辑或业务 fixture；fixtures 在顶层 `fixtures/`。
