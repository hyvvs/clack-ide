import type { Theme, ThemeColors, ThemeMode, TerminalPalette } from "./types";

const COLOR_VAR: Record<keyof ThemeColors, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  radius: "--radius",
};

const ANSI_VARS: readonly string[] = [
  "--terminal-ansi-black",
  "--terminal-ansi-red",
  "--terminal-ansi-green",
  "--terminal-ansi-yellow",
  "--terminal-ansi-blue",
  "--terminal-ansi-magenta",
  "--terminal-ansi-cyan",
  "--terminal-ansi-white",
  "--terminal-ansi-bright-black",
  "--terminal-ansi-bright-red",
  "--terminal-ansi-bright-green",
  "--terminal-ansi-bright-yellow",
  "--terminal-ansi-bright-blue",
  "--terminal-ansi-bright-magenta",
  "--terminal-ansi-bright-cyan",
  "--terminal-ansi-bright-white",
];

const CLACK_VARS: readonly string[] = [
  "--clack-bg-root",
  "--clack-bg-shell",
  "--clack-bg-workspace",
  "--clack-bg-rail",
  "--clack-surface-1",
  "--clack-surface-2",
  "--clack-surface-3",
  "--clack-surface-raised",
  "--clack-border-subtle",
  "--clack-border-strong",
  "--clack-border-accent",
  "--clack-text-1",
  "--clack-text-2",
  "--clack-text-3",
  "--clack-text-inverse",
  "--clack-accent",
  "--clack-accent-2",
  "--clack-accent-soft",
  "--clack-accent-strong",
  "--clack-success",
  "--clack-warning",
  "--clack-danger",
  "--clack-focus",
  "--clack-radius-button",
  "--clack-radius-panel",
  "--clack-radius-card",
];

const ALL_VARS: readonly string[] = [
  ...Object.values(COLOR_VAR),
  ...CLACK_VARS,
  "--terminal-background",
  "--terminal-foreground",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-selection",
  ...ANSI_VARS,
];

let lastApplied: string | null = null;

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const root = document.documentElement;
  const variant = theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  if (!variant) {
    clearTheme();
    return;
  }
  const colors = variant.colors;
  const terminal = variant.terminal;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  if (colors) writeColors(root, colors);
  if (colors) writeClackColors(root, colors);
  if (terminal) writeTerminal(root, terminal);
  lastApplied = theme.id;
}

export function clearTheme(): void {
  if (lastApplied === null) return;
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  lastApplied = null;
}

function writeColors(root: HTMLElement, c: ThemeColors): void {
  for (const k of Object.keys(c) as (keyof ThemeColors)[]) {
    const v = c[k];
    if (v) root.style.setProperty(COLOR_VAR[k], v);
  }
}

function writeClackColors(root: HTMLElement, c: ThemeColors): void {
  if (c.background) {
    root.style.setProperty("--clack-bg-root", c.background);
    root.style.setProperty("--clack-bg-workspace", c.background);
  }
  if (c.sidebar) {
    root.style.setProperty("--clack-bg-shell", c.sidebar);
    root.style.setProperty("--clack-bg-rail", c.sidebar);
  }
  if (c.card) root.style.setProperty("--clack-surface-1", c.card);
  if (c.secondary) root.style.setProperty("--clack-surface-2", c.secondary);
  if (c.accent) root.style.setProperty("--clack-surface-3", c.accent);
  if (c.popover) root.style.setProperty("--clack-surface-raised", c.popover);
  if (c.border) {
    root.style.setProperty("--clack-border-subtle", c.border);
    root.style.setProperty("--clack-border-strong", c.border);
  }
  if (c.primary) {
    root.style.setProperty("--clack-accent", c.primary);
    root.style.setProperty("--clack-focus", c.primary);
    root.style.setProperty("--clack-border-accent", c.primary);
    root.style.setProperty(
      "--clack-accent-soft",
      `color-mix(in srgb, ${c.primary} 13%, transparent)`,
    );
    root.style.setProperty("--clack-accent-strong", c.primary);
  }
  if (c.ring) root.style.setProperty("--clack-focus", c.ring);
  if (c.foreground) root.style.setProperty("--clack-text-1", c.foreground);
  if (c.cardForeground)
    root.style.setProperty("--clack-text-2", c.cardForeground);
  if (c.mutedForeground)
    root.style.setProperty("--clack-text-3", c.mutedForeground);
  if (c.primaryForeground)
    root.style.setProperty("--clack-text-inverse", c.primaryForeground);
  if (c.destructive) root.style.setProperty("--clack-danger", c.destructive);
  if (c.radius) {
    root.style.setProperty("--clack-radius-button", c.radius);
    root.style.setProperty("--clack-radius-panel", c.radius);
    root.style.setProperty("--clack-radius-card", c.radius);
  }
}

function writeTerminal(root: HTMLElement, t: TerminalPalette): void {
  if (t.background) root.style.setProperty("--terminal-background", t.background);
  if (t.foreground) root.style.setProperty("--terminal-foreground", t.foreground);
  if (t.cursor) root.style.setProperty("--terminal-cursor", t.cursor);
  if (t.cursorAccent) root.style.setProperty("--terminal-cursor-accent", t.cursorAccent);
  if (t.selection) root.style.setProperty("--terminal-selection", t.selection);
  if (t.ansi) {
    for (let i = 0; i < ANSI_VARS.length && i < t.ansi.length; i++) {
      root.style.setProperty(ANSI_VARS[i], t.ansi[i]);
    }
  }
}
