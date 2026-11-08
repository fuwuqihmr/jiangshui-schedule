// 职责：今日课表行内假条徽标；状态由调用方传入，点击进入假条详情。
// 依赖方向：features/custom -> ArkUI 资源；不访问状态存储。
// 阶段：P4；资源键见 harmony/tools/resource-requests/harmony-custom.json。
@Component
export struct LeaveBadge {
  @Prop status: string = 'none';
  onOpen: () => void = () => {};

  build() {
    if (this.status === 'approved') {
      Text($r('app.string.custom_leave_badge_approved'))
        .fontSize(11)
        .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        .borderRadius(4)
        .onClick(() => { this.onOpen(); })
    } else if (this.status === 'pending') {
      Text($r('app.string.custom_leave_badge_pending'))
        .fontSize(11)
        .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        .borderRadius(4)
        .onClick(() => { this.onOpen(); })
    }
  }
}
