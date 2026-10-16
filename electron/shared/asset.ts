/** asset:save 允许的图片扩展名（preload 参数校验与主进程写盘共用同一常量）。 */
export const ASSET_EXT_WHITELIST = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const

export type AssetExt = (typeof ASSET_EXT_WHITELIST)[number]

export function isAssetExt(ext: string): ext is AssetExt {
  return (ASSET_EXT_WHITELIST as readonly string[]).includes(ext)
}
