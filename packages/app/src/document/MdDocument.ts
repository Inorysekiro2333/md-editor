import { encodeUtf8Base64 } from '../base64'
import type { WriteCredential } from '../bridge'

export interface MdDocumentInit {
  id: string
  path: string | null
  text: string
  originalBytesBase64: string
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
    const text =
      this.init.eol === 'crlf' ? this.currentText.replace(/(?<!\r)\n/g, '\r\n') : this.currentText
    return encodeUtf8Base64(this.init.hasBom ? `\uFEFF${text}` : text)
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
