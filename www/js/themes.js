const darkStatus = {
  good: "#3ecf8e",
  warn: "#f39c12",
  danger: "#ff6b5e",
};

const lightStatus = {
  good: "#17835a",
  warn: "#a06508",
  danger: "#c23f33",
};

const darkSurfaces = {
  border: "rgba(255,255,255,.07)",
  treeLine: "rgba(255,255,255,.16)",
  shadow: "0 8px 24px rgba(0,0,0,.35)",
};

export const themeFamilies = {
  ember: {
    label: "Ember",
    blurb: "Warmth with focus — the original",
  },
  deep: {
    label: "Deep Focus",
    blurb: "Blues that support sustained attention",
  },
  calm: {
    label: "Calm",
    blurb: "Restorative greens, easy on the eyes",
  },
  energy: {
    label: "Energy",
    blurb: "Warm tones that lift alertness",
  },
};

export const themes = {
  ember: {
    id: "ember",
    family: "ember",
    name: "Midnight Ember",
    light: false,
    bg: "#1b2026",
    bgElev: "#242b33",
    bgElev2: "#2e3742",
    text: "#e8eaed",
    textDim: "#97a3b0",
    textFaint: "#64707d",
    accent: "#a63446",
    accentBright: "#c4576a",
    accentDeep: "#7c2434",
    accentSoft: "rgba(166,52,70,.18)",
    accentShadow: "rgba(166,52,70,.45)",
    ...darkStatus,
    ...darkSurfaces,
    onAccent: "#ffffff",
  },
  wine: {
    id: "wine",
    family: "ember",
    name: "Charcoal Wine",
    light: false,
    bg: "#171419",
    bgElev: "#211d25",
    bgElev2: "#2c2731",
    text: "#ece8ef",
    textDim: "#a49cae",
    textFaint: "#6f6779",
    accent: "#94405f",
    accentBright: "#b76282",
    accentDeep: "#6a2a43",
    accentSoft: "rgba(148,64,95,.18)",
    accentShadow: "rgba(148,64,95,.43)",
    ...darkStatus,
    ...darkSurfaces,
    onAccent: "#ffffff",
  },
  cobalt: {
    id: "cobalt",
    family: "deep",
    name: "Night Cobalt",
    light: false,
    bg: "#101722",
    bgElev: "#18222f",
    bgElev2: "#212e3f",
    text: "#e6ecf4",
    textDim: "#8fa2b8",
    textFaint: "#5d7086",
    accent: "#3d72ad",
    accentBright: "#6296cd",
    accentDeep: "#2a527e",
    accentSoft: "rgba(61,114,173,.18)",
    accentShadow: "rgba(61,114,173,.43)",
    ...darkStatus,
    ...darkSurfaces,
    onAccent: "#ffffff",
  },
  paper: {
    id: "paper",
    family: "deep",
    name: "Paper & Ink",
    light: true,
    bg: "#f0ead8",
    bgElev: "#fdf6e3",
    bgElev2: "#f5efdc",
    text: "#1f2933",
    textDim: "#52616f",
    textFaint: "#7c8896",
    accent: "#33557e",
    accentBright: "#466992",
    accentDeep: "#24405e",
    accentSoft: "rgba(51,85,126,.15)",
    accentShadow: "rgba(51,85,126,.28)",
    ...lightStatus,
    border: "rgba(60,48,16,.14)",
    treeLine: "rgba(60,48,16,.25)",
    shadow: "0 8px 24px rgba(60,48,16,.18)",
    onAccent: "#ffffff",
  },
  forest: {
    id: "forest",
    family: "calm",
    name: "Still Forest",
    light: false,
    bg: "#151b17",
    bgElev: "#1d2620",
    bgElev2: "#27332b",
    text: "#e7ece8",
    textDim: "#95a89a",
    textFaint: "#617568",
    accent: "#4e8465",
    accentBright: "#6faa89",
    accentDeep: "#375f49",
    accentSoft: "rgba(78,132,101,.18)",
    accentShadow: "rgba(78,132,101,.42)",
    ...darkStatus,
    ...darkSurfaces,
    onAccent: "#ffffff",
  },
  eucalyptus: {
    id: "eucalyptus",
    family: "calm",
    name: "Eucalyptus",
    light: true,
    bg: "#ebeddb",
    bgElev: "#fbf7e6",
    bgElev2: "#f2f1de",
    text: "#233029",
    textDim: "#54675c",
    textFaint: "#7e8f84",
    accent: "#3d7a5c",
    accentBright: "#548f70",
    accentDeep: "#2b5741",
    accentSoft: "rgba(61,122,92,.15)",
    accentShadow: "rgba(61,122,92,.27)",
    ...lightStatus,
    border: "rgba(58,62,28,.14)",
    treeLine: "rgba(58,62,28,.24)",
    shadow: "0 8px 24px rgba(58,62,28,.17)",
    onAccent: "#ffffff",
  },
  coral: {
    id: "coral",
    family: "energy",
    name: "Coral Drive",
    light: false,
    bg: "#1c1613",
    bgElev: "#27201b",
    bgElev2: "#332a23",
    text: "#efe9e3",
    textDim: "#ab9d8f",
    textFaint: "#786c5f",
    accent: "#c25a38",
    accentBright: "#e07e5b",
    accentDeep: "#8d3f25",
    accentSoft: "rgba(194,90,56,.18)",
    accentShadow: "rgba(194,90,56,.43)",
    good: darkStatus.good,
    warn: "#f0b429",
    danger: darkStatus.danger,
    ...darkSurfaces,
    onAccent: "#ffffff",
  },
  sunrise: {
    id: "sunrise",
    family: "energy",
    name: "Sunrise",
    light: true,
    bg: "#f1e7cf",
    bgElev: "#fcf4df",
    bgElev2: "#f4ebd3",
    text: "#33291d",
    textDim: "#6b5d49",
    textFaint: "#93866f",
    accent: "#b35317",
    accentBright: "#cd6e33",
    accentDeep: "#833c0f",
    accentSoft: "rgba(179,83,23,.15)",
    accentShadow: "rgba(179,83,23,.28)",
    ...lightStatus,
    border: "rgba(73,49,16,.14)",
    treeLine: "rgba(73,49,16,.25)",
    shadow: "0 8px 24px rgba(73,49,16,.18)",
    onAccent: "#ffffff",
  },
};

const cssTokenMap = {
  bg: "--bg",
  bgElev: "--bg-elev",
  bgElev2: "--bg-elev-2",
  text: "--text",
  textDim: "--text-dim",
  textFaint: "--text-faint",
  accent: "--accent",
  accentBright: "--accent-bright",
  accentDeep: "--accent-deep",
  accentSoft: "--accent-soft",
  good: "--good",
  warn: "--warn",
  danger: "--danger",
  border: "--border",
  treeLine: "--tree-line",
  shadow: "--shadow",
  accentShadow: "--accent-shadow",
  onAccent: "--on-accent",
};

export function applyTheme(themeId) {
  const theme = themes[themeId] || themes.ember;
  const root = document.documentElement;

  for (const [property, token] of Object.entries(cssTokenMap)) {
    root.style.setProperty(token, theme[property]);
  }

  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  return theme;
}

export function themesForFamily(familyId) {
  return Object.values(themes).filter((theme) => theme.family === familyId);
}

export function themePreviewStyle(theme) {
  return [
    `--preview-bg:${theme.bgElev}`,
    `--preview-text:${theme.text}`,
    `--preview-accent:${theme.accent}`,
    `--preview-border:${theme.border}`,
  ].join(";");
}
