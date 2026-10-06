// Viatge a Lituania - mini-app de la web d'ALKA.
//
// Pagina estatica: llegeix data/punts.json i el mostra sobre un mapa de
// MapLibre (teseles d'OpenFreeMap, sense clau). Tot el text visible surt de
// js/i18n.js o del JSON, triat segons l'atribut lang de l'<html>.
//
// Modes:
//   explora     filtres + llista + fitxa del punt triat
//   recorregut  parades ordenades (camp "recorregut" del JSON) amb Anterior / Seguent
//
// Enllacos directes: /viatge-lituania#punt=trakai   /viatge-lituania#recorregut=3

(() => {
  "use strict";

  const LANG = document.documentElement.lang || "ca";
  const T = window.VL_I18N[LANG] || window.VL_I18N.ca;
  const tx = (o) => (o ? (o[LANG] ?? o.ca ?? "") : "");

  const DATA_URL = "/viatge-lituania/data/punts.json?v=2";
  const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  const LLEIDA = [0.6268, 41.6148]; // OSM, municipi de Lleida
  const LITUANIA = [[20.9, 53.85], [26.85, 56.45]];
  const INTRO_MS = 6500;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  const $ = (id) => document.getElementById(id);
  const ui = {
    main: $("viatge"),
    filters: $("vl-filters"),
    count: $("vl-count"),
    list: $("vl-llista"),
    panel: $("vl-panel"),
    mapEl: $("vl-map"),
    intro: $("vl-intro"),
    introText: $("vl-intro-text"),
    introSkip: $("vl-intro-skip"),
    reset: $("vl-reset"),
    mapError: $("vl-maperror"),
    fs: $("vl-fs"),
    modes: document.querySelectorAll(".vl-mode"),
  };

  const state = {
    punts: [],
    byId: new Map(),
    cats: [],
    catById: new Map(),
    actives: new Set(),
    tour: [],
    mode: "explora",
    selId: null,
    tourIdx: 0,
    map: null,
    dataReady: false,
    styleReady: false,
    layersReady: false,
    intro: false,
  };

  // ------------------------------------------------------------ utilitats

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svg(paths, size = 16) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const d of [].concat(paths)) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      s.append(p);
    }
    return s;
  }

  const ICONA = {
    ciutats: ["M4 21V9l5-3v15", "M9 21V4l7 4v13", "M16 21v-9l4 2v7", "M2 21h20"],
    llocs: ["M4 21V10l3-2 2 2 3-3 3 3 2-2 3 2v11z", "M10 21v-5h4v5"],
    gastronomia: ["M7 3v8a2 2 0 0 0 2 2v8", "M11 3v8a2 2 0 0 1-2 2", "M17 3c-2 2-2 6 0 8v10"],
    tradicions: ["M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.3l5-.7z"],
  };
  const ICONA_LLOC = ["M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z", "M12 12.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"];
  const ICONA_TANCA = ["M6 6l12 12", "M18 6L6 18"];

  const catColor = (id) => state.catById.get(id)?.color || "#1d2f46";

  function distKm([lon1, lat1], [lon2, lat2]) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }

  // zoom per veure el punt. A explora, mes a prop si en te d'altres a pocs km
  // (centre de Vilnius) perque el grup es desfaci; al recorregut no hi ha grups
  function zoomFor(p) {
    const veins = state.mode === "explora" && state.punts.some((q) => q !== p && distKm(p.coords, q.coords) < 3);
    if (veins) return 14;
    return p.categoria === "ciutats" ? 11 : 12;
  }

  // ------------------------------------------------------------ dades

  async function loadData() {
    const r = await fetch(DATA_URL);
    if (!r.ok) throw new Error(`punts.json ${r.status}`);
    const d = await r.json();
    state.cats = d.categories;
    for (const c of d.categories) state.catById.set(c.id, c);
    const ordre = new Map(d.categories.map((c, i) => [c.id, i]));
    state.punts = d.punts
      .filter((p) => state.catById.has(p.categoria))
      .sort((a, b) => ordre.get(a.categoria) - ordre.get(b.categoria) || tx(a.nom).localeCompare(tx(b.nom), LANG));
    for (const p of state.punts) state.byId.set(p.id, p);
    state.tour = state.punts.filter((p) => Number.isInteger(p.recorregut)).sort((a, b) => a.recorregut - b.recorregut);
    state.actives = new Set(state.cats.map((c) => c.id));
    state.dataReady = true;
  }

  const visibles = () => state.punts.filter((p) => state.actives.has(p.categoria));

  function featureCollection(punts) {
    return {
      type: "FeatureCollection",
      features: punts.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: p.coords },
        properties: { id: p.id, nom: tx(p.nom), categoria: p.categoria, color: catColor(p.categoria), n: p.recorregut || 0 },
      })),
    };
  }

  // ------------------------------------------------------------ filtres i llista

  function renderFilters() {
    ui.filters.replaceChildren(...state.cats.map((c) => h("button", {
      type: "button",
      class: "vl-chip",
      style: `--vl-cat:${c.color}`,
      "aria-pressed": String(state.actives.has(c.id)),
      onclick: () => toggleCat(c.id),
    }, tx(c.nom))));
  }

  function toggleCat(id) {
    if (state.actives.has(id)) state.actives.delete(id);
    else state.actives.add(id);
    renderFilters();
    // el boto s'ha regenerat: tornem-hi el focus
    ui.filters.querySelectorAll(".vl-chip")[state.cats.findIndex((c) => c.id === id)]?.focus();
    if (state.selId && !state.actives.has(state.byId.get(state.selId).categoria)) deselect();
    renderList();
    updateMapData();
  }

  function renderList() {
    const tour = state.mode === "recorregut";
    const punts = tour ? state.tour : visibles();
    ui.filters.hidden = tour;
    ui.count.textContent = tour ? T.parada(state.tourIdx + 1, state.tour.length) : T.compte(punts.length);

    if (!punts.length) {
      ui.list.replaceChildren(h("li", { class: "vl-empty" }, T.capPunt));
      return;
    }
    ui.list.replaceChildren(...punts.map((p, i) => h("li", {},
      h("button", {
        type: "button",
        class: "vl-item",
        "data-id": p.id,
        "aria-current": p.id === state.selId ? "true" : null,
        onclick: () => (tour ? goStop(i) : select(p.id)),
      },
      h("span", { class: "vl-dot", style: `--vl-cat:${catColor(p.categoria)}`, "aria-hidden": "true" },
        tour ? String(p.recorregut) : svg(ICONA[p.categoria] || ICONA.llocs)),
      h("span", { class: "vl-item-text" },
        h("span", { class: "vl-item-nom" }, tx(p.nom)),
        h("span", { class: "vl-item-lloc" }, `${tx(state.catById.get(p.categoria).nom)} · ${tx(p.lloc)}`)),
      ))));
  }

  function markCurrent() {
    for (const b of ui.list.querySelectorAll(".vl-item")) {
      if (b.dataset.id === state.selId) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
  }

  // fletxes amunt/avall per moure's per la llista
  ui.list.addEventListener("keydown", (e) => {
    const items = [...ui.list.querySelectorAll(".vl-item")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowDown") j = Math.min(i + 1, items.length - 1);
    else if (e.key === "ArrowUp") j = Math.max(i - 1, 0);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = items.length - 1;
    if (j === null) return;
    e.preventDefault();
    items[j].focus();
  });

  // ------------------------------------------------------------ fitxa

  function fotoFigure(p) {
    const f = p.foto;
    if (!f || !f.url) return h("div", { class: "vl-photo vl-photo-empty" }, T.senseFoto);
    // la imatge nomes es crea quan s'obre la fitxa: carrega diferida per disseny
    return h("figure", { class: "vl-photo" },
      h("img", { src: f.url, alt: "", width: f.amplada, height: f.alcada, loading: "lazy", decoding: "async" }));
  }

  function credit(f) {
    if (!f || !f.url) return null;
    const llicencia = f.llicencia_url ? h("a", { href: f.llicencia_url, target: "_blank", rel: "noopener" }, f.llicencia) : f.llicencia;
    return h("p", { class: "vl-credit" },
      `${T.foto}: ${f.autor} · `, llicencia, " · ",
      h("a", { href: f.font, target: "_blank", rel: "noopener" }, "Wikimedia Commons"));
  }

  function fitxa(p) {
    return [
      h("h2", { id: "vl-panel-title" }, tx(p.nom)),
      h("p", { class: "vl-lloc" }, svg(ICONA_LLOC), tx(p.lloc)),
      p.data ? h("p", { class: "vl-data" },
        h("span", { class: "vl-data-label" }, p.data.tipus === "mobil" ? T.dataMobil : T.data),
        h("span", { class: "vl-data-text" }, tx(p.data.text))) : null,
      h("p", { class: "vl-desc" }, tx(p.descripcio)),
      p.ubicacioOrientativa ? h("p", { class: "vl-note" }, T.orientativa) : null,
      credit(p.foto),
    ].filter(Boolean);
  }

  function tag(p) {
    return h("span", { class: "vl-tag", style: `--vl-cat:${catColor(p.categoria)}` }, tx(state.catById.get(p.categoria).nom));
  }

  function renderPanel() {
    ui.panel.hidden = false;
    if (state.mode === "recorregut") return renderTourPanel();

    const p = state.byId.get(state.selId);
    if (!p) {
      // res triat: a l'ordinador mostrem la benvinguda; al mobil, amaguem el full
      ui.panel.hidden = isMobile();
      ui.panel.setAttribute("aria-label", T.benvingudaTitol);
      ui.panel.replaceChildren(h("div", { class: "vl-welcome" },
        h("h2", {}, T.benvingudaTitol),
        h("p", {}, T.benvingudaText),
        h("ul", { class: "vl-legend" }, state.cats.map((c) =>
          h("li", { style: `--vl-cat:${c.color}` }, h("span", { "aria-hidden": "true" }), tx(c.nom)))),
        h("button", { type: "button", class: "vl-btn vl-btn-red", onclick: () => setMode("recorregut") }, T.benvingudaRecorregut)));
      return;
    }

    ui.panel.setAttribute("aria-label", tx(p.nom));
    ui.panel.replaceChildren(
      fotoFigure(p),
      h("div", { class: "vl-panel-body" },
        h("div", { class: "vl-panel-top" },
          tag(p),
          h("button", { type: "button", class: "vl-iconbtn vl-close", "aria-label": T.tanca, onclick: () => deselect(true) }, svg(ICONA_TANCA, 18))),
        ...fitxa(p)));
  }

  function renderTourPanel() {
    const n = state.tour.length;
    const i = state.tourIdx;
    const p = state.tour[i];
    const last = i === n - 1;
    ui.panel.setAttribute("aria-label", T.parada(i + 1, n));
    ui.panel.replaceChildren(
      h("div", { class: "vl-tour-head" },
        h("p", { class: "vl-tour-step", "aria-live": "polite" }, T.parada(i + 1, n)),
        h("div", { class: "vl-progress", "aria-hidden": "true" }, h("span", { style: `width:${((i + 1) / n) * 100}%` }))),
      fotoFigure(p),
      h("div", { class: "vl-panel-body" },
        h("div", { class: "vl-panel-top" }, tag(p)),
        ...fitxa(p),
        i === 0 ? h("p", { class: "vl-tour-hint" }, T.teclesRecorregut) : null),
      h("div", { class: "vl-tour-nav" },
        h("button", { type: "button", class: "vl-btn vl-btn-light", disabled: i === 0, onclick: () => goStop(i - 1) }, `← ${T.anterior}`),
        last
          ? h("button", { type: "button", class: "vl-btn vl-btn-red", onclick: () => goStop(0) }, T.tornaComencar)
          : h("button", { type: "button", class: "vl-btn vl-btn-dark", onclick: () => goStop(i + 1) }, `${T.seguent} →`)),
    );
    if (last) ui.panel.querySelector(".vl-tour-step").textContent = `${T.parada(i + 1, n)} · ${T.finalTitol}`;
    ui.panel.scrollTop = 0;
  }

  // ------------------------------------------------------------ seleccio i recorregut

  function select(id, { fly = true } = {}) {
    if (!state.byId.has(id)) return;
    state.selId = id;
    markCurrent();
    renderPanel();
    ui.panel.scrollTop = 0;
    updateSelection();
    setHash(`punt=${id}`);
    if (fly) flyToPunt(state.byId.get(id));
  }

  function deselect(returnFocus = false) {
    const prev = state.selId;
    state.selId = null;
    markCurrent();
    renderPanel();
    updateSelection();
    setHash("");
    if (returnFocus && prev) ui.list.querySelector(`[data-id="${prev}"]`)?.focus({ preventScroll: isMobile() });
  }

  function goStop(i) {
    if (!state.tour.length) return;
    state.tourIdx = Math.max(0, Math.min(i, state.tour.length - 1));
    const p = state.tour[state.tourIdx];
    state.selId = p.id;
    ui.count.textContent = T.parada(state.tourIdx + 1, state.tour.length);
    markCurrent();
    renderPanel();
    updateSelection();
    setHash(`recorregut=${state.tourIdx + 1}`);
    flyToPunt(p, true);
  }

  function setMode(mode, { stop = 0 } = {}) {
    state.mode = mode;
    ui.main.dataset.mode = mode;
    for (const b of ui.modes) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    updateLayerVisibility();
    if (mode === "recorregut") {
      renderList();
      goStop(stop);
    } else {
      state.selId = null;
      renderList();
      renderPanel();
      updateSelection();
      setHash("");
      fitLituania();
    }
  }

  for (const b of ui.modes) b.addEventListener("click", () => { if (b.dataset.mode !== state.mode) setMode(b.dataset.mode); });

  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t.closest && t.closest("input, textarea, select, .maplibregl-canvas, details")) return;
    if (state.intro && e.key === "Escape") return endIntro(true);
    if (state.mode === "recorregut") {
      // tambe PageUp/PageDown: es el que envien els comandaments de presentacions
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goStop(state.tourIdx + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goStop(state.tourIdx - 1); }
    } else if (e.key === "Escape" && state.selId) {
      deselect(true);
    }
  });

  // ------------------------------------------------------------ enllacos directes

  function setHash(v) {
    const url = v ? `#${v}` : location.pathname + location.search;
    history.replaceState(null, "", url);
  }

  function readHash() {
    const m = location.hash.match(/^#(punt|recorregut)(?:=([\w-]+))?$/);
    if (!m) return null;
    if (m[1] === "punt") return state.byId.has(m[2]) ? { punt: m[2] } : null;
    const n = parseInt(m[2] || "1", 10);
    return { recorregut: Number.isFinite(n) ? n - 1 : 0 };
  }

  // ------------------------------------------------------------ mapa

  function showMapError(msg) {
    ui.mapError.textContent = msg;
    ui.mapError.hidden = false;
    ui.intro.hidden = true;
    state.intro = false;
  }

  // ajusta l'estil d'OpenFreeMap: globus, atmosfera i noms en catala si n'hi ha
  function transformStyle(_prev, style) {
    style.projection = { type: "globe" };
    style.sky = {
      "sky-color": "#0f1b2b",
      "horizon-color": "#cfe1f2",
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    };
    const nom = ["coalesce", ["get", `name:${LANG}`], ["get", "name:latin"], ["get", "name"]];
    for (const l of style.layers) {
      if (!/^label_(country|state|city|town)/.test(l.id)) continue;
      l.layout = { ...l.layout, "text-field": nom };
      // a vista de pais, els noms de ciutat ja els posen els nostres punts
      if (/^label_(city|town)/.test(l.id)) l.minzoom = Math.max(l.minzoom || 0, 12);
    }
    return style;
  }

  function cameraLituania() {
    return state.map.cameraForBounds(LITUANIA, { padding: isMobile() ? 20 : 40 });
  }

  function fitLituania() {
    if (!state.map || state.intro) return;
    state.map.fitBounds(LITUANIA, { padding: isMobile() ? 20 : 40, duration: reduceMotion ? 0 : 1200 });
  }

  // al mobil: portem el mapa just sota la capcalera i deixem lliure la part
  // que tapa el full inferior de la fitxa
  function mobilePadding() {
    const nav = document.querySelector('nav[aria-label="Navegació principal"]');
    const top = (nav ? nav.offsetHeight : 0) + 8;
    const r = ui.mapEl.getBoundingClientRect();
    const desplacar = r.top < top - 4 || r.top > top + 120;
    if (desplacar) window.scrollBy({ top: r.top - top, behavior: reduceMotion ? "auto" : "smooth" });
    const vistaTop = desplacar ? top : r.top;
    const tapat = ui.panel.hidden ? 0 : Math.max(0, vistaTop + r.height - (window.innerHeight - ui.panel.offsetHeight));
    return { top: 30, left: 30, right: 30, bottom: Math.min(tapat + 30, r.height - 90) };
  }

  function flyToPunt(p, tour = false) {
    const map = state.map;
    if (!map || state.intro) return;
    map.flyTo({
      center: p.coords,
      zoom: zoomFor(p),
      padding: isMobile() ? mobilePadding() : 40,
      speed: tour ? 0.9 : 1.4,
      curve: 1.42,
      // sense "essential": amb prefers-reduced-motion MapLibre salta sense animar
    });
  }

  function initMap() {
    if (!window.maplibregl) return showMapError(T.errorMapa);
    let map;
    // amb un enllac directe anem al gra: sense intro (les dades encara no hi son)
    const directe = /^#(punt|recorregut)\b/.test(location.hash);
    const withIntro = !reduceMotion && !directe;
    try {
      map = new maplibregl.Map({
        container: ui.mapEl,
        center: withIntro ? LLEIDA : [23.9, 55.17],
        zoom: withIntro ? 1.3 : 6,
        ...(withIntro ? {} : { bounds: LITUANIA, fitBoundsOptions: { padding: 30 } }),
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
      });
    } catch (err) {
      console.error(err);
      return showMapError(T.errorMapa);
    }
    state.map = map;
    map.getCanvas().setAttribute("aria-label", T.mapaEtiqueta);
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.setStyle(STYLE_URL, { transformStyle });

    map.on("style.load", () => { state.styleReady = true; addLayers(); });
    map.on("error", (e) => {
      if (!state.styleReady) { console.error(e.error); showMapError(T.errorMapa); }
    });

    if (withIntro) startIntro();
    else ui.reset.hidden = false;
  }

  function addLayers() {
    const map = state.map;
    // cal tenir l'estil i les dades: arriben en qualsevol ordre
    if (state.layersReady || !state.styleReady || !state.dataReady) return;
    const colorCat = ["match", ["get", "categoria"], ...state.cats.flatMap((c) => [c.id, c.color]), "#1d2f46"];
    const font = ["Noto Sans Bold"];

    map.addSource("punts", { type: "geojson", data: featureCollection(visibles()), cluster: true, clusterRadius: 22, clusterMaxZoom: 13 });
    map.addSource("parades", { type: "geojson", data: featureCollection(state.tour) });
    map.addSource("ruta", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "LineString", coordinates: state.tour.map((p) => p.coords) }, properties: {} },
    });

    // recorregut
    map.addLayer({ id: "ruta", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#976524", "line-width": 3.5, "line-dasharray": [1.2, 1.6], "line-opacity": 0.9 } });
    map.addLayer({ id: "parades-sel", type: "circle", source: "parades", filter: ["==", ["get", "id"], ""],
      paint: { "circle-radius": 23, "circle-color": "rgba(232,183,54,.35)", "circle-stroke-width": 4, "circle-stroke-color": "#e8b736" } });
    map.addLayer({ id: "parades", type: "circle", source: "parades",
      paint: { "circle-radius": 15, "circle-color": colorCat, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
    map.addLayer({ id: "parades-n", type: "symbol", source: "parades",
      layout: { "text-field": ["to-string", ["get", "n"]], "text-font": font, "text-size": 14, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" } });
    map.addLayer({ id: "parades-nom", type: "symbol", source: "parades",
      layout: { "text-field": ["get", "nom"], "text-font": font, "text-size": 15, "text-anchor": "top", "text-offset": [0, 1.35], "text-optional": true },
      paint: { "text-color": "#1d2f46", "text-halo-color": "#ffffff", "text-halo-width": 2 } });

    // explora
    map.addLayer({ id: "clusters", type: "circle", source: "punts", filter: ["has", "point_count"],
      paint: { "circle-radius": 17, "circle-color": "#1d2f46", "circle-stroke-width": 3, "circle-stroke-color": "#FDFBF7" } });
    map.addLayer({ id: "clusters-n", type: "symbol", source: "punts", filter: ["has", "point_count"],
      layout: { "text-field": ["to-string", ["get", "point_count"]], "text-font": font, "text-size": 14, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#FDFBF7" } });
    map.addLayer({ id: "punts-sel", type: "circle", source: "punts", filter: ["==", ["get", "id"], ""],
      paint: { "circle-radius": 18, "circle-color": "rgba(232,183,54,.35)", "circle-stroke-width": 4, "circle-stroke-color": "#e8b736" } });
    map.addLayer({ id: "punts", type: "circle", source: "punts", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 8, 12, 12],
        "circle-color": colorCat, "circle-stroke-width": 2.5, "circle-stroke-color": "#ffffff",
      } });
    map.addLayer({ id: "punts-nom", type: "symbol", source: "punts", filter: ["!", ["has", "point_count"]],
      layout: { "text-field": ["get", "nom"], "text-font": font, "text-size": 13, "text-anchor": "top", "text-offset": [0, 1.1], "text-optional": true },
      paint: { "text-color": "#1d2f46", "text-halo-color": "#ffffff", "text-halo-width": 2 } });

    for (const id of ["punts", "parades"]) {
      map.on("click", id, (e) => {
        const f = e.features[0];
        if (state.mode === "recorregut") goStop(state.tour.findIndex((p) => p.id === f.properties.id));
        else select(f.properties.id);
      });
    }
    map.on("click", "clusters", async (e) => {
      const f = e.features[0];
      const zoom = await map.getSource("punts").getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.5, duration: reduceMotion ? 0 : 600 });
    });
    for (const id of ["punts", "parades", "clusters"]) {
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    }

    state.layersReady = true;
    updateLayerVisibility();
    updateSelection();
  }

  function updateLayerVisibility() {
    const map = state.map;
    if (!map || !state.layersReady) return;
    const tour = state.mode === "recorregut";
    const show = (ids, on) => ids.forEach((id) => map.setLayoutProperty(id, "visibility", on && !state.intro ? "visible" : "none"));
    show(["ruta", "parades-sel", "parades", "parades-n", "parades-nom"], tour);
    show(["clusters", "clusters-n", "punts-sel", "punts", "punts-nom"], !tour);
  }

  function updateMapData() {
    if (state.layersReady) state.map.getSource("punts").setData(featureCollection(visibles()));
  }

  function updateSelection() {
    if (!state.layersReady) return;
    const f = ["==", ["get", "id"], state.selId || ""];
    state.map.setFilter("punts-sel", ["all", ["!", ["has", "point_count"]], f]);
    state.map.setFilter("parades-sel", f);
  }

  // ------------------------------------------------------------ intro: de Lleida a Lituania

  let lleidaMarker = null;

  function startIntro() {
    const map = state.map;
    state.intro = true;
    ui.introText.textContent = T.introText;
    ui.intro.hidden = false;
    lleidaMarker = new maplibregl.Marker({ element: h("div", { class: "vl-lleida", "aria-hidden": "true" }, T.introLleida), anchor: "left", offset: [-8, 0] })
      .setLngLat(LLEIDA).addTo(map);

    map.once("load", () => {
      if (!state.intro) return;
      setTimeout(() => {
        if (!state.intro) return;
        map.flyTo({ ...cameraLituania(), duration: INTRO_MS, curve: 1.6, essential: true });
        map.once("moveend", () => endIntro(false));
      }, 900);
    });
    // si el mapa no arriba a carregar (xarxa lenta), no deixem l'intro penjada
    setTimeout(() => { if (state.intro) endIntro(true); }, 20000);
  }

  function endIntro(jump) {
    if (!state.intro) return;
    const map = state.map;
    state.intro = false;
    const hadFocus = ui.intro.contains(document.activeElement);
    ui.intro.hidden = true;
    ui.reset.hidden = false;
    if (lleidaMarker) { lleidaMarker.remove(); lleidaMarker = null; }
    if (map && jump) { map.stop(); map.jumpTo(cameraLituania()); }
    updateLayerVisibility();
    if (hadFocus) ui.list.focus();
  }

  ui.introSkip.addEventListener("click", () => endIntro(true));
  ui.reset.addEventListener("click", () => {
    if (state.mode === "recorregut") goStop(state.tourIdx);
    else fitLituania();
  });

  // ------------------------------------------------------------ pantalla completa

  if (document.fullscreenEnabled && ui.main.requestFullscreen) {
    ui.fs.hidden = false;
    ui.fs.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else ui.main.requestFullscreen().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      const on = document.fullscreenElement === ui.main;
      ui.fs.setAttribute("aria-label", on ? T.surtPantallaCompleta : T.pantallaCompleta);
      ui.fs.setAttribute("aria-pressed", String(on));
    });
  }

  // en passar de mobil a ordinador (o girar la tauleta) la fitxa canvia de format
  window.matchMedia("(max-width: 900px)").addEventListener("change", () => renderPanel());

  // ------------------------------------------------------------ arrencada

  async function init() {
    initMap();
    try {
      await loadData();
    } catch (err) {
      console.error(err);
      ui.count.textContent = T.errorDades;
      ui.panel.hidden = true;
      return;
    }
    renderFilters();
    renderList();
    renderPanel();
    addLayers();

    const hashed = readHash();
    if (hashed?.punt) select(hashed.punt);
    else if (hashed && "recorregut" in hashed) setMode("recorregut", { stop: hashed.recorregut });
  }

  init();
})();
