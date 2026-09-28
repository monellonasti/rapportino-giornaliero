// Stessa palette di app/style.css: modificare i due file insieme.
export const palette = {
  brand: "#173B36",
  onBrand: "#C9DDD6",
  accent: "#174F43",
  accentSoft: "#E6F0EC",
  ink: "#16241F",
  ink2: "#3F504A",
  muted: "#5F6F6A",
  line: "#E2E8E5",
  lineStrong: "#C9D3CF",
  soft: "#F1F5F3",
  white: "#FFFFFF",
  // Bozza: ambra, come in app/style.css (--warn-*).
  warn: "#7A4D00",
  warnSoft: "#FFF4D6",
  warnLine: "#F0D08A",
};
export const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
