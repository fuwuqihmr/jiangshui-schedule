// 职责：脱敏日志骨架，禁止输出 cookie/TGC/token/表单 enc。
// 依赖方向：util 最底层；可被 data/platform/pages 使用，不反向依赖；脱敏规则统一走 util/Redactor。
// 阶段：P0 骨架；P1 起统一走本工具，禁止直接 console 敏感对象。
// 待确认：日志落盘与系统日志级别过滤策略。
import { redactLine } from './Redactor';
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static minLevel: LogLevel = LogLevel.INFO;

  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  static debug(message: string): void {
    Logger.write(LogLevel.DEBUG, message);
  }

  static info(message: string): void {
    Logger.write(LogLevel.INFO, message);
  }

  static warn(message: string): void {
    Logger.write(LogLevel.WARN, message);
  }

  static error(message: string): void {
    Logger.write(LogLevel.ERROR, message);
  }

  private static write(level: LogLevel, message: string): void {
    if (level < Logger.minLevel) {
      return;
    }
    const safe: string = Logger.redact(message);
    if (level === LogLevel.ERROR) {
      console.error(safe);
      return;
    }
    if (level === LogLevel.WARN) {
      console.warn(safe);
      return;
    }
    console.info(safe);
  }

  private static redact(message: string): string {
    return redactLine(message);
  }
}
