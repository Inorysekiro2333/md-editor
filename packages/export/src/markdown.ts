import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * TODO(Task 7): 用 buildStandaloneHtml 完整管线替换此占位——
 * 主题 CSS 内联 <style>、本地图片 base64 化、<title> 与 CSP meta 都由该函数统一产出。
 * 当前仅提供 Markdown→HTML 的最简转换（remark 同栈，大纲/索引同源），
 * 不允许任何远程脚本；remark-rehype 默认丢弃原始 HTML，script 标签不会透传。
 */
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify)

export async function markdownToHtml(buffer: string): Promise<string> {
  return String(await processor.process(buffer))
}
