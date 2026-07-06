/* Lefa design-system lab — shared token engine.
   Tailwind palette values + shadcn-style CSS variables, dark mode only.
   Selections persist in localStorage and compose across pages. */
"use strict";

/* ---------- Tailwind palettes (v3 reference hex values) ---------- */
const TW = {
  slate:   { 50:"#f8fafc",100:"#f1f5f9",200:"#e2e8f0",300:"#cbd5e1",400:"#94a3b8",500:"#64748b",600:"#475569",700:"#334155",800:"#1e293b",900:"#0f172a",950:"#020617" },
  gray:    { 50:"#f9fafb",100:"#f3f4f6",200:"#e5e7eb",300:"#d1d5db",400:"#9ca3af",500:"#6b7280",600:"#4b5563",700:"#374151",800:"#1f2937",900:"#111827",950:"#030712" },
  zinc:    { 50:"#fafafa",100:"#f4f4f5",200:"#e4e4e7",300:"#d4d4d8",400:"#a1a1aa",500:"#71717a",600:"#52525b",700:"#3f3f46",800:"#27272a",900:"#18181b",950:"#09090b" },
  neutral: { 50:"#fafafa",100:"#f5f5f5",200:"#e5e5e5",300:"#d4d4d4",400:"#a3a3a3",500:"#737373",600:"#525252",700:"#404040",800:"#262626",900:"#171717",950:"#0a0a0a" },
  stone:   { 50:"#fafaf9",100:"#f5f5f4",200:"#e7e5e4",300:"#d6d3d1",400:"#a8a29e",500:"#78716c",600:"#57534e",700:"#44403c",800:"#292524",900:"#1c1917",950:"#0c0a09" },
  blue:    { 50:"#eff6ff",100:"#dbeafe",200:"#bfdbfe",300:"#93c5fd",400:"#60a5fa",500:"#3b82f6",600:"#2563eb",700:"#1d4ed8",800:"#1e40af",900:"#1e3a8a",950:"#172554" },
  orange:  { 50:"#fff7ed",100:"#ffedd5",200:"#fed7aa",300:"#fdba74",400:"#fb923c",500:"#f97316",600:"#ea580c",700:"#c2410c",800:"#9a3412",900:"#7c2d12",950:"#431407" },
  lime:    { 50:"#f7fee7",100:"#ecfccb",200:"#d9f99d",300:"#bef264",400:"#a3e635",500:"#84cc16",600:"#65a30d",700:"#4d7c0f",800:"#3f6212",900:"#365314",950:"#1a2e05" },
  violet:  { 50:"#f5f3ff",100:"#ede9fe",200:"#ddd6fe",300:"#c4b5fd",400:"#a78bfa",500:"#8b5cf6",600:"#7c3aed",700:"#6d28d9",800:"#5b21b6",900:"#4c1d95",950:"#2e1065" },
  cyan:    { 50:"#ecfeff",100:"#cffafe",200:"#a5f3fc",300:"#67e8f9",400:"#22d3ee",500:"#06b6d4",600:"#0891b2",700:"#0e7490",800:"#155e75",900:"#164e63",950:"#083344" },
  red:     { 50:"#fef2f2",100:"#fee2e2",200:"#fecaca",300:"#fca5a5",400:"#f87171",500:"#ef4444",600:"#dc2626",700:"#b91c1c",800:"#991b1b",900:"#7f1d1d",950:"#450a0a" },
  green:   { 500:"#22c55e", 600:"#16a34a" },
};

const NEUTRALS = ["zinc", "slate", "neutral", "stone", "gray"];
const ACCENTS = [
  { key: "blue",   label: "Blue",   note: "trust, engineering" },
  { key: "orange", label: "Orange", note: "energy, warmth" },
  { key: "lime",   label: "Lime",   note: "electric, terminal" },
  { key: "violet", label: "Violet", note: "current brand" },
  { key: "cyan",   label: "Cyan",   note: "current brand" },
];
const SHADES = ["400", "500", "600"];

const SANS_FONTS = ["Geist", "Inter", "Manrope", "Sora", "Space Grotesk", "Plus Jakarta Sans", "DM Sans", "Outfit", "IBM Plex Sans"];
const MONO_FONTS = ["Geist Mono", "JetBrains Mono", "Fira Code", "IBM Plex Mono", "Space Mono"];

