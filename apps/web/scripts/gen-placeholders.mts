#!/usr/bin/env node
/**
 * Generates simple, dependency-free SVG product placeholders so the demo is
 * fully self-contained and works offline (no external image hosts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/images/products");

const PALETTE = ["#ece7f6", "#d9d0ee", "#f6e6da", "#e3efe6", "#eef0f7", "#f7efe3"];

const SHAPES: Record<string, string> = {
  laptop: `<rect x="40" y="90" width="220" height="130" rx="10" fill="#4b5563"/><rect x="52" y="100" width="196" height="104" rx="6" fill="#9ca3af"/><rect x="20" y="222" width="260" height="18" rx="6" fill="#374151"/>`,
  phone: `<rect x="105" y="40" width="90" height="200" rx="18" fill="#4b5563"/><rect x="114" y="58" width="72" height="148" rx="8" fill="#9ca3af"/><circle cx="150" cy="224" r="7" fill="#374151"/>`,
  headphones: `<path d="M70 130 A80 80 0 0 1 230 130" stroke="#4b5563" stroke-width="18" fill="none"/><rect x="56" y="120" width="32" height="80" rx="14" fill="#374151"/><rect x="212" y="120" width="32" height="80" rx="14" fill="#374151"/>`,
  charger: `<rect x="80" y="90" width="140" height="120" rx="14" fill="#4b5563"/><rect x="100" y="110" width="100" height="26" rx="6" fill="#d1d5db"/><circle cx="150" cy="180" r="12" fill="#6b7280"/>`,
  knives: `<rect x="40" y="150" width="220" height="60" rx="10" fill="#6b7280"/><rect x="60" y="120" width="24" height="34" rx="6" fill="#9ca3af"/><rect x="110" y="110" width="24" height="44" rx="6" fill="#9ca3af"/><rect x="160" y="120" width="24" height="34" rx="6" fill="#9ca3af"/>`,
  vase: `<path d="M110 60 h80 v40 c0 40 40 50 40 100 c0 40 -40 60 -80 60 c-40 0 -80 -20 -80 -60 c0 -50 40 -60 40 -100 z" fill="#bca9e0" stroke="#7d5cb0" stroke-width="4"/>`,
  bedlinen: `<rect x="50" y="90" width="200" height="140" rx="12" fill="#e3efe6" stroke="#7d5cb0" stroke-width="4"/><rect x="70" y="60" width="70" height="50" rx="10" fill="#ffffff" stroke="#7d5cb0" stroke-width="4"/>`,
  jacket: `<path d="M120 50 L120 110 L80 130 L80 230 L220 230 L220 130 L180 110 L180 50 Z" fill="#6366f1"/><path d="M150 50 L120 110 L150 150 L180 110 Z" fill="#818cf8"/>`,
  dress: `<path d="M110 50 h80 l20 40 -20 20 40 130 h-140 l40 -130 -20 -20 z" fill="#f472b6"/><rect x="110" y="50" width="80" height="14" rx="6" fill="#db2777"/>`,
  constructor: `<rect x="50" y="80" width="60" height="50" fill="#f59e0b"/><rect x="120" y="80" width="60" height="50" fill="#3b82f6"/><rect x="190" y="80" width="60" height="50" fill="#10b981"/><rect x="85" y="140" width="60" height="50" fill="#ef4444"/><rect x="155" y="140" width="60" height="50" fill="#8b5cf6"/><rect x="60" y="200" width="180" height="14" rx="6" fill="#374151"/>`,
  screwdrivers: `<rect x="60" y="120" width="30" height="120" rx="10" fill="#f59e0b"/><rect x="110" y="100" width="30" height="140" rx="10" fill="#3b82f6"/><rect x="160" y="130" width="30" height="110" rx="10" fill="#10b981"/><rect x="210" y="110" width="30" height="130" rx="10" fill="#ef4444"/>`,
  drill: `<rect x="70" y="90" width="140" height="80" rx="16" fill="#f59e0b"/><rect x="200" y="110" width="70" height="26" rx="8" fill="#6b7280"/><path d="M90 170 h50 l-12 60 h-30 z" fill="#374151"/>`,
  grinder: `<rect x="70" y="100" width="140" height="90" rx="16" fill="#3b82f6"/><circle cx="230" cy="140" r="34" fill="none" stroke="#6b7280" stroke-width="10"/><rect x="80" y="190" width="60" height="40" rx="8" fill="#374151"/>`,
  "design-service": `<rect x="60" y="70" width="180" height="150" rx="10" fill="#ffffff" stroke="#7d5cb0" stroke-width="4"/><path d="M80 190 L120 130 L155 160 L190 100 L220 190 Z" fill="#bca9e0"/>`,
  "repair-service": `<rect x="50" y="120" width="200" height="100" rx="8" fill="#e3efe6" stroke="#7d5cb0" stroke-width="4"/><path d="M100 120 V80 h100 v40" fill="none" stroke="#7d5cb0" stroke-width="6"/><rect x="120" y="150" width="60" height="40" rx="4" fill="#bca9e0"/>`,
};

const NAMES = Object.keys(SHAPES);

mkdirSync(OUT, { recursive: true });

let i = 0;
for (const name of NAMES) {
  const bg = PALETTE[i % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect width="300" height="300" fill="${bg}"/>
  ${SHAPES[name]}
</svg>
`;
  writeFileSync(resolve(OUT, `${name}.svg`), svg, "utf-8");
  i++;
}

console.log(`generated ${NAMES.length} placeholders in ${OUT}`);
