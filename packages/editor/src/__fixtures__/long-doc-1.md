# md-editor 项目须知（裁剪版）

> 往返保真是最高优先级：零编辑保存不写盘，编辑后的序列化必须可预期。

## 三条铁律

1. **文件级保真**：Buffer 未被编辑过就直接跳过写入。
2. **Markdown Buffer 是唯一事实源**：ProseMirror Doc 只是投影。
3. **不引入第二套内核**：渲染用 Milkdown，源码模式用 CodeMirror 6。

## 仓库地图

| 目录 | 职责 |
| --- | --- |
| electron/main | 窗口、菜单、文件 IO |
| electron/preload | contextBridge 契约 |
| packages/app | 工作台外壳 |
| packages/editor | Milkdown 内核封装 |

### 协作约定

- 提交信息使用英文祈使句，例如 `fix(editor): keep cursor`。
- 改动 `cursor-map.ts` 必须附回归结果。
- 新增节点类型需要：

  1. 注册 preset/NodeView
  2. 一份 round-trip 差异用例
  3. 必要时登记样式变量

## 常用命令

```bash
pnpm install
pnpm dev
pnpm test
```

---

性能口径：冷启动 <3s，空文档常驻内存 ≤300MB。
