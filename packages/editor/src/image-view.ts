import { SchemaReady, nodeViewCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as PMNode } from '@milkdown/prose/model'
import type { EditorView as PMView, NodeView, NodeViewConstructor } from '@milkdown/prose/view'

/**
 * 相对路径图片（如 `assets/xxx.png`）的显示解析回调：Buffer/序列化保持原样
 * （R1 铁律），仅在 NodeView 渲染层把相对 src 换成可加载的 data URI。
 * 返回 null（无路径/读取失败/非文件系统 src）时保留原始 src。
 */
export type ResolveImageSrc = (src: string) => Promise<string | null> | string | null

class ImageNodeView implements NodeView {
  dom: HTMLImageElement
  private node: PMNode
  private currentAttrSrc: string
  private resolveToken = 0

  constructor(
    node: PMNode,
    _view: PMView,
    _getPos: () => number | undefined,
    private readonly resolve: ResolveImageSrc,
    private readonly cache: Map<string, Promise<string | null>>,
  ) {
    this.node = node
    this.currentAttrSrc = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    this.dom = document.createElement('img')
    // 先渲染原始 src（data URI/远程 URL 原样可用），相对路径由异步解析替换。
    this.dom.src = this.currentAttrSrc
    this.applyAttrs()
    void this.applyResolvedSrc()
  }

  update(node: PMNode): boolean {
    if (node.type.name !== this.node.type.name) return false
    this.node = node
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    if (src !== this.currentAttrSrc) {
      this.currentAttrSrc = src
      // 先回退到原始 src，避免上一张图的 data URI 在解析期间残影。
      this.dom.src = src
      this.cache.delete(src)
    }
    this.applyAttrs()
    void this.applyResolvedSrc()
    return true
  }

  ignoreMutation(): boolean {
    // 叶子节点无内容 DOM；属性变化一律走 update()。
    return true
  }

  private applyAttrs(): void {
    const alt = typeof this.node.attrs.alt === 'string' ? this.node.attrs.alt : ''
    const title = typeof this.node.attrs.title === 'string' ? this.node.attrs.title : ''
    if (this.dom.alt !== alt) this.dom.alt = alt
    if (title) {
      this.dom.title = title
    } else {
      this.dom.removeAttribute('title')
    }
  }

  private async applyResolvedSrc(): Promise<void> {
    const token = ++this.resolveToken
    const src = this.currentAttrSrc
    let resolved: string | null
    try {
      let pending = this.cache.get(src)
      if (pending === undefined) {
        pending = Promise.resolve(this.resolve(src)).catch(() => null)
        this.cache.set(src, pending)
      }
      resolved = await pending
    } catch {
      resolved = null
    }
    if (token !== this.resolveToken || this.currentAttrSrc !== src) return
    // 解析失败/非相对路径：恢复原始 src，保证 data URI、远程 URL 等正常显示。
    this.dom.src = resolved ?? src
  }
}

/**
 * 注册 image NodeView：仅为相对路径图片做显示层 src 解析（如未命名文档的
 * data URI 与远程 URL 原样透传），不影响 schema/序列化与 Buffer。
 */
export function createImageView(resolve: ResolveImageSrc): MilkdownPlugin {
  return (ctx) => async () => {
    await ctx.wait(SchemaReady)
    // commonmark 固定注册 image 节点；resolve 结果按 src 缓存避免重复读盘。
    const cache = new Map<string, Promise<string | null>>()
    const constructor: NodeViewConstructor = (node, view, getPos) =>
      new ImageNodeView(node, view, getPos, resolve, cache)
    const id = 'image'
    ctx.update(nodeViewCtx, (ps) => [...ps, [id, constructor] as [string, NodeViewConstructor]])
    return () => {
      ctx.update(nodeViewCtx, (ps) => ps.filter(([key]) => key !== id))
    }
  }
}
