# export 目录（P0 占位）

职责：A（每周一页 PDF）/B（单张 PNG）/C（UTF-8 规则文本）导出的纯排版模型与平台实现入口。
约束：纯排版放 core/export，PDF/PNG Kit 适配放 platform/export；不引第三方 PDF 库。
阶段：P0 只保留目录说明，P5 再落地；PDF Kit API 12 能力待官方文档确认。
