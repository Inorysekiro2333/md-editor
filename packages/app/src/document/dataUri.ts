/**
 * 未命名文档粘贴图片的内嵌 data URI 支持（裁定问题④）：
 * 文档未落盘时图片以 data URI 直接进 Buffer，不再强制「先保存」；
 * 保存/导出均天然支持 data URI，不做静默改写（R1 铁律）。
 */

const INLINE_DATA_URI_IMAGE_PATTERN = /!\[[^\]]*\]\(data:image\/[a-z0-9.+-]+;base64,[^)\s]+\)/i

export function toInlineDataUri(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

/** Buffer 中是否存在内嵌 data URI 图片（用于保存后的一次性状态栏提示）。 */
export function hasInlineDataUriImages(text: string): boolean {
  return INLINE_DATA_URI_IMAGE_PATTERN.test(text)
}
