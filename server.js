// Servidor de la web d'ALKA.
//
// Fa dues coses: serveix les pagines estatiques de public/ i rep els
// formularis d'alta de soci i de voluntariat, que desa a Notion.
//
// Nomes fa servir moduls natius de Node: no hi ha dependencies a instal.lar.
//
// Variables d'entorn:
//   NOTION_TOKEN         (obligatoria) secret de la integracio de Notion
//   NOTION_DB_SOCIS      (obligatoria) id de la base "Socis ALKA"
//   NOTION_DB_VOLUNTARIS (obligatoria) id de la base "Voluntaris ALKA"
//   PORT                 (opcional)    per defecte 3000
//
// Aquest repositori es public: els identificadors de les bases de dades
// viuen a la configuracio del servidor, no al codi.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 3000;

const NOTION_API = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2022-06-28";

const DB = {
  soci: process.env.NOTION_DB_SOCIS,
  voluntari: process.env.NOTION_DB_VOLUNTARIS,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// ---------------------------------------------------------------- Notion

const text = (v) => (v ? { rich_text: [{ text: { content: String(v).slice(0, 2000) } }] } : undefined);
const title = (v) => ({ title: [{ text: { content: String(v || "Sense nom").slice(0, 200) } }] });
const select = (v) => (v ? { select: { name: String(v) } } : undefined);

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export function buildProperties(tipus, f) {
  const comu = {
    "Nom i cognoms": title(f.nom),
    "Correu electronic": f.email ? { email: f.email } : undefined,
    "Telefon": f.telefon ? { phone_number: f.telefon } : undefined,
    "Poblacio": text(f.poblacio),
    "Consentiment": { checkbox: f.consentiment === "on" || f.consentiment === "true" },
    "Estat": select("Nova sollicitud"),
    "Idioma": select(String(f.idioma || "ca").toUpperCase()),
  };

  // ser soci no te cap cost: el formulari no demana quota ni dades bancaries
  if (tipus === "soci") {
    return clean({
      ...comu,
      "Com ens ha conegut": text(f.com_ens_has_conegut),
      "Comentaris": text(f.comentaris),
    });
  }

  const arees = [].concat(f.arees || []).filter(Boolean);
  return clean({
    ...comu,
    "Interessos": arees.length ? { multi_select: arees.map((name) => ({ name })) } : undefined,
    "Disponibilitat": select(f.disponibilitat),
    "Sobre tu": text(f.sobre_tu),
  });
}

async function saveToNotion(tipus, fields) {
  const r = await fetch(NOTION_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: DB[tipus] },
      properties: buildProperties(tipus, fields),
    }),
  });
  if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
}

// ---------------------------------------------------------------- respostes

function pagina(titol, missatge) {
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titol} · ALKA</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#E9E4D8;font-family:system-ui,sans-serif;color:#1d2f46;padding:24px}
.c{background:#FDFBF7;border-radius:28px;padding:48px 40px;max-width:460px;text-align:center;
box-shadow:0 0 0 1px rgba(29,47,70,.06)}h1{font-size:26px;margin:0 0 12px}
p{font-size:15px;line-height:1.7;opacity:.75;margin:0 0 28px}
a{display:inline-block;background:#b74f49;color:#FDFBF7;text-decoration:none;padding:14px 30px;
border-radius:999px;font-weight:700;font-size:14.5px}</style></head>
<body><div class="c"><h1>${titol}</h1><p>${missatge}</p>
<a href="/">Tornar a l'inici</a></div></body></html>`;
}

function send(res, code, body, type = "text/html; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
}

// ---------------------------------------------------------------- formulari

// Un endpoint public es un iman per als robots d'spam: limitem per IP.
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const recents = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recents.push(now);
  hits.set(ip, recents);
  if (hits.size > 5000) hits.clear();
  return recents.length > MAX_PER_WINDOW;
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("massa gran")); req.destroy(); return; }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

function parseForm(raw) {
  const params = new URLSearchParams(raw);
  const out = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

async function handleInscripcio(req, res) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress || "?";
  if (rateLimited(ip)) {
    return send(res, 429, pagina("Massa intents",
      "Has enviat el formulari diverses vegades seguides. Espera uns minuts o escriu-nos a labas@alka.cat."));
  }

  let f;
  try {
    f = parseForm(await readBody(req));
  } catch {
    return send(res, 413, pagina("Sol·licitud massa gran", "Escurça el text i torna-ho a provar."));
  }

  // camp trampa: invisible per a les persones, els robots l'omplen
  if (f.lloc_web) return send(res, 200, pagina("Gràcies!", "Hem rebut la teva sol·licitud."));

  const tipus = f.tipus === "voluntari" ? "voluntari" : "soci";

  // el navegador es pot saltar el required, per aixo ho tornem a comprovar aqui
  if (!f.nom || !f.email || !String(f.email).includes("@")) {
    return send(res, 400, pagina("Falten dades", "Cal indicar el nom i un correu electrònic vàlid."));
  }
  if (!process.env.NOTION_TOKEN || !DB[tipus]) {
    console.error("falta NOTION_TOKEN o l'id de la base de dades");
    return send(res, 500, pagina("Error de configuració",
      "El formulari encara no està connectat. Escriu-nos a labas@alka.cat."));
  }

  try {
    await saveToNotion(tipus, f);
  } catch (e) {
    console.error("inscripcio:", e.message);
    return send(res, 502, pagina("No s'ha pogut desar",
      "Hi ha hagut un problema tècnic. Escriu-nos a labas@alka.cat i ho resolem."));
  }

  const missatge = tipus === "soci"
    ? "Hem rebut la teva sol·licitud. Ens posarem en contacte amb tu per confirmar l'alta."
    : "Hem rebut la teva sol·licitud. Ens posarem en contacte amb tu per conèixer-te i explicar-te les activitats.";
  return send(res, 200, pagina("Gràcies!", missatge));
}

// ---------------------------------------------------------------- estatics

function resolveFile(pathname) {
  // /cultura -> public/cultura.html, / -> public/index.html, /lt/ -> public/lt/index.html
  const decoded = decodeURIComponent(pathname);
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidates = [];
  if (safe.endsWith("/")) {
    candidates.push(path.join(ROOT, safe, "index.html"));
  } else {
    candidates.push(path.join(ROOT, safe));
    candidates.push(path.join(ROOT, safe + ".html"));
    candidates.push(path.join(ROOT, safe, "index.html"));
  }
  for (const c of candidates) {
    // mai servim res de fora de public/
    if (!c.startsWith(ROOT)) continue;
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* no existeix, provem el seguent */ }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/inscripcio") {
    if (req.method !== "POST") return send(res, 405, "Method not allowed", "text/plain");
    return handleInscripcio(req, res);
  }
  if (url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed", "text/plain");
  }

  const file = resolveFile(url.pathname);
  if (!file) {
    return send(res, 404, pagina("Pàgina no trobada",
      "L'adreça que has seguit no existeix o ha canviat."));
  }

  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === ".html";
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`ALKA escoltant al port ${PORT}`);
  const falten = ["NOTION_TOKEN", "NOTION_DB_SOCIS", "NOTION_DB_VOLUNTARIS"]
    .filter((v) => !process.env[v]);
  if (falten.length) console.warn(`AVIS: falta ${falten.join(", ")}; els formularis fallaran`);
});
