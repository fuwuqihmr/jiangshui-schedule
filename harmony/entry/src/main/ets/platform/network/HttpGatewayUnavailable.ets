// 职责：HttpGateway 的降级实现（P4 79b，静态环境/无网络能力时使用）。
// 依赖方向：platform/network -> core/types；页面只依赖 HttpGateway 接口。
// 阶段：P4；所有请求立即失败为 NETWORK_UNAVAILABLE，UI 显示统一网络错误文案。
import type { HttpGateway, HttpRequest, HttpResponse } from './HttpGateway';
import { HttpError } from './HttpGateway';

export const NETWORK_UNAVAILABLE: string = 'NETWORK_UNAVAILABLE';

export class HttpGatewayUnavailable implements HttpGateway {
  async request(request: HttpRequest): Promise<HttpResponse> {
    throw new HttpError(NETWORK_UNAVAILABLE, 'http gateway unavailable');
  }
}
