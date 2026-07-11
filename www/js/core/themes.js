export const CATEGORY_COLORS = Object.freeze([
  { id: 'rose', name: 'Rose', hex: '#c4576a' },
  { id: 'ember', name: 'Ember', hex: '#d96c47' },
  { id: 'amber', name: 'Amber', hex: '#d9a441' },
  { id: 'moss', name: 'Moss', hex: '#7fa65a' },
  { id: 'teal', name: 'Teal', hex: '#4a9e8f' },
  { id: 'steel', name: 'Steel', hex: '#5b84a8' },
  { id: 'violet', name: 'Violet', hex: '#8a6fb8' },
  { id: 'slate', name: 'Slate', hex: '#8b97a3' },
]);

export const THEME_FAMILIES = Object.freeze({
  ember: { name: 'Ember', blurb: 'Warmth with focus — the original' },
  deep: { name: 'Deep Focus', blurb: 'Blues that support sustained attention' },
  calm: { name: 'Calm', blurb: 'Restorative greens, easy on the eyes' },
  energy: { name: 'Energy', blurb: 'Warm tones that lift alertness' },
});

const darkStatus = Object.freeze({ '--good': '#3ecf8e', '--warn': '#f39c12', '--danger': '#ff6b5e' });
const lightStatus = Object.freeze({ '--good': '#17835a', '--warn': '#a06508', '--danger': '#c23f33' });

function theme({ id, family, name, light = false, bg, elev, elev2, text, dim, faint,
  accent, bright, deep, soft, border, tree, shadow, accentShadow, status = null }) {
  return Object.freeze({
    id, family, name, light, colorScheme: light ? 'light' : 'dark',
    tokens: Object.freeze({
      '--bg': bg,
      '--bg-elev': elev,
      '--bg-elev-2': elev2,
      '--text': text,
      '--text-dim': dim,
      '--text-faint': faint,
      '--accent': accent,
      '--accent-bright': bright,
      '--accent-deep': deep,
      '--accent-soft': soft,
      ...(status ?? (light ? lightStatus : darkStatus)),
      '--border': border,
      '--tree-line': tree,
      '--shadow': shadow,
      '--accent-shadow': accentShadow,
    }),
  });
}

