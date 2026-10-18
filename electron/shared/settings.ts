export const THEME_IDS = ['github-light', 'github-dark', 'paper-serif'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export interface AppSettings {
  themeId: ThemeId
  sidebarCollapsed: boolean
  export: {
    pdf: {
      printBackground: boolean
    }
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeId: 'github-light',
  sidebarCollapsed: false,
  export: { pdf: { printBackground: true } },
}

/**
 * 白名单 merge：只接受已知字段，未知字段丢弃，非法值回退默认。
 * 返回全新对象，不持有 raw 的任何引用。
 */
export function mergeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) {
    return structuredClone(DEFAULT_SETTINGS)
  }
  const source = raw as Record<string, unknown>
  const themeId = THEME_IDS.find((id) => id === source.themeId) ?? DEFAULT_SETTINGS.themeId
  const exportSection =
    typeof source.export === 'object' && source.export !== null
      ? (source.export as Record<string, unknown>)
      : {}
  const pdf =
    typeof exportSection.pdf === 'object' && exportSection.pdf !== null
      ? (exportSection.pdf as Record<string, unknown>)
      : {}
  const printBackground =
    typeof pdf.printBackground === 'boolean'
      ? pdf.printBackground
      : DEFAULT_SETTINGS.export.pdf.printBackground
  const sidebarCollapsed =
    typeof source.sidebarCollapsed === 'boolean'
      ? source.sidebarCollapsed
      : DEFAULT_SETTINGS.sidebarCollapsed
  return { themeId, sidebarCollapsed, export: { pdf: { printBackground } } }
}
