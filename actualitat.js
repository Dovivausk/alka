// Pagina /actualitat: llegeix de Notion les entrades publicades i les mostra
// amb la capcalera i el peu de la resta del web.
//
// Viu fora de public/ a proposit: public/ es genera des del projecte de disseny
// i un nou build el sobreescriuria. Aqui nomes hi ha codi del servidor.
//
// Variables d'entorn:
//   NOTION_TOKEN          (la mateixa dels formularis; la base ha d'estar compartida amb aquesta integracio)
//   NOTION_DB_ACTUALITAT  id de la base "Actualitat" (no va al codi: el repositori es public)
//
// Nomes es mostren les files amb Estat = "Publicat" i "Enllac mort" sense marcar.
// Si Notion falla es serveix l'ultima copia bona; si no n'hi ha, la pagina surt buida.

import fs from "node:fs";
import path from "node:path";

const NOTION_VERSION = "2022-06-28";
const TTL_MS = 15 * 60 * 1000;

let cache = { at: 0, items: null };
let inflight = null;

// ---------------------------------------------------------------- Notion

const plain = (arr) => (arr || []).map((t) => t.plain_text).join("").trim();

function toItem(page) {
  const p = page.properties || {};
  return {
    titol: plain(p["Títol"]?.title),
    resum: plain(p["Resum"]?.rich_text),
    tipus: p["Tipus"]?.select?.name || "",
    arees: (p["Àrea"]?.multi_select || []).map((o) => o.name),
    font: plain(p["Font"]?.rich_text),
    url: p["URL"]?.url || "",
    inici: p["Data"]?.date?.start || "",
    fi: p["Data"]?.date?.end || "",
    imatge: p["Imatge"]?.url || "",
    autorImatge: plain(p["Autor imatge"]?.rich_text),
    llicencia: plain(p["Llicència"]?.rich_text),
    fixat: Boolean(p["Fixat"]?.checkbox),
    creat: page.created_time || "",
  };
}

// Primer els fixats; despres la data mes recent; sense data al final.
function ordena(items) {
  return items.sort((a, b) => {
    if (a.fixat !== b.fixat) return a.fixat ? -1 : 1;
    const da = a.inici || "", db = b.inici || "";
    if (da !== db) return da < db ? 1 : -1;
    return a.creat < b.creat ? 1 : -1;
  });
}

export async function fetchPublished({
  estat = "Publicat",
  token = process.env.NOTION_TOKEN,
  dbId = process.env.NOTION_DB_ACTUALITAT,
} = {}) {
  if (!token || !dbId) return null;
  const out = [];
  let cursor;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          and: [
            { property: "Estat", select: { equals: estat } },
            { property: "Enllaç mort", checkbox: { equals: false } },
          ],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Notion ${r.status}`);
    const j = await r.json();
    out.push(...j.results.map(toItem).filter((x) => x.titol));
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return ordena(out);
}

async function getItems() {
  if (cache.items && Date.now() - cache.at < TTL_MS) return cache.items;
  if (!inflight) {
    inflight = fetchPublished()
      .then((items) => {
        if (items) cache = { at: Date.now(), items };
        return items;
      })
      .catch((e) => {
        console.error("actualitat:", e.message);
        // ens quedem amb l'ultima copia bona, i tornem a provar d'aqui a poc
        if (cache.items) cache.at = Date.now() - TTL_MS + 60 * 1000;
        return cache.items;
      })
      .finally(() => { inflight = null; });
  }
  return (await inflight) || [];
}

// ---------------------------------------------------------------- HTML

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Nomes enllacem http(s): res de javascript: ni data:
function safeUrl(u, httpsOnly = false) {
  try {
    const x = new URL(u);
    if (x.protocol === "https:" || (!httpsOnly && x.protocol === "http:")) return x.href;
  } catch { /* url no valida */ }
  return "";
}

const MESOS = ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost",
  "setembre", "octubre", "novembre", "desembre"];
const de = (m) => (/^[aeiou]/i.test(MESOS[m]) ? "d'" : "de ");

export function dataCa(inici, fi) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  };
  const a = p(inici), b = p(fi);
  if (!a) return "";
  if (b && (b.y !== a.y || b.m !== a.m || b.d !== a.d)) {
    if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${de(a.m)}${MESOS[a.m]} de ${a.y}`;
    return `${a.d} ${de(a.m)}${MESOS[a.m]} de ${a.y} – ${b.d} ${de(b.m)}${MESOS[b.m]} de ${b.y}`;
  }
  return `${a.d} ${de(a.m)}${MESOS[a.m]} de ${a.y}`;
}

