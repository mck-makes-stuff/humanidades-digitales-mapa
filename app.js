// Lee fuentes.csv (exportado de Zotero) y ubicaciones.json, y dibuja el globo.

const ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const TIPOS = { book: 'Libro', journalArticle: 'Artículo', bookSection: 'Capítulo de libro', webpage: 'Página web', thesis: 'Tesis' };
const CRITERIOS = { editorial: 'Ubicada según quién la publicó.', autor: 'Ubicada según el origen del autor.' };

const estado = { lugares: [], fuentes: [], elegido: null, vista: 'inicio', centro: [-42, 16], k: 1 };
let lienzo, ctx, svg, proyeccion, trazo, ancho, alto, radio, cx, cy, tierra, fronteras, activos, animacion, vaiven, C;

const $ = (sel) => document.querySelector(sel);

function el(etiqueta, attrs = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') nodo.className = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
    else nodo.setAttribute(k, v);
  }
  for (const h of hijos) nodo.append(h);
  return nodo;
}

/* ---------- Datos ---------- */

function leerCSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  texto = texto.replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.length > 1 || fila[0] !== '') filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const cabecera = filas.shift();
  return filas.map((f) => Object.fromEntries(cabecera.map((nombre, i) => [nombre, (f[i] || '').trim()])));
}

const normalizar = (s) => (s || '').replace(/<[^>]+>/g, '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const limpiar = (s) => s.replace(/\s*\?`\s*/g, ' ¿').replace(/\s+/g, ' ').trim();

// Une las filas repetidas (mismo título) y descarta las que no tienen ubicación.
function prepararFuentes(filas, ubicaciones) {
  const unicas = new Map();
  for (const fila of filas) {
    const clave = normalizar(fila['Title']);
    const previa = unicas.get(clave);
    if (!previa) { unicas.set(clave, { ...fila, claves: [fila['Key']] }); continue; }
    previa.claves.push(fila['Key']);
    for (const [k, v] of Object.entries(fila)) if (!previa[k] && v) previa[k] = v;
  }

  // Cada fuente se ubica por su propia entrada (clave de Zotero o DOI); si no tiene,
  // por su revista y, en último caso, por su editorial.
  const indice = (mapa) => new Map(Object.entries(mapa || {}).map(([k, v]) => [normalizar(k), v]));
  const revistas = indice(ubicaciones.revistas);
  const editoriales = indice(ubicaciones.editoriales);

  const fuentes = [];
  let excluidas = 0;
  for (const f of unicas.values()) {
    const propia = [...f.claves, f['DOI'].toLowerCase()].map((k) => k && ubicaciones.fuentes[k]).find(Boolean) || {};
    const general = revistas.get(normalizar(propia.publicacion || f['Publication Title'])) || editoriales.get(normalizar(f['Publisher'])) || {};
    const u = { criterio: 'editorial', ...general, ...propia };
    if (!ubicaciones.lugares[u.lugar]) { excluidas++; continue; }
    fuentes.push({
      lugar: u.lugar,
      criterio: u.criterio,
      explicacion: u.explicacion,
      tipo: u.tipo || f['Item Type'],
      autores: (u.autores || f['Author']).split(';').map((a) => a.trim()).filter(Boolean),
      titulo: limpiar(u.titulo || f['Title']),
      publicacion: u.publicacion || f['Publication Title'],
      editorial: f['Publisher'],
      anio: u.anio || f['Publication Year'],
      volumen: f['Volume'],
      numero: f['Issue'],
      paginas: f['Pages'].replace(/\s*[-–]\s*/g, '–'),
      url: u.url || f['Url'] || (f['DOI'] && 'https://doi.org/' + f['DOI']) || f['Link Attachments'].split(';')[0].trim(),
    });
  }
  return { fuentes, excluidas };
}

// Zotero guarda las cursivas y otros formatos de los títulos como etiquetas (<i>, <b>, <sub>, <sup>,
// versalitas). Aquí se convierten en elementos reales; cualquier otra etiqueta se muestra como texto.
function rico(texto) {
  const raiz = document.createDocumentFragment();
  const pila = [raiz];
  const marca = /<(i|b|em|strong|sub|sup)>|<span style="font-variant:\s*small-caps;?">|<span class="nocase">|<\/(i|b|em|strong|sub|sup|span)>/gi;
  let desde = 0, m;
  while ((m = marca.exec(texto))) {
    pila[pila.length - 1].append(texto.slice(desde, m.index));
    desde = marca.lastIndex;
    if (m[0].startsWith('</')) { if (pila.length > 1) pila.pop(); continue; }
    const nodo = m[1] ? el(m[1].toLowerCase()) : el('span', m[0].includes('small-caps') ? { class: 'versalitas' } : {});
    pila[pila.length - 1].append(nodo);
    pila.push(nodo);
  }
  pila[pila.length - 1].append(texto.slice(desde));
  return raiz;
}

function nombresAutores(autores) {
  const invertir = (a) => a.split(',').map((p) => p.trim()).reverse().join(' ');
  if (!autores.length) return '';
  const lista = [autores[0], ...autores.slice(1).map(invertir)];
  if (lista.length === 1) return lista[0];
  return lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];
}

