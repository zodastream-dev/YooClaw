// server/templates/schemes.ts
// Color scheme constants for IntelStation portal template

export type ColorScheme = 'tech-blue' | 'white-base' | 'sky-blue' | 'banking-blue';

export interface SchemeColors {
  cyan: string;
  purple: string;
  neonBlue: string;
  neonPurple: string;
  neonPink: string;
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
}

export const COLOR_SCHEMES: Record<ColorScheme, SchemeColors> = {
  'tech-blue': {
    cyan: '#00d4ff',
    purple: '#a855f7',
    neonBlue: '#00f0ff',
    neonPurple: '#d946ef',
    neonPink: '#f472b6',
    bgPrimary: '#020617',
    bgSecondary: '#0f172a',
    bgCard: 'rgba(15,23,42,0.6)',
    border: 'rgba(255,255,255,0.1)',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8'
  },
  'white-base': {
    cyan: '#3b82f6',
    purple: '#8b5cf6',
    neonBlue: '#60a5fa',
    neonPurple: '#a78bfa',
    neonPink: '#f472b6',
    bgPrimary: '#f8fafc',
    bgSecondary: '#f1f5f9',
    bgCard: 'rgba(255,255,255,0.92)',
    border: 'rgba(0,0,0,0.06)',
    textPrimary: '#1e293b',
    textSecondary: '#64748b'
  },
  'sky-blue': {
    cyan: '#0284c7',
    purple: '#7c3aed',
    neonBlue: '#0ea5e9',
    neonPurple: '#8b5cf6',
    neonPink: '#ec4899',
    bgPrimary: '#f0f9ff',
    bgSecondary: '#e0f2fe',
    bgCard: 'rgba(255,255,255,0.88)',
    border: 'rgba(14,165,233,0.15)',
    textPrimary: '#0c4a6e',
    textSecondary: '#0369a1'
  },
  'banking-blue': {
    cyan: '#38bdf8',
    purple: '#818cf8',
    neonBlue: '#38bdf8',
    neonPurple: '#a78bfa',
    neonPink: '#f472b6',
    bgPrimary: '#0a1628',
    bgSecondary: '#0f1f3a',
    bgCard: 'rgba(15,31,58,0.7)',
    border: 'rgba(56,189,248,0.12)',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8'
  }
};
