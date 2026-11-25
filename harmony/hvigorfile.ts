// 职责：鸿蒙工程根 hvigor 构建入口，只导出官方 appTasks。
// 依赖方向：无业务代码依赖；构建插件由 DevEco/命令行工具提供。
// 阶段：P0 骨架；未编译，仅静态骨架。
// 待确认：hvigor 插件版本与官方模板是否随 command-line-tools 提供。
export { appTasks } from '@ohos/hvigor-ohos-plugin';