export const THEMES = Object.freeze({
  ember: theme({
    id: 'ember', family: 'ember', name: 'Midnight Ember',
    bg: '#1b2026', elev: '#242b33', elev2: '#2e3742',
    text: '#e8eaed', dim: '#97a3b0', faint: '#64707d',
    accent: '#a63446', bright: '#c4576a', deep: '#7c2434',
    soft: 'rgba(166,52,70,.18)', border: 'rgba(255,255,255,.07)',
    tree: 'rgba(255,255,255,.16)', shadow: '0 8px 24px rgba(0,0,0,.35)',
    accentShadow: 'rgba(166,52,70,.45)',
  }),
  wine: theme({
    id: 'wine', family: 'ember', name: 'Charcoal Wine',
    bg: '#171419', elev: '#211d25', elev2: '#2c2731',
    text: '#ece8ef', dim: '#a49cae', faint: '#6f6779',
    accent: '#94405f', bright: '#b76282', deep: '#6a2a43',
    soft: 'rgba(148,64,95,.18)', border: 'rgba(255,255,255,.07)',
    tree: 'rgba(255,255,255,.16)', shadow: '0 8px 24px rgba(0,0,0,.38)',
    accentShadow: 'rgba(148,64,95,.45)',
  }),
  cobalt: theme({
    id: 'cobalt', family: 'deep', name: 'Night Cobalt',
    bg: '#101722', elev: '#18222f', elev2: '#212e3f',
    text: '#e6ecf4', dim: '#8fa2b8', faint: '#5d7086',
    accent: '#3d72ad', bright: '#6296cd', deep: '#2a527e',
    soft: 'rgba(61,114,173,.18)', border: 'rgba(255,255,255,.07)',
    tree: 'rgba(255,255,255,.16)', shadow: '0 8px 24px rgba(0,0,0,.38)',
    accentShadow: 'rgba(61,114,173,.45)',
  }),
  paper: theme({
    id: 'paper', family: 'deep', name: 'Paper & Ink', light: true,
    bg: '#f0ead8', elev: '#fdf6e3', elev2: '#f5efdc',
    text: '#1f2933', dim: '#52616f', faint: '#7c8896',
    accent: '#33557e', bright: '#466992', deep: '#24405e',
    soft: 'rgba(51,85,126,.16)', border: 'rgba(60,48,16,.14)',
    tree: 'rgba(60,48,16,.24)', shadow: '0 8px 24px rgba(60,48,16,.20)',
    accentShadow: 'rgba(51,85,126,.34)',
  }),
  forest: theme({
    id: 'forest', family: 'calm', name: 'Still Forest',
    bg: '#151b17', elev: '#1d2620', elev2: '#27332b',
    text: '#e7ece8', dim: '#95a89a', faint: '#617568',
    accent: '#4e8465', bright: '#6faa89', deep: '#375f49',
    soft: 'rgba(78,132,101,.18)', border: 'rgba(255,255,255,.07)',
    tree: 'rgba(255,255,255,.16)', shadow: '0 8px 24px rgba(0,0,0,.38)',
    accentShadow: 'rgba(78,132,101,.45)',
  }),
  eucalyptus: theme({
    id: 'eucalyptus', family: 'calm', name: 'Eucalyptus', light: true,
    bg: '#ebeddb', elev: '#fbf7e6', elev2: '#f2f1de',
    text: '#233029', dim: '#54675c', faint: '#7e8f84',
    accent: '#3d7a5c', bright: '#548f70', deep: '#2b5741',
    soft: 'rgba(61,122,92,.16)', border: 'rgba(58,66,35,.14)',
    tree: 'rgba(58,66,35,.24)', shadow: '0 8px 24px rgba(58,66,35,.20)',
    accentShadow: 'rgba(61,122,92,.34)',
  }),
  coral: theme({
    id: 'coral', family: 'energy', name: 'Coral Drive',
    bg: '#1c1613', elev: '#27201b', elev2: '#332a23',
    text: '#efe9e3', dim: '#ab9d8f', faint: '#786c5f',
    accent: '#c25a38', bright: '#e07e5b', deep: '#8d3f25',
    soft: 'rgba(194,90,56,.18)', border: 'rgba(255,255,255,.07)',
    tree: 'rgba(255,255,255,.16)', shadow: '0 8px 24px rgba(0,0,0,.38)',
    accentShadow: 'rgba(194,90,56,.45)',
    status: { '--good': '#3ecf8e', '--warn': '#f0b429', '--danger': '#ff6b5e' },
  }),
  sunrise: theme({
    id: 'sunrise', family: 'energy', name: 'Sunrise', light: true,
    bg: '#f1e7cf', elev: '#fcf4df', elev2: '#f4ebd3',
    text: '#33291d', dim: '#6b5d49', faint: '#93866f',
    accent: '#b35317', bright: '#cd6e33', deep: '#833c0f',
    soft: 'rgba(179,83,23,.16)', border: 'rgba(80,50,20,.14)',
    tree: 'rgba(80,50,20,.24)', shadow: '0 8px 24px rgba(80,50,20,.20)',
    accentShadow: 'rgba(179,83,23,.34)',
  }),
});

export const REQUIRED_THEME_TOKENS = Object.freeze([
  '--bg', '--bg-elev', '--bg-elev-2', '--text', '--text-dim', '--text-faint',
  '--accent', '--accent-bright', '--accent-deep', '--accent-soft', '--good',
  '--warn', '--danger', '--border', '--tree-line', '--shadow', '--accent-shadow',
]);

export function getTheme(id) {
  return THEMES[id] ?? THEMES.ember;
}

export function themesInFamily(family) {
  return Object.values(THEMES).filter((candidate) => candidate.family === family);
}

export function themeCssText(id) {
  const selected = getTheme(id);
  return Object.entries(selected.tokens).map(([token, value]) => `${token}:${value}`).join(';');
}

function hexToRgb(hex) {
  const normalized = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new TypeError(`Unsupported color: ${hex}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export function validateThemeContrast(candidate) {
  const errors = [];
  const { tokens } = candidate;
  for (const background of ['--bg', '--bg-elev', '--bg-elev-2']) {
    const ratio = contrastRatio(tokens['--text'], tokens[background]);
    if (ratio < 4.5) errors.push(`${candidate.id}: text/${background} ${ratio.toFixed(2)} < 4.5`);
  }
  const dimRatio = contrastRatio(tokens['--text-dim'], tokens['--bg-elev']);
  if (dimRatio < 4.5) errors.push(`${candidate.id}: dim/card ${dimRatio.toFixed(2)} < 4.5`);
  const accentRatio = contrastRatio('#ffffff', tokens['--accent']);
  if (accentRatio < 3) errors.push(`${candidate.id}: white/accent ${accentRatio.toFixed(2)} < 3`);
  return errors;
}

export function validateAllThemes() {
  const errors = [];
  for (const candidate of Object.values(THEMES)) {
    const missing = REQUIRED_THEME_TOKENS.filter((token) => !candidate.tokens[token]);
    if (missing.length) errors.push(`${candidate.id}: missing ${missing.join(', ')}`);
    errors.push(...validateThemeContrast(candidate));
  }
  return errors;
}