function construirCita(f) {
  const p = el('p', { class: 'cita' });
  const punto = (s) => (/[.?!]$/.test(s) ? s : s + '.');
  const autores = nombresAutores(f.autores);
  if (autores) p.append(punto(autores) + ' ');
  if (f.tipo === 'book') {
    p.append(el('em', {}, rico(f.titulo)), '. ');
    p.append([f.editorial, f.anio].filter(Boolean).join(', ') + '.');
  } else {
    p.append('«', rico(f.titulo), '». ');
    if (f.publicacion) p.append(el('em', {}, f.publicacion));
    const resto = [
      f.volumen && 'vol. ' + f.volumen,
      f.numero && 'n.º ' + f.numero,
      f.anio,
      f.paginas.includes('–') ? 'pp. ' + f.paginas : /^e\d+$/i.test(f.paginas) && f.paginas,
    ].filter(Boolean).join(', ');
    p.append((f.publicacion && resto ? ', ' : '') + resto + '.');
  }
  return p;
}

const plural = (n) => (n === 1 ? '1 fuente' : n + ' fuentes');

/* ---------- Globo ---------- */

const VISTAS = {
  inicio: { centro: [-42, 16], k: 1 },
  espana: (ls) => ls.filter((l) => l.pais === 'España'),
  europa: (ls) => ls.filter((l) => l.lon > -12),
  america: (ls) => ls.filter((l) => l.lon < -30),
};
const K_MIN = 1, K_MAX = 10;
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const anchoPantalla = matchMedia('(min-width: 901px)');
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');

