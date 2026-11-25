// 职责：唯一 UIAbility，只负责窗口创建与主题/状态初始化占位，随后加载 Index。
// 依赖方向：entryability -> pages；不 import core/data/platform 的具体实现。
// 阶段：P0 骨架；P3 起在此注入 StateRepository/PermissionService。
// Kit 白名单：仅 @kit.AbilityKit / @kit.ArkUI；不引 BasicServicesKit。
// 待确认：UIAbility 生命周期与 windowStage.loadContent 的 API 12 签名。
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { Logger } from '../util/Logger';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Logger.info('EntryAbility created');
    this.initializeThemePlaceholder();
    this.initializeStatePlaceholder();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code !== 0) {
        Logger.error('loadContent failed: ' + err.message);
        return;
      }
      Logger.info('loadContent finished');
    });
  }

  private initializeThemePlaceholder(): void {
    // P3：读取 AppStorage/Preferences 中的 ThemeId，再绑定主题资源。
  }

  private initializeStatePlaceholder(): void {
    // P1：构造 StateRepository 并 load()，加载结果通过 AppStorage 注入页面。
  }
}