const RADII = [
  { key: "0",     label: "None · 0" },
  { key: "0.25",  label: "Subtle · 0.25rem" },
  { key: "0.5",   label: "Default · 0.5rem" },
  { key: "0.75",  label: "Round · 0.75rem" },
  { key: "1",     label: "Pill-ish · 1rem" },
];
const DENSITIES = [
  { key: "compact", label: "Compact",  h: 32, px: 12, fs: 13, gap: 12, pad: 16 },
  { key: "default", label: "Default",  h: 36, px: 16, fs: 14, gap: 16, pad: 24 },
  { key: "relaxed", label: "Relaxed",  h: 42, px: 20, fs: 15, gap: 20, pad: 32 },
];
const TYPE_SCALES = [
  { key: "1.2",   label: "Compact · 1.2" },
  { key: "1.25",  label: "Balanced · 1.25" },
  { key: "1.333", label: "Display · 1.333" },
];

/* ---------- state ---------- */
/* The chosen system (see /DESIGN.md): lime-400 on zinc, Geist + Geist Mono,
   shadcn-standard radius and density. */
const DS_DEFAULTS = {
  neutral: "zinc", accent: "lime", shade: "400",
  fontHeading: "Geist", fontBody: "Geist", fontMono: "Geist Mono",
  radius: "0.5", density: "default", scale: "1.25",
};
let DS = loadDS();

function loadDS() {
  try {
    const raw = JSON.parse(localStorage.getItem("lefa-ds") || "{}");
    return Object.assign({}, DS_DEFAULTS, raw);
  } catch (_) { return Object.assign({}, DS_DEFAULTS); }
}
function saveDS(patch) {
  Object.assign(DS, patch);
  try { localStorage.setItem("lefa-ds", JSON.stringify(DS)); } catch (_) {}
  applyTokens();
  document.dispatchEvent(new CustomEvent("ds-change"));
}

/* ---------- tokens ---------- */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function fgFor(hex) { return luminance(hex) > 0.35 ? TW.zinc[950] : "#ffffff"; }

function applyTokens() {
  const N = TW[DS.neutral], A = TW[DS.accent];
  const d = DENSITIES.find((x) => x.key === DS.density) || DENSITIES[1];
  const shade = parseInt(DS.shade, 10);
  const hover = A[Math.max(shade - 100, 300)];
  const active = A[Math.min(shade + 100, 700)];
  const r = document.documentElement.style;
  const set = (k, v) => r.setProperty(k, v);

  set("--background", N[950]);
  set("--foreground", N[50]);
  set("--card", N[900]);
  set("--card-foreground", N[50]);
  set("--popover", N[900]);
  set("--secondary", N[800]);
  set("--secondary-foreground", N[100]);
  set("--muted", N[800]);
  set("--muted-foreground", N[400]);
  set("--faint", N[500]);
  set("--border", N[800]);
  set("--input", N[700]);
  set("--primary", A[shade]);
  set("--primary-foreground", fgFor(A[shade]));
  set("--primary-hover", hover);
  set("--primary-active", active);
  set("--primary-soft", A[shade] + "1f");
  set("--ring", A[500]);
  set("--destructive", TW.red[500]);
  set("--destructive-foreground", "#ffffff");
  set("--success", TW.green[500]);
  set("--radius", DS.radius + "rem");
  set("--radius-lg", (parseFloat(DS.radius) * 1.5) + "rem");
  set("--ctl-h", d.h + "px");
  set("--ctl-px", d.px + "px");
  set("--fs", d.fs + "px");
  set("--gap", d.gap + "px");
  set("--pad", d.pad + "px");
  set("--font-heading", '"' + DS.fontHeading + '", system-ui, sans-serif');
  set("--font-body", '"' + DS.fontBody + '", system-ui, sans-serif');
  set("--font-mono", '"' + DS.fontMono + '", ui-monospace, monospace');
  set("--scale", DS.scale);
}

/* ---------- shared chrome ---------- */
const DS_PAGES = [
  { file: "index.html", label: "Overview" },
  { file: "colors.html", label: "Colors" },
  { file: "type.html", label: "Typography" },
  { file: "spacing.html", label: "Spacing & radius" },
  { file: "components.html", label: "Components" },
];