// Estrellas de fondo: posiciones fijas, generadas una sola vez.
const ESTRELLAS = d3.range(170).map((i) => {
  const azar = (n) => { const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  return [azar(1), azar(2), 0.4 + azar(3) * 0.9, 0.15 + azar(4) * 0.5];
});

function leerColores() {
  const estilo = getComputedStyle(document.documentElement);
  const nombres = ['mar', 'mar-claro', 'reticula', 'tierra', 'frontera', 'tierra-activa', 'tierra-activa-borde', 'borde-globo', 'halo', 'estrella'];
  C = Object.fromEntries(nombres.map((n) => [n, estilo.getPropertyValue('--' + n).trim()]));
}

function detenerVaiven() { vaiven?.stop(); vaiven = null; }

function prepararGlobo(mundo) {
  const paises = topojson.feature(mundo, mundo.objects.countries).features;
  const conFuentes = new Set(estado.lugares.map((l) => l.paisId));
  tierra = topojson.merge(mundo, mundo.objects.countries.geometries);
  fronteras = topojson.mesh(mundo, mundo.objects.countries, (a, b) => a !== b);
  activos = { type: 'FeatureCollection', features: paises.filter((p) => conFuentes.has(p.id)) };

  leerColores();
  const caja = $('#mapa');
  lienzo = caja.appendChild(el('canvas', { 'aria-hidden': 'true' }));
  ctx = lienzo.getContext('2d');
  svg = d3.select(caja).append('svg')
    .attr('role', 'group')
    .attr('aria-label', 'Globo terráqueo con las ciudades de publicación');

  const marcas = svg.selectAll('g').data(estado.lugares).join('g')
    .attr('class', 'lugar')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (l) => `${l.ciudad}, ${l.pais}: ${plural(l.fuentes.length)}`)
    .on('click', (ev, l) => elegir(l))
    .on('keydown', (ev, l) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(l); } });
  marcas.append('circle');
  marcas.append('text').attr('class', 'numero').text((l) => l.fuentes.length);
  marcas.append('text').attr('class', 'nombre').text((l) => l.ciudad);

  // Arrastrar gira el globo; la rueda o dos dedos lo acercan.
  let pellizco = null;
  svg.call(d3.drag()
    .on('start', () => { animacion?.stop(); detenerVaiven(); })
    .on('drag', (ev) => {
      if (ev.sourceEvent.touches?.length > 1) return;
      const grados = 180 / Math.PI / (radio * estado.k);
      estado.centro = [estado.centro[0] - ev.dx * grados, limitar(estado.centro[1] + ev.dy * grados, -80, 80)];
      marcarVista(null);
      pintar();
    }));
  svg.on('wheel', (ev) => {
    ev.preventDefault();
    animacion?.stop(); detenerVaiven();
    estado.k = limitar(estado.k * Math.exp(-ev.deltaY * 0.0015), K_MIN, K_MAX);
    marcarVista(null);
    pintar();
  }, { passive: false });
  const separacion = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  svg.on('touchstart.pellizco', (ev) => { detenerVaiven(); if (ev.touches.length === 2) pellizco = { d: separacion(ev.touches), k: estado.k }; });
  svg.on('touchmove.pellizco', (ev) => {
    if (ev.touches.length !== 2 || !pellizco) return;
    estado.k = limitar(pellizco.k * separacion(ev.touches) / pellizco.d, K_MIN, K_MAX);
    marcarVista(null);
    pintar();
  });
  svg.on('touchend.pellizco', () => { pellizco = null; });

  medir();
}

function medir() {
  const caja = $('#mapa');
  ancho = caja.clientWidth;
  alto = caja.clientHeight;
  // En pantallas anchas la ficha flota a la derecha, así que el globo se centra en el espacio libre.
  const libre = anchoPantalla.matches ? ancho - 420 : ancho;
  radio = Math.min(libre, alto) / 2 * (anchoPantalla.matches ? 0.86 : 0.9);
  cx = libre / 2 + (anchoPantalla.matches ? 24 : 0);
  cy = alto / 2 + (anchoPantalla.matches ? 14 : 0);
  const dpr = window.devicePixelRatio || 1;
  lienzo.width = ancho * dpr; lienzo.height = alto * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  svg.attr('viewBox', `0 0 ${ancho} ${alto}`);
  for (const l of estado.lugares) l.r = (anchoPantalla.matches ? 9 : 7.5) + (anchoPantalla.matches ? 3.2 : 2.4) * Math.sqrt(l.fuentes.length - 1);
  svg.selectAll('.lugar circle').attr('r', (l) => l.r);
  proyeccion = d3.geoOrthographic().translate([cx, cy]).clipAngle(90).precision(0.4);
  trazo = d3.geoPath(proyeccion, ctx);
  pintar();
}

