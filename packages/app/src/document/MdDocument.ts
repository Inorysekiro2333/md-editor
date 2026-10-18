import { encodeUtf8Base64 } from '../base64'
import type { WriteCredential } from '../bridge'

export interface MdDocumentInit {
  id: string
  path: string | null
  text: string
  originalBytesBase64: string
  /** ADR-7 崩溃恢复：以快照文本 + dirty 初始构造。 */
  dirty?: boolean
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface TextRange {
  from: number
  to: number
}

/**
 * Markdown Buffer 的唯一事实源。
 * PM Doc / CodeMirror Doc 都是它的投影，任何修改最终必须落到 text。
 */
export class MdDocument {
  private currentText: string
  private originalBytes: string
  private dirty = false
  private lastCredential: WriteCredential | null = null

  constructor(private readonly init: MdDocumentInit) {
    this.currentText = init.text
    this.originalBytes = init.originalBytesBase64
    this.dirty = init.dirty ?? false
  }

  get id(): string {
    return this.init.id
  }

  get path(): string | null {
    return this.init.path
  }

  get eol(): 'lf' | 'crlf' {
    return this.init.eol
  }

  get hasBom(): boolean {
    return this.init.hasBom
  }

  get text(): string {
    return this.currentText
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get credential(): WriteCredential | null {
    return this.lastCredential
  }

  /** 渲染模式键入防抖收敛：PM Doc -> Markdown -> Buffer。 */
  applyEditorMarkdown(markdown: string): void {
    if (markdown === this.currentText) return
    this.currentText = markdown
    this.dirty = true
  }

  /** 查找替换等操作直接改 Buffer。 */
  replaceText(range: TextRange, replacement: string): void {
    const next =
      this.currentText.slice(0, range.from) + replacement + this.currentText.slice(range.to)
    if (next === this.currentText) return
    this.currentText = next
    this.dirty = true
  }

  /**
   * 未编辑时返回 null —— 调用方必须据此跳过写盘，
   * 这正是「零编辑保存 = 不写盘」这条铁律的实现方式。
   *
   * 编辑后保存时按打开时记录的元信息还原包装（architecture.md §3.3）：
   * - EOL：`init.eol === 'crlf'` 时把未被 `\r` 前置的 `\n` 转为 `\r\n`；
   *   `'lf'` 时保持字节不动（不把既有 `\r\n` 强转回 `\n`）。
   * - BOM：`init.hasBom` 时在内容前补回 U+FEFF。
   */
  bytesForSave(): string | null {
    if (!this.dirty) return null
    return encodeUtf8Base64(this.serializedText())
  }

  /**
   * 另存为：用户显式选择落盘路径，即使零编辑（新建未命名笔记）也必须产出字节。
   * 与 bytesForSave 使用同一套 EOL / BOM 还原包装。
   */
  bytesForSaveAs(): string {
    return encodeUtf8Base64(this.serializedText())
  }

  /** 另存为成功后派生同 id、新 path 的实例；Buffer 内容不变，回到干净态。 */
  withPath(path: string): MdDocument {
    return new MdDocument({
      id: this.init.id,
      path,
      text: this.currentText,
      originalBytesBase64: encodeUtf8Base64(this.currentText),
      eol: this.init.eol,
      hasBom: this.init.hasBom,
    })
  }

  private serializedText(): string {
    const text =
      this.init.eol === 'crlf' ? this.currentText.replace(/(?<!\r)\n/g, '\r\n') : this.currentText
    return this.init.hasBom ? `\uFEFF${text}` : text
  }

  markSaved(credential: WriteCredential | null = null): void {
    if (this.dirty) {
      this.originalBytes = encodeUtf8Base64(this.currentText)
    }
    this.dirty = false
    this.lastCredential = credential
  }

  /** 外部修改且 Buffer 干净时的自动重载路径。 */
  setExternalText(text: string, originalBytesBase64: string): void {
    this.currentText = text
    this.originalBytes = originalBytesBase64
    this.dirty = false
  }
}
