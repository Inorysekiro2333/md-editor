import { en } from './en'
import { zhCN, type MessageKey } from './zh-CN'

export type Locale = 'zh-CN' | 'en'

// TODO(M5.x): 语言设置落地后由 AppSettings 驱动；当前渲染层默认 zh-CN。
export const DEFAULT_LOCALE: Locale = 'zh-CN'

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
}

/** 极简查词典函数：未知键在类型层禁止；未知 locale 回退 zh-CN。 */
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return DICTIONARIES[locale][key] ?? zhCN[key]
}

export { zhCN } from './zh-CN'
export { en } from './en'
export type { MessageKey } from './zh-CN'
