'use client';

import { createTheme, alpha } from '@mui/material/styles';

/**
 * BhuRakshak command-center theme — dark ops-room aesthetic with an
 * emerald accent and semantic hazard colors (green→yellow→orange→red).
 */
export const hazardColor = (level: number): string =>
  ({ 0: '#22c55e', 1: '#eab308', 2: '#f97316', 3: '#ef4444', 4: '#b91c1c' } as Record<number, string>)[level] ?? '#22c55e';

export const hazardLabel = (level: number): string =>
  ({ 0: 'L0 · Normal', 1: 'L1 · Watch', 2: 'L2 · Alert', 3: 'L3 · Warning', 4: 'L4 · Emergency' } as Record<number, string>)[level] ?? 'L0';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#10b981', light: '#34d399', dark: '#047857' },
    secondary: { main: '#f59e0b' },
    success: { main: '#22c55e' },
    warning: { main: '#eab308' },
    error: { main: '#ef4444' },
    info: { main: '#38bdf8' },
    background: {
      default: '#070c14',
      paper: '#0e1522',
    },
    divider: alpha('#94a3b8', 0.16),
    text: { primary: '#e2e8f0', secondary: '#94a3b8' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'var(--font-inter), Inter, system-ui, -apple-system, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${alpha('#94a3b8', 0.14)}`,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${alpha('#94a3b8', 0.14)}`,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: 12.5, padding: '6px 10px', borderRadius: 8 },
      },
    },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 44 } },
    },
  },
});