function card(it) {
  const img = safeUrl(it.imatge, true);
  const link = safeUrl(it.url);
  const data = dataCa(it.inici, it.fi);
  const credit = img && (it.autorImatge || it.llicencia)
    ? `<div class="act-credit">Imatge: ${esc([it.autorImatge, it.llicencia].filter(Boolean).join(" · "))}</div>` : "";
  return `
        <article class="act-card" data-tipus="${esc(it.tipus)}">
          ${img ? `<img class="act-img" src="${esc(img)}" alt="" loading="lazy">` : ""}
          <div class="act-meta">
            ${it.tipus ? `<span class="act-tag${it.tipus === "Agenda" ? " act-tag-agenda" : ""}">${esc(it.tipus)}</span>` : ""}
            ${data ? `<span class="act-date">${esc(data)}</span>` : ""}
          </div>
          <h3>${esc(it.titol)}</h3>
          ${it.resum ? `<p>${esc(it.resum)}</p>` : ""}
          ${it.arees.length ? `<div class="act-areas">${esc(it.arees.join(" · "))}</div>` : ""}
          <div class="act-foot">
            ${it.font ? `<span class="act-font">${esc(it.font)}</span>` : "<span></span>"}
            ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Llegeix a la font &rarr;</a>` : ""}
          </div>
          ${credit}
        </article>`;
}

const CSS = `
  .act-wrap { padding:0 64px 96px 64px; }
  .act-inner { max-width:1200px; margin:0 auto; }
  .act-head { padding:32px 64px 8px 64px; }
  .act-head .eyebrow { font-size:12.5px; letter-spacing:.22em; font-weight:700; color:#976524; text-transform:uppercase; margin-bottom:16px; }
  .act-head h1 { font-size:42px; font-weight:800; color:#1d2f46; margin:0 0 10px 0; }
  .act-head .lead { font-size:16px; line-height:1.7; color:#1d1d1b; opacity:.72; max-width:560px; margin:0; }
  .act-chips { display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 8px 0; }
  .act-chip { font:inherit; font-size:13.5px; font-weight:600; color:#1d2f46; background:#fff; border:1.5px solid rgba(29,47,70,.18); border-radius:999px; padding:8px 16px; cursor:pointer; }
  .act-chip[aria-pressed="true"] { background:#1d2f46; color:#FDFBF7; border-color:#1d2f46; }
  .act-chip:focus-visible, .act-card a:focus-visible { outline:3px solid #976524; outline-offset:2px; }
  .act-sec h2 { font-size:22px; font-weight:800; color:#1d2f46; margin:36px 0 18px 0; }
  .act-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:24px; }
  .act-card { background:#fff; border:1px solid rgba(29,47,70,.08); border-radius:20px; padding:24px; display:flex; flex-direction:column; gap:10px; }
  .act-card[hidden], .act-sec[hidden] { display:none !important; }
  .act-img { width:100%; aspect-ratio:16/10; object-fit:cover; border-radius:12px; }
  .act-meta { display:flex; flex-wrap:wrap; align-items:center; gap:10px; font-size:12.5px; color:#1d1d1b; opacity:.85; }
  .act-tag { font-weight:700; letter-spacing:.06em; text-transform:uppercase; font-size:11.5px; color:#976524; background:rgba(151,101,36,.14); border-radius:999px; padding:4px 10px; }
  .act-tag-agenda { color:#b74f49; background:rgba(183,79,73,.12); }
  .act-card h3 { font-size:18px; line-height:1.35; font-weight:700; color:#1d2f46; margin:0; }
  .act-card p { font-size:14px; line-height:1.65; opacity:.75; margin:0; }
  .act-areas { font-size:12.5px; font-weight:600; color:#976524; }
  .act-foot { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-top:auto; padding-top:8px; font-size:13px; }
  .act-font { opacity:.6; }
  .act-foot a { color:#b74f49; font-weight:700; text-align:right; }
  .act-credit { font-size:11.5px; opacity:.55; }
  .act-empty { background:rgba(151,101,36,.09); border-radius:28px; padding:48px 40px; margin-top:32px; }
  .act-empty h2 { margin:0 0 8px 0; font-size:22px; color:#1d2f46; }
  .act-empty p { margin:0; opacity:.75; line-height:1.7; }
  @media (max-width: 900px) {
    .act-head { padding:24px 20px 0 20px; }
    .act-head h1 { font-size:34px; }
    .act-wrap { padding:0 20px 64px 20px; }
    .act-grid { grid-template-columns:repeat(2, minmax(0,1fr)); }
  }
  @media (max-width: 560px) { .act-grid { grid-template-columns:1fr; } }
`;

const SCRIPT = `
  (function () {
    var chips = document.querySelectorAll('.act-chip');
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-t');
        chips.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        document.querySelectorAll('.act-card').forEach(function (c) {
          c.hidden = t !== '*' && c.getAttribute('data-tipus') !== t;
        });
        document.querySelectorAll('.act-sec').forEach(function (s) {
          s.hidden = !s.querySelector('.act-card:not([hidden])');
        });
      });
    });
  })();
`;

function mainHtml(items) {
  const fixats = items.filter((i) => i.fixat);
  const resta = items.filter((i) => !i.fixat);
  const tipus = [...new Set(items.map((i) => i.tipus).filter(Boolean))];

  const head = `
  <div style="padding:20px 64px 0 64px;" class="act-back">
    <a href="/" style="display:inline-flex; align-items:center; gap:6px; font-size:13.5px; font-weight:600; color:#1d2f46; opacity:.6;">&larr; Tornar a l'inici</a>
  </div>
  <div class="act-head">
    <div class="eyebrow">Actualitat</div>
    <h1>Actualitat</h1>
    <p class="lead">Novetats d'ALKA i una mirada a Lit&uacute;ania en catal&agrave;: agenda, premsa, art i cultura.</p>
  </div>`;

  if (!items.length) {
    return `<style>${CSS}</style>${head}
  <div class="act-wrap"><div class="act-inner">
    <div class="act-empty">
      <h2>Aviat hi haur&agrave; novetats</h2>
      <p>Encara no hi ha res publicat. Torna d'aqu&iacute; uns dies o escriu-nos a
      <a href="mailto:labas@alka.cat" style="color:#b74f49; font-weight:700;">labas@alka.cat</a>.</p>
    </div>
  </div></div>`;
  }

  const chips = tipus.length > 1
    ? `<div class="act-chips" role="group" aria-label="Filtra per tipus">
        <button type="button" class="act-chip" data-t="*" aria-pressed="true">Tot</button>
        ${tipus.map((t) => `<button type="button" class="act-chip" data-t="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("\n        ")}
      </div>` : "";

  const section = (titol, list) => list.length ? `
    <section class="act-sec">
      <h2>${titol}</h2>
      <div class="act-grid">${list.map(card).join("")}
      </div>
    </section>` : "";

  return `<style>${CSS}</style>${head}
  <div class="act-wrap"><div class="act-inner">
    ${chips}
    ${section("Destacat", fixats)}
    ${section(fixats.length ? "M&eacute;s recent" : "Novetats", resta)}
  </div></div>
  ${tipus.length > 1 ? `<script>${SCRIPT}</script>` : ""}`;
}

// ---------------------------------------------------------------- pagina

// Aprofitem la capcalera i el peu d'una pagina ja generada (educacio.html) i
// n'hi canviem el cos. Si el disseny canvia i no trobem les marques, caiem en
// una pagina senzilla en lloc de trencar-nos.
export async function renderActualitat(publicDir) {
  const items = await getItems();
  const body = mainHtml(items);

  let shell = "";
  try { shell = fs.readFileSync(path.join(publicDir, "educacio.html"), "utf8"); } catch { /* sense plantilla */ }
  const i = shell.indexOf("<!-- BREADCRUMB -->");
  const f = shell.indexOf('<footer id="contacte"');
  if (i < 0 || f < i) {
    return `<!doctype html><html lang="ca"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Actualitat - ALKA</title>
<meta name="robots" content="noindex, nofollow"></head>
<body style="margin:0;background:#FDFBF7;font-family:system-ui,sans-serif;color:#1d1d1b">${body}</body></html>`;
  }
  return (shell.slice(0, i) + body + "\n  " + shell.slice(f))
    .replace("<title>Educacio - ALKA</title>", "<title>Actualitat - ALKA</title>")
    .replace('href="/educacio" class="lang-current"', 'href="/actualitat" class="lang-current"')
    .replace('href="/lt/educacio"', 'href="/lt/"')
    .replace('href="/en/educacio"', 'href="/en/"');
}

// El menu de totes les pagines (CA, LT, EN) apuntava a un ancora que no existeix.
// Ara van a /actualitat, que nomes existeix en catala.
export function fixActualitatLinks(html) {
  return html.replace(/href="(?:\/(?:(?:lt|en)\/)?)?#actualitat"/g, 'href="/actualitat"');
}
