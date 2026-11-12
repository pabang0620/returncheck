import { studioGridTheme, studioTheme } from 'ag-studio'

// Same tokens as the staff app (theme.css, option 4 "Calm Checkout"): cool neutrals, one teal accent, one font.
// `steps` is a light-to-dark teal ramp for the damage map; `fills` are the chart series colours.
export const TOKENS = {
  ink: '#0F1B2A',
  muted: '#5D6B7C',
  paper: '#F4F7FA',
  line: '#E3E9F0',
  lineStrong: '#CBD5E1',
  accent: '#0F766E',
  steps: ['#E6F4F2', '#A7D8D1', '#4FA89E', '#0F766E', '#0B4F4A'],
  fills: ['#0F766E', '#1D4ED8', '#B45309', '#6D28D9', '#64748B', '#4FA89E'],
  font: 'Manrope, system-ui, sans-serif',
}

export const returnCheckTheme = studioTheme.withParams({
  accentColor: TOKENS.accent,
  foregroundColor: TOKENS.ink,
  textColor: TOKENS.ink,
  backgroundColor: '#FFFFFF',
  borderColor: TOKENS.line,
  borderRadius: 12,
  fontFamily: TOKENS.font,
  // Same title size as the seeded widgets, so a widget the agent adds does not get a larger, clipped title.
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 700,
  studioWidgetBorderRadius: 18,
  studioWidgetShadow: '0 1px 2px rgba(15,27,42,.04), 0 6px 20px rgba(15,27,42,.05)',
  studioCanvasBackgroundColor: TOKENS.paper,
  chartPaletteFills1Color: TOKENS.fills[0],
  chartPaletteFills2Color: TOKENS.fills[1],
  chartPaletteFills3Color: TOKENS.fills[2],
  chartPaletteFills4Color: TOKENS.fills[3],
  chartPaletteFills5Color: TOKENS.fills[4],
  chartPaletteFills6Color: TOKENS.fills[5],
})

// Used when a custom widget hosts its own AG Grid.
export const returnCheckGridTheme = studioGridTheme.withParams({ accentColor: TOKENS.accent, fontFamily: TOKENS.font, foregroundColor: TOKENS.ink, borderColor: TOKENS.line, borderRadius: 12, wrapperBorderRadius: 18 })