function pintar() {
  proyeccion.rotate([-estado.centro[0], -estado.centro[1]]).scale(radio * estado.k);
  const R = radio * estado.k;
  const esfera = { type: 'Sphere' };
  const degradado = (x0, y0, r0, r1, ...paradas) => {
    const g = ctx.createRadialGradient(x0, y0, r0, cx, cy, r1);
    paradas.forEach(([p, c]) => g.addColorStop(p, c));
    return g;
  };
  const dibujar = (geo, relleno, linea, grosor = 0.6) => {
    ctx.beginPath(); trazo(geo);
    if (relleno) { ctx.fillStyle = relleno; ctx.fill(); }
    if (linea) { ctx.strokeStyle = linea; ctx.lineWidth = grosor; ctx.stroke(); }
  };

  ctx.clearRect(0, 0, ancho, alto);
  ctx.fillStyle = C.estrella;
  for (const [x, y, r, a] of ESTRELLAS) {
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(x * ancho, y * alto, r, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Atmósfera
  ctx.fillStyle = degradado(cx, cy, R * 0.92, R * 1.25, [0, C.halo], [1, 'rgba(0,0,0,0)']);
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, 2 * Math.PI); ctx.fill();

  // Océano iluminado desde arriba a la izquierda
  dibujar(esfera, degradado(cx - R * 0.35, cy - R * 0.4, R * 0.05, R, [0, C['mar-claro']], [1, C.mar]));
  dibujar(d3.geoGraticule10(), null, C.reticula, 0.5);
  dibujar(tierra, C.tierra);
  dibujar(fronteras, null, C.frontera);
  dibujar(activos, C['tierra-activa'], C['tierra-activa-borde'], 0.8);

  // Brillo y sombra para dar volumen a la esfera
  dibujar(esfera, degradado(cx - R * 0.32, cy - R * 0.38, R * 0.1, R * 1.02,
    [0, 'rgba(255,255,255,0.13)'], [0.5, 'rgba(255,255,255,0)'], [0.78, 'rgba(0,10,12,0.25)'], [1, 'rgba(0,8,10,0.78)']));
  dibujar(esfera, null, C['borde-globo'], 1.2);

  colocarMarcas();
}

// Sitúa los círculos, esconde los que quedan al otro lado del globo y los nombres que se pisan.
function colocarMarcas() {
  for (const l of estado.lugares) {
    l.visible = d3.geoDistance([l.lon, l.lat], estado.centro) < Math.PI / 2 - 0.05;
    [l.sx, l.sy] = proyeccion([l.lon, l.lat]);
  }
  const visibles = estado.lugares.filter((l) => l.visible);
  const ocupado = visibles.map((l) => [l.sx - l.r - 2, l.sy - l.r - 2, l.sx + l.r + 2, l.sy + l.r + 2]);
  const choca = (a) => ocupado.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  const orden = [...visibles].sort((a, b) => (b === estado.elegido) - (a === estado.elegido) || b.fuentes.length - a.fuentes.length);
  const lado = new Map();
  for (const l of orden) {
    const w = l.ciudad.length * 7.4 + 6;
    const derecha = [l.sx + l.r + 4, l.sy - 9, l.sx + l.r + 4 + w, l.sy + 9];
    const izquierda = [l.sx - l.r - 4 - w, l.sy - 9, l.sx - l.r - 4, l.sy + 9];
    if (!choca(derecha) && derecha[2] < ancho) { lado.set(l, 1); ocupado.push(derecha); }
    else if (!choca(izquierda) && izquierda[0] > 0) { lado.set(l, -1); ocupado.push(izquierda); }
    else lado.set(l, 0);
  }
  const marcas = svg.selectAll('.lugar')
    .attr('display', (l) => (l.visible ? null : 'none'))
    .attr('transform', (l) => `translate(${l.sx},${l.sy})`)
    .classed('elegido', (l) => l === estado.elegido);
  marcas.select('.nombre')
    .attr('display', (l) => (lado.get(l) ? null : 'none'))
    .attr('text-anchor', (l) => (lado.get(l) === -1 ? 'end' : 'start'))
    .attr('x', (l) => (lado.get(l) || 0) * (l.r + 6));
}

function volarA(centro, k) {
  animacion?.stop(); detenerVaiven();
  const desde = { centro: estado.centro, k: estado.k };
  const dLon = ((centro[0] - desde.centro[0] + 540) % 360) - 180;
  const paso = (t) => {
    estado.centro = [desde.centro[0] + dLon * t, desde.centro[1] + (centro[1] - desde.centro[1]) * t];
    estado.k = desde.k + (k - desde.k) * t;
    pintar();
  };
  if (sinMovimiento.matches) { paso(1); return; }
  animacion = d3.timer((ms) => {
    const t = Math.min(1, ms / 900);
    paso(d3.easeCubicInOut(t));
    if (t === 1) animacion.stop();
  });
}

// Gira el globo hasta un grupo de lugares y se acerca lo justo para que quepan.
function encuadrar(lugares) {
  const centro = d3.geoCentroid({ type: 'MultiPoint', coordinates: lugares.map((l) => [l.lon, l.lat]) });
  const lejos = d3.max(lugares, (l) => d3.geoDistance([l.lon, l.lat], centro));
  volarA([centro[0], limitar(centro[1], -80, 80)], lejos > 0.01 ? limitar(0.7 / Math.sin(Math.min(lejos, 1.5)), K_MIN, 6) : 2.5);
}

function irAVista(vista) {
  const v = VISTAS[vista];
  if (typeof v === 'function') encuadrar(v(estado.lugares)); else volarA(v.centro, v.k);
  marcarVista(vista);
}

function marcarVista(vista) {
  if (estado.vista === vista) return;
  estado.vista = vista;
  document.querySelectorAll('.vistas button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === vista));
}

/* ---------- Panel y listado ---------- */

function elegir(lugar, { centrar = false } = {}) {
  estado.elegido = lugar;
  svg.selectAll('.lugar').filter((l) => l === lugar).raise();
  if (centrar && lugar) {
    // Se acerca hasta separar la ciudad de su vecina más próxima.
    const vecina = d3.min(estado.lugares.filter((l) => l !== lugar), (l) => d3.geoDistance([l.lon, l.lat], [lugar.lon, lugar.lat]));
    volarA([lugar.lon, lugar.lat], limitar(70 / (vecina * radio), 1.6, 7));
    marcarVista(null);
  } else colocarMarcas();
  pintarPanel();
  if (lugar && !anchoPantalla.matches) {
    $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function pintarPanel() {
  const panel = $('#panel');
  panel.replaceChildren();
  const lugar = estado.elegido;

  if (!lugar) {
    const paises = d3.rollups(estado.lugares, (v) => d3.sum(v, (l) => l.fuentes.length), (l) => l.pais)
      .sort((a, b) => b[1] - a[1]);
    const max = paises[0][1];
    panel.append(
      el('h2', {}, 'Una muestra del campo'),
      el('p', { class: 'sub' }, `${estado.fuentes.length} fuentes escogidas, publicadas en ${paises.length} países. Elige un círculo del globo para leerlas, o acércate a un país:`),
      el('ul', { class: 'paises' }, ...paises.map(([pais, n]) => {
        const relleno = el('span');
        relleno.style.width = (n / max) * 100 + '%';
        return el('li', {}, el('button', {
          type: 'button',
          'aria-label': `${pais}: ${plural(n)}. Girar el globo hasta allí.`,
          onclick: () => { encuadrar(estado.lugares.filter((l) => l.pais === pais)); marcarVista(null); },
        }, el('span', {}, pais), el('span', { class: 'barra' }, relleno), el('span', { class: 'cuenta' }, String(n))));
      })),
    );
    return;
  }

  panel.append(
    el('button', { type: 'button', class: 'volver', onclick: () => elegir(null) }, '← Ver el resumen por país'),
    el('h2', {}, lugar.ciudad),
    el('p', { class: 'sub' }, `${lugar.pais} · ${plural(lugar.fuentes.length)} en esta selección`),
    ...lugar.fuentes.map((f) => {
      const porque = el('p', { class: 'porque' }, el('strong', {}, '¿Por qué aquí? '), f.explicacion + ' ' + (CRITERIOS[f.criterio] || ''));
      const enlace = f.url
        ? el('a', { class: 'enlace', href: f.url, target: '_blank', rel: 'noopener' }, 'Abrir la fuente ↗')
        : el('p', { class: 'sin-enlace' }, 'Esta fuente no tiene enlace en la bibliografía.');
      return el('article', { class: 'ficha' }, el('p', { class: 'tipo' }, TIPOS[f.tipo] || 'Fuente'), construirCita(f), porque, enlace);
    }),
  );
}

function pintarLista() {
  const grupos = d3.groups(estado.fuentes, (f) => f.lugarObj.pais).sort((a, b) => b[1].length - a[1].length);
  $('#lista').replaceChildren(...grupos.map(([pais, fuentes]) =>
    el('div', { class: 'grupo' },
      el('h3', {}, el('span', {}, pais), el('span', {}, String(fuentes.length))),
      el('ul', {}, ...fuentes.map((f) => el('li', {}, el('button', {
        type: 'button',
        onclick: () => {
          elegir(f.lugarObj, { centrar: true });
          $('.escena').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      },
        el('span', { class: 't' }, rico(f.titulo)),
        el('span', { class: 'm' }, [nombresAutores(f.autores), f.anio, f.lugarObj.ciudad].filter(Boolean).join(' · ')),
      )))),
    )));
}

/* ---------- Inicio ---------- */

async function iniciar() {
  try {
    const [csv, ubicaciones, mundo] = await Promise.all([
      fetch('fuentes.csv').then((r) => r.text()),
      fetch('ubicaciones.json').then((r) => r.json()),
      fetch(ATLAS).then((r) => r.json()),
    ]);
    const { fuentes, excluidas } = prepararFuentes(leerCSV(csv), ubicaciones);
    estado.fuentes = fuentes;
    estado.lugares = Object.entries(ubicaciones.lugares)
      .map(([id, l]) => ({ id, ...l, fuentes: fuentes.filter((f) => f.lugar === id) }))
      .filter((l) => l.fuentes.length);
    for (const l of estado.lugares) for (const f of l.fuentes) f.lugarObj = l;

    if (excluidas) {
      const nota = $('#excluidas');
      nota.hidden = false;
      nota.textContent = excluidas === 1
        ? 'Una fuente del archivo no aparece en el globo porque no se pudo determinar su origen.'
        : `${excluidas} fuentes del archivo no aparecen en el globo porque no se pudo determinar su origen.`;
    }

    $('#cargando').remove();
    prepararGlobo(mundo);
    pintarPanel();
    pintarLista();

    document.querySelectorAll('.vistas button').forEach((b) => b.addEventListener('click', () => irAVista(b.dataset.vista)));
    const acercar = (factor) => { volarA(estado.centro, limitar(estado.k * factor, K_MIN, K_MAX)); marcarVista(null); };
    $('#acercar').addEventListener('click', () => acercar(1.7));
    $('#alejar').addEventListener('click', () => acercar(1 / 1.7));

    new ResizeObserver(() => {
      if ($('#mapa').clientWidth !== ancho || $('#mapa').clientHeight !== alto) medir();
    }).observe($('#mapa'));
    document.fonts?.ready.then(pintar);

    // Un balanceo suave deja ver que es una esfera; se detiene en cuanto alguien la toca.
    if (!sinMovimiento.matches) {
      vaiven = d3.timer((ms) => {
        estado.centro = [VISTAS.inicio.centro[0] + 12 * Math.sin(ms / 4500), estado.centro[1]];
        pintar();
      });
    }
  } catch (error) {
    console.error(error);
    $('#cargando').textContent = 'No se pudo cargar el globo. Revisa tu conexión y vuelve a cargar la página.';
  }
}

iniciar();
