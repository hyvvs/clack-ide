// Compact override for shadcn ContextMenuItem inside the file explorer.
// The base item is sized for a desktop nav menu (px-3 py-2 text-sm); the
// explorer needs something denser to match the tree row scale.
export const COMPACT_ITEM =
  "rounded-[var(--clack-radius-button)] px-2.5 py-1.5 text-xs gap-2";
export const COMPACT_CONTENT =
  "min-w-44 rounded-[var(--clack-radius-panel)] border border-[color:var(--clack-border-strong)] bg-[var(--clack-surface-raised)] p-1";