function dsNav(activeFile) {
  const nav = document.createElement("nav");
  nav.className = "ds-nav";
  nav.innerHTML =
    '<a class="ds-brand" href="index.html">' +
    '<svg width="20" height="20" viewBox="0 0 48 48" fill="none">' +
    '<g stroke="currentColor" stroke-width="3" stroke-linejoin="round">' +
    '<polygon points="24,6 41.119,18.438 34.58,38.562 13.42,38.562 6.881,18.438"/></g>' +
    '<circle cx="24" cy="24" r="4.5" fill="currentColor"/></svg>' +
    "<span>Lefa <em>design system</em></span></a>" +
    '<div class="ds-links">' +
    DS_PAGES.map((p) =>
      '<a href="' + p.file + '"' + (p.file === activeFile ? ' class="on"' : "") + ">" + p.label + "</a>"
    ).join("") +
    "</div>" +
    '<div class="ds-chips" id="ds-chips"></div>';
  document.body.prepend(nav);
  renderChips();
}

function renderChips() {
  const el = document.getElementById("ds-chips");
  if (!el) return;
  el.innerHTML =
    '<span class="chip"><i class="sw" style="background:' + TW[DS.accent][DS.shade] + '"></i>' + DS.accent + "-" + DS.shade + "</span>" +
    '<span class="chip">' + DS.neutral + "</span>" +
    '<span class="chip">' + DS.fontHeading + (DS.fontBody !== DS.fontHeading ? " / " + DS.fontBody : "") + "</span>" +
    '<span class="chip">r ' + parseFloat(DS.radius) + "rem</span>" +
    '<span class="chip">' + DS.density + "</span>";
}

/* option card grid helper: opts = [{key,label,note,swatch,font}] */
function optionGrid(container, opts, isActive, onPick, big) {
  container.innerHTML = "";
  opts.forEach((o) => {
    const b = document.createElement("button");
    b.className = "opt" + (big ? " big" : "") + (isActive(o.key) ? " active" : "");
    b.innerHTML =
      (o.swatch ? '<span class="sw-row">' + o.swatch + "</span>" : "") +
      '<span class="opt-label"' + (o.font ? ' style="font-family:\'' + o.font + '\'"' : "") + ">" + o.label + "</span>" +
      (o.note ? '<span class="opt-note">' + o.note + "</span>" : "");
    b.addEventListener("click", () => onPick(o.key));
    container.appendChild(b);
  });
}

/* representative component strip, reused on picker pages */
function previewStrip() {
  return (
    '<div class="prev-grid">' +
    '<div class="card"><div class="card-h"><h3>Create workspace</h3><p class="muted">Deploy a Lefa agent to your machine.</p></div>' +
    '<div class="card-b">' +
    '<label class="label" for="pv-name">Machine name</label>' +
    '<input class="input" id="pv-name" placeholder="dev-box-01" />' +
    '<label class="label" style="margin-top:var(--gap)" for="pv-email">Email</label>' +
    '<input class="input" id="pv-email" placeholder="you@company.com" />' +
    "</div>" +
    '<div class="card-f"><button class="btn btn-ghost">Cancel</button><button class="btn btn-primary">Deploy agent</button></div></div>' +
    "<div>" +
    '<div class="row"><button class="btn btn-primary">Primary</button><button class="btn btn-secondary">Secondary</button><button class="btn btn-outline">Outline</button><button class="btn btn-ghost">Ghost</button><button class="btn btn-destructive">Delete</button></div>' +
    '<div class="row" style="margin-top:var(--gap)"><span class="badge badge-primary">Running</span><span class="badge badge-secondary">Queued</span><span class="badge badge-outline">v0.1.0</span><span class="badge badge-soft">wayland</span></div>' +
    '<div class="row" style="margin-top:var(--gap)">' +
    '<label class="switch"><input type="checkbox" checked><i></i><span>Screenshots</span></label>' +
    '<label class="switch"><input type="checkbox"><i></i><span>Telemetry</span></label>' +
    "</div>" +
    '<div class="tabs" style="margin-top:var(--gap)"><button class="tab on">Agents</button><button class="tab">Sessions</button><button class="tab">Logs</button></div>' +
    '<div class="alert" style="margin-top:var(--gap)"><b>lefad connected.</b><span class="muted"> Session wayland · a11y tree ready · 214 elements.</span></div>' +
    "</div></div>"
  );
}

/* boot */
applyTokens();
document.addEventListener("ds-change", renderChips);
