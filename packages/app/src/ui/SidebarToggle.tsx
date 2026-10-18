import { t } from '../i18n'

interface SidebarToggleProps {
  collapsed: boolean
  onToggle(): void
}

/** 侧栏折叠开关：内联 chevron，折叠时朝右（展开方向）。 */
export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      data-testid="sidebar-toggle"
      aria-label={t(collapsed ? 'sidebarExpand' : 'sidebarCollapse')}
      aria-pressed={collapsed}
      onClick={onToggle}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d={collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
