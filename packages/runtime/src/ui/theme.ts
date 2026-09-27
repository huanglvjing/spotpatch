/**
 * Design tokens and base rules for every stylesheet in the SpotPatch shadow
 * root. This is the only UI module allowed to contain literal colors; other
 * stylesheets reference the custom properties declared here.
 */
export const THEME_STYLES = `
  :host {
    all: initial;
    color-scheme: dark;

    --spotpatch-bg: #0c0d12;
    --spotpatch-bg-raised: #14161d;
    --spotpatch-bg-active: #1b1e28;
    --spotpatch-bg-input: #08090d;
    --spotpatch-border-subtle: rgb(255 255 255 / 7%);
    --spotpatch-border: rgb(255 255 255 / 11%);
    --spotpatch-border-strong: rgb(255 255 255 / 20%);
    --spotpatch-hover: rgb(255 255 255 / 5%);

    --spotpatch-text: #f4f5f7;
    --spotpatch-text-secondary: #a7acb8;
    --spotpatch-text-muted: #737987;
    --spotpatch-text-on-accent: #ffffff;

    --spotpatch-accent: #7c4dff;
    --spotpatch-accent-strong: #6d35ff;
    --spotpatch-accent-soft: #c4b3ff;
    --spotpatch-accent-cyan: #00d9e9;
    --spotpatch-accent-blue: #168eff;
    --spotpatch-success: #45d483;
    --spotpatch-warning: #f4b860;
    --spotpatch-danger: #ff6b7a;

    --spotpatch-accent-tint: color-mix(in srgb, var(--spotpatch-accent) 16%, transparent);
    --spotpatch-accent-line: color-mix(in srgb, var(--spotpatch-accent) 48%, transparent);
    --spotpatch-cyan-text: color-mix(in srgb, var(--spotpatch-accent-cyan) 70%, var(--spotpatch-text));
    --spotpatch-cyan-tint: color-mix(in srgb, var(--spotpatch-accent-cyan) 10%, transparent);
    --spotpatch-cyan-line: color-mix(in srgb, var(--spotpatch-accent-cyan) 30%, transparent);
    --spotpatch-success-text: color-mix(in srgb, var(--spotpatch-success) 72%, var(--spotpatch-text));
    --spotpatch-success-tint: color-mix(in srgb, var(--spotpatch-success) 12%, transparent);
    --spotpatch-warning-text: color-mix(in srgb, var(--spotpatch-warning) 78%, var(--spotpatch-text));
    --spotpatch-warning-tint: color-mix(in srgb, var(--spotpatch-warning) 11%, transparent);
    --spotpatch-warning-line: color-mix(in srgb, var(--spotpatch-warning) 30%, transparent);
    --spotpatch-danger-text: color-mix(in srgb, var(--spotpatch-danger) 72%, var(--spotpatch-text));
    --spotpatch-danger-tint: color-mix(in srgb, var(--spotpatch-danger) 11%, transparent);
    --spotpatch-danger-line: color-mix(in srgb, var(--spotpatch-danger) 30%, transparent);

    --spotpatch-primary-fill: linear-gradient(135deg, var(--spotpatch-accent), var(--spotpatch-accent-strong));
    --spotpatch-brand-line: linear-gradient(90deg, var(--spotpatch-accent), var(--spotpatch-accent-blue), var(--spotpatch-accent-cyan));
    --spotpatch-surface-fill:
      linear-gradient(180deg, rgb(255 255 255 / 3.5%), transparent 30%),
      var(--spotpatch-bg);
    --spotpatch-scrim: rgb(3 3 8 / 72%);

    --spotpatch-shadow-float: 0 18px 44px rgb(6 8 18 / 30%), 0 2px 8px rgb(6 8 18 / 18%);
    --spotpatch-shadow-panel: 0 28px 70px rgb(6 8 18 / 42%), 0 4px 14px rgb(6 8 18 / 22%);
    --spotpatch-shadow-inset: inset 0 1px 0 rgb(255 255 255 / 7%);
    --spotpatch-shadow-accent: 0 10px 26px -10px color-mix(in srgb, var(--spotpatch-accent-strong) 80%, transparent);

    --spotpatch-radius-xs: 6px;
    --spotpatch-radius-sm: 8px;
    --spotpatch-radius-md: 10px;
    --spotpatch-radius-card: 12px;
    --spotpatch-radius-panel: 20px;
    --spotpatch-radius-pill: 999px;

    --spotpatch-ease-out: cubic-bezier(.16, 1, .3, 1);
    --spotpatch-ease-spring: cubic-bezier(.34, 1.36, .64, 1);
    --spotpatch-ease-standard: cubic-bezier(.2, 0, 0, 1);
    --spotpatch-duration-fast: 140ms;
    --spotpatch-duration-base: 220ms;
    --spotpatch-duration-slow: 420ms;

    --spotpatch-font-sans: Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    --spotpatch-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    color: var(--spotpatch-text);
    font-family: var(--spotpatch-font-sans);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  [hidden] { display: none !important; }
  button, textarea, select, input { font: inherit; }
  :focus-visible {
    outline: 2px solid var(--spotpatch-accent-soft);
    outline-offset: 2px;
  }
  * {
    scrollbar-color: var(--spotpatch-border-strong) transparent;
    scrollbar-width: thin;
  }
  @keyframes spotpatch-enter {
    from { opacity: 0; filter: blur(3px); transform: translate3d(0, 6px, 0); }
  }
  @keyframes spotpatch-pop {
    from { opacity: 0; transform: scale(.94); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
`;

/**
 * Literal colors for values that GSAP interpolates, which cannot resolve CSS
 * custom properties. Keep them in step with the tokens above.
 */
export const THEME_MOTION_COLORS = Object.freeze({
  dispatchGlowRest: "0 0 0 0 rgb(124 77 255 / 0%)",
  dispatchGlow: "0 0 0 4px rgb(124 77 255 / 22%)",
});
