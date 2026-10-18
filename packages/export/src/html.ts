import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import type { Element, Root } from 'hast'

export interface StandaloneHtmlOptions {
  /** 主题 CSS 变量表产出的完整 <style> 内容。 */
  themeCss: string
  inlineImages: boolean
  title: string
  /**
   * 渲染侧注入的本地图片读取回调：相对路径图片读文件后返回 data URL；
   * 返回 null 则保留原 src（文件缺失/越权/读取失败）。
   */
  inlineImage?: (src: string) => Promise<string | null>
}

/**
 * Markdown→HTML 用 Milkdown 同源 remark 管线（unified/remark-parse/rehype，
 * 大纲/索引同栈，不是新编辑内核）。remark-rehype 默认丢弃原始 HTML，
 * script 标签不会透传。
 */
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify)

/** 远程/协议/data/锚点图片一律不内联，只处理文件系统相对路径。 */
function isFilesystemRelativeSrc(src: string): boolean {
  if (src.length === 0) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false
  if (src.startsWith('//') || src.startsWith('#')) return false
  return true
}

async function inlineRelativeImages(
  doc: Root,
  inlineImage: (src: string) => Promise<string | null>,
): Promise<void> {
  const visit = async (node: Root | Element): Promise<void> => {
    for (const child of node.children) {
      if (child.type !== 'element') continue
      if (child.tagName === 'img' && typeof child.properties.src === 'string') {
        const src = child.properties.src
        if (isFilesystemRelativeSrc(src)) {
          const dataUrl = await inlineImage(src)
          if (dataUrl !== null) child.properties.src = dataUrl
        }
      }
      await visit(child)
    }
  }
  await visit(doc)
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * 组装自包含 HTML：主题 CSS 内联 <style>、CSP meta 禁脚本、<title>。
 * PDF 导出（printToPDF）与 HTML 导出共用此产出。
 */
export async function buildStandaloneHtml(
  buffer: string,
  opts: StandaloneHtmlOptions,
): Promise<string> {
  const hast = (await processor.run(processor.parse(buffer))) as Root
  if (opts.inlineImages) {
    if (typeof opts.inlineImage !== 'function') {
      throw new Error('inlineImages requires an inlineImage reader callback')
    }
    await inlineRelativeImages(hast, opts.inlineImage)
  }
  const body = String(processor.stringify(hast))
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src * data:; style-src \'unsafe-inline\'" />',
    `<title>${escapeHtml(opts.title)}</title>`,
    '<style>',
    opts.themeCss,
    '</style>',
    '</head>',
    `<body>${body}</body>`,
    '</html>',
  ].join('\n')
}
