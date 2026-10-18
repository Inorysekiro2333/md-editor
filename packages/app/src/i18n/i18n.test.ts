import { describe, expect, it } from 'vitest'
import { t, zhCN, en, DEFAULT_LOCALE } from './index'

describe('i18n', () => {
  it('returns zh-CN strings by default', () => {
    expect(t('statusSaved')).toBe('已保存')
    expect(t('statusSaved', 'zh-CN')).toBe('已保存')
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('returns en strings for the en locale', () => {
    expect(t('statusSaved', 'en')).toBe('Saved')
  })

  it('has identical key sets across zh-CN and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
  })

  it('never returns empty strings in either dictionary', () => {
    for (const value of Object.values(zhCN)) expect(value.length).toBeGreaterThan(0)
    for (const value of Object.values(en)) expect(value.length).toBeGreaterThan(0)
  })
})
