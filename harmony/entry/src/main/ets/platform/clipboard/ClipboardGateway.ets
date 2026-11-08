// 职责：剪贴板能力网关，唯一允许访问 pasteboard 的产品文件。
// 依赖方向：platform -> Kit；pages/components 只能调用本网关。
// 阶段：P3；待官方文档确认 @kit.BasicServicesKit 的 pasteboard 导出名与 API 12 签名。
import { pasteboard } from '@kit.BasicServicesKit';

// 能力缺失时的降级码；具体错误由调用方按返回值处理。
export const CLIPBOARD_UNAVAILABLE: string = 'CLIPBOARD_UNAVAILABLE';

export async function copyText(text: string): Promise<boolean> {
  if (text.length === 0) { return false; }
  try {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    const board: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();
    await board.setData(data);
    return true;
  } catch (error) {
    return false;
  }
}

