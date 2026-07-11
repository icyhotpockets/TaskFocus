import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_COLORS,
  REQUIRED_THEME_TOKENS,
  THEMES,
  THEME_FAMILIES,
  contrastRatio,
  getTheme,
  relativeLuminance,
  themeCssText,
  themesInFamily,
  validateAllThemes,
  validateThemeContrast,
} from '../../www/js/core/themes.js';

test('all eight exact theme ids exist and Midnight Ember is the fallback', () => {
  assert.deepEqual(Object.keys(THEMES), ['ember', 'wine', 'cobalt', 'paper', 'forest', 'eucalyptus', 'coral', 'sunrise']);
  assert.equal(getTheme('ember').name, 'Midnight Ember');
  assert.equal(getTheme('missing').id, 'ember');
});

test('themes are split into four two-variant psychology families', () => {
  assert.deepEqual(Object.keys(THEME_FAMILIES), ['ember', 'deep', 'calm', 'energy']);
  for (const family of Object.keys(THEME_FAMILIES)) assert.equal(themesInFamily(family).length, 2);
  assert.equal(THEME_FAMILIES.deep.blurb, 'Blues that support sustained attention');
});

test('light themes are Paper, Eucalyptus, and Sunrise only', () => {
  assert.deepEqual(Object.values(THEMES).filter(({ light }) => light).map(({ id }) => id), ['paper', 'eucalyptus', 'sunrise']);
  assert.ok(Object.values(THEMES).filter(({ light }) => light).every(({ colorScheme }) => colorScheme === 'light'));
});

test('every theme has the full required token set', () => {
  for (const candidate of Object.values(THEMES)) {
    assert.deepEqual(REQUIRED_THEME_TOKENS.filter((token) => !candidate.tokens[token]), [], candidate.id);
  }
});

test('approved default palette values are exact', () => {
  assert.equal(THEMES.ember.tokens['--bg'], '#1b2026');
  assert.equal(THEMES.ember.tokens['--bg-elev'], '#242b33');
  assert.equal(THEMES.ember.tokens['--bg-elev-2'], '#2e3742');
  assert.equal(THEMES.ember.tokens['--accent'], '#a63446');
  assert.equal(THEMES.ember.tokens['--accent-bright'], '#c4576a');
  assert.equal(THEMES.ember.tokens['--accent-deep'], '#7c2434');
});

test('light cards are warm surfaces, never pure white', () => {
  for (const candidate of Object.values(THEMES).filter(({ light }) => light)) {
    assert.notEqual(candidate.tokens['--bg-elev'].toLowerCase(), '#ffffff');
    assert.match(candidate.tokens['--border'], /^rgba\((?!255,255,255)/);
  }
});

test('status colors follow light and dark requirements', () => {
  assert.equal(THEMES.ember.tokens['--good'], '#3ecf8e');
  assert.equal(THEMES.paper.tokens['--good'], '#17835a');
  assert.equal(THEMES.coral.tokens['--warn'], '#f0b429');
  assert.equal(THEMES.sunrise.tokens['--danger'], '#c23f33');
});

test('all palettes pass the required WCAG contrast gates', () => {
  assert.deepEqual(validateAllThemes(), []);
  for (const candidate of Object.values(THEMES)) assert.deepEqual(validateThemeContrast(candidate), []);
});

test('contrast utilities compute known black/white values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.throws(() => relativeLuminance('red'), /Unsupported color/);
});

test('themeCssText emits ready-to-apply custom properties', () => {
  const css = themeCssText('cobalt');
  assert.match(css, /--bg:#101722/);
  assert.match(css, /--accent:#3d72ad/);
  assert.doesNotMatch(css, /undefined/);
});

test('category palette contains eight exact independent task colors', () => {
  assert.deepEqual(CATEGORY_COLORS.map(({ hex }) => hex), [
    '#c4576a', '#d96c47', '#d9a441', '#7fa65a',
    '#4a9e8f', '#5b84a8', '#8a6fb8', '#8b97a3',
  ]);
});
