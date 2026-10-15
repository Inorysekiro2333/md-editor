// theme:check 的真实校验在 M4 交付（见 development.md 2 节与 TODO.md M4）。
// M0 阶段显式失败，避免 CI 误以为主题已经通过校验。
console.error('theme:check 尚未实现：主题规范校验属于 M4（见 TODO.md M4）')
process.exit(1)
