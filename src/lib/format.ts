const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtDateHeure = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtNombre = new Intl.NumberFormat("fr-FR");

export function formatHeure(ms: number) {
  const d = new Date(ms);
  const auj = new Date();
  const memeJour = d.toDateString() === auj.toDateString();
  return memeJour ? fmtHeure.format(d) : fmtDateHeure.format(d);
}

export function formatNombre(n: number) {
  return fmtNombre.format(n);
}

export function formatDureeRelative(msCible: number, maintenant = Date.now()) {
  const s = Math.max(0, Math.round((msCible - maintenant) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h} h ${reste.toString().padStart(2, "0")}` : `${h} h`;
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 10_000) return `${Math.round(n / 1000)} k`;
  return fmtNombre.format(n);
}

/** « il y a 5 min », « il y a 2 h », « hier », « il y a 3 j » (instant passé). */
export function formatDepuis(msPasse: number, maintenant = Date.now()) {
  const s = Math.max(0, Math.round((maintenant - msPasse) / 1000));
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? "hier" : `il y a ${j} j`;
}
