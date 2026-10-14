// Lee fuentes.csv (exportado de Zotero) y ubicaciones.json, y dibuja el mapa.

const ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const TIPOS = { book: 'Libro', journalArticle: 'Artículo', bookSection: 'Capítulo de libro', webpage: 'Página web', thesis: 'Tesis' };
const CRITERIOS = { editorial: 'Ubicada según quién la publicó.', autor: 'Ubicada según el origen del autor.' };

const estado = { lugares: [], fuentes: [], elegido: null, mundo: null, vista: 'todas' };
let svg, capa, zoom, proyeccion, ancho, alto;

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

const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
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

  const fuentes = [];
  let excluidas = 0;
  for (const f of unicas.values()) {
    const clave = f.claves.find((k) => ubicaciones.fuentes[k]);
    const u = clave && ubicaciones.fuentes[clave];
    if (!u || !ubicaciones.lugares[u.lugar]) { excluidas++; continue; }
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
      paginas: f['Pages'].replace(/-/g, '–'),
      url: u.url || f['Url'] || (f['DOI'] && 'https://doi.org/' + f['DOI']) || f['Link Attachments'].split(';')[0].trim(),
    });
  }
  return { fuentes, excluidas };
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
    p.append(el('em', {}, f.titulo), '. ');
    p.append([f.editorial, f.anio].filter(Boolean).join(', ') + '.');
  } else {
    p.append('«' + f.titulo + '». ');
    if (f.publicacion) p.append(el('em', {}, f.publicacion));
    const resto = [
      f.volumen && 'vol. ' + f.volumen,
      f.numero && 'n.º ' + f.numero,
      f.anio,
      f.paginas.includes('–') && 'pp. ' + f.paginas,
    ].filter(Boolean).join(', ');
    p.append((f.publicacion && resto ? ', ' : '') + resto + '.');
  }
  return p;
}

const plural = (n) => (n === 1 ? '1 fuente' : n + ' fuentes');

/* ---------- Mapa ---------- */

function dibujarMapa() {
  const caja = $('#mapa');
  ancho = caja.clientWidth;
  alto = Math.round(Math.max(360, Math.min(ancho * 0.66, 620)));
  caja.querySelector('svg')?.remove();

  svg = d3.select(caja).insert('svg', ':first-child')
    .attr('viewBox', `0 0 ${ancho} ${alto}`)
    .attr('height', alto)
    .attr('role', 'group')
    .attr('aria-label', 'Mapa del mundo con las ciudades de publicación');
  capa = svg.append('g');

  proyeccion = d3.geoNaturalEarth1().fitExtent([[4, 4], [ancho - 4, alto - 4]], { type: 'Sphere' });
  const trazo = d3.geoPath(proyeccion);

  const porPais = d3.rollup(estado.lugares, (v) => d3.sum(v, (l) => l.fuentes.length), (l) => l.paisId);
  const nombrePais = new Map(estado.lugares.map((l) => [l.paisId, l.pais]));
  const paises = topojson.feature(estado.mundo, estado.mundo.objects.countries).features
    .filter((p) => p.id !== '010'); // sin la Antártida

  capa.append('g').selectAll('path').data(paises).join('path')
    .attr('class', (p) => 'pais' + (porPais.has(p.id) ? ' con-fuentes' : ''))
    .attr('d', trazo)
    .filter((p) => porPais.has(p.id))
    .append('title').text((p) => `${nombrePais.get(p.id)}: ${plural(porPais.get(p.id))}`);

  for (const l of estado.lugares) {
    [l.x, l.y] = proyeccion([l.lon, l.lat]);
    l.r = 10 + 3 * (l.fuentes.length - 1);
  }

  const marcas = capa.append('g').selectAll('g').data(estado.lugares).join('g')
    .attr('class', 'lugar')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (l) => `${l.ciudad}, ${l.pais}: ${plural(l.fuentes.length)}`)
    .on('click', (ev, l) => elegir(l))
    .on('keydown', (ev, l) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(l); } });
  marcas.append('circle').attr('r', (l) => l.r);
  marcas.append('text').attr('class', 'numero').text((l) => l.fuentes.length);
  marcas.append('text').attr('class', 'nombre').text((l) => l.ciudad);

  zoom = d3.zoom()
    .scaleExtent([1, 40])
    .translateExtent([[0, 0], [ancho, alto]])
    .on('zoom', (ev) => {
      capa.attr('transform', ev.transform);
      colocarMarcas(ev.transform);
      if (ev.sourceEvent) marcarVista(null);
    });
  svg.call(zoom);
  irAVista(estado.vista, false);
  marcarElegido();
}

// Mantiene los círculos del mismo tamaño al acercar y oculta los nombres que se pisan.
function colocarMarcas(t) {
  const marcas = capa.selectAll('.lugar');
  marcas.attr('transform', (l) => `translate(${l.x},${l.y}) scale(${1 / t.k})`);

  const ocupado = estado.lugares.map((l) => {
    const [x, y] = t.apply([l.x, l.y]);
    return [x - l.r - 2, y - l.r - 2, x + l.r + 2, y + l.r + 2];
  });
  const choca = (a) => ocupado.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  const orden = [...estado.lugares].sort((a, b) => (b === estado.elegido) - (a === estado.elegido) || b.fuentes.length - a.fuentes.length);
  const lado = new Map();
  for (const l of orden) {
    const [x, y] = t.apply([l.x, l.y]);
    const w = l.ciudad.length * 7.4 + 6;
    const derecha = [x + l.r + 4, y - 9, x + l.r + 4 + w, y + 9];
    const izquierda = [x - l.r - 4 - w, y - 9, x - l.r - 4, y + 9];
    if (!choca(derecha) && derecha[2] < ancho) { lado.set(l, 1); ocupado.push(derecha); }
    else if (!choca(izquierda) && izquierda[0] > 0) { lado.set(l, -1); ocupado.push(izquierda); }
    else lado.set(l, 0);
  }
  marcas.select('.nombre')
    .attr('display', (l) => (lado.get(l) ? null : 'none'))
    .attr('text-anchor', (l) => (lado.get(l) === -1 ? 'end' : 'start'))
    .attr('x', (l) => lado.get(l) * (l.r + 6));
}

function encuadrar(lugares, animar = true) {
  let t = d3.zoomIdentity;
  if (lugares) {
    const margen = Math.min(90, ancho * 0.14);
    const xs = d3.extent(lugares, (l) => l.x), ys = d3.extent(lugares, (l) => l.y);
    const k = Math.max(1, Math.min(12, (ancho - 2 * margen) / (xs[1] - xs[0] || 1), (alto - 2 * margen) / (ys[1] - ys[0] || 1)));
    t = d3.zoomIdentity.translate(ancho / 2, alto / 2).scale(k).translate(-(xs[0] + xs[1]) / 2, -(ys[0] + ys[1]) / 2);
  }
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  (animar && !sinMovimiento ? svg.transition().duration(650) : svg).call(zoom.transform, t);
}

function irAVista(vista, animar = true) {
  const filtros = {
    todas: () => true,
    espana: (l) => l.pais === 'España',
    america: (l) => l.lon < -30,
  };
  encuadrar(vista && filtros[vista] ? estado.lugares.filter(filtros[vista]) : null, animar);
  marcarVista(vista);
}

function marcarVista(vista) {
  estado.vista = vista;
  document.querySelectorAll('.vistas button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === vista));
}

function marcarElegido() {
  capa.selectAll('.lugar').classed('elegido', (l) => l === estado.elegido)
    .filter((l) => l === estado.elegido).raise();
  colocarMarcas(d3.zoomTransform(svg.node()));
}

/* ---------- Panel y listado ---------- */

function elegir(lugar, { centrar = false } = {}) {
  estado.elegido = lugar;
  marcarElegido();
  if (centrar && lugar) {
    const vecinos = estado.lugares.filter((l) => Math.hypot(l.x - lugar.x, l.y - lugar.y) < ancho * 0.05);
    encuadrar(vecinos.length > 1 ? vecinos : estado.lugares.filter((l) => l.pais === lugar.pais));
    marcarVista(null);
  }
  pintarPanel();
  if (lugar && matchMedia('(max-width: 900px)').matches) {
    $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function pintarPanel() {
  const panel = $('#panel');
  panel.replaceChildren();
  const lugar = estado.elegido;

  if (!lugar) {
    const total = estado.fuentes.length;
    const paises = d3.rollups(estado.lugares, (v) => d3.sum(v, (l) => l.fuentes.length), (l) => l.pais)
      .sort((a, b) => b[1] - a[1]);
    const max = paises[0][1];
    panel.append(
      el('h2', {}, `${plural(total)} de ${paises.length} países`),
      el('p', { class: 'sub' }, 'Elige un círculo del mapa para ver sus fuentes. También puedes acercarte a un país:'),
      el('ul', { class: 'paises' }, ...paises.map(([pais, n]) => {
        const relleno = el('span');
        relleno.style.width = (n / max) * 100 + '%';
        return el('li', {}, el('button', {
          type: 'button',
          'aria-label': `${pais}: ${plural(n)}. Acercar el mapa.`,
          onclick: () => { encuadrar(estado.lugares.filter((l) => l.pais === pais)); marcarVista(null); },
        }, el('span', {}, pais), el('span', { class: 'barra' }, relleno), el('span', { class: 'cuenta' }, String(n))));
      })),
    );
    return;
  }

  panel.append(
    el('button', { type: 'button', class: 'volver', onclick: () => elegir(null) }, '← Ver el resumen por país'),
    el('h2', {}, lugar.ciudad),
    el('p', { class: 'sub' }, `${lugar.pais} · ${plural(lugar.fuentes.length)}`),
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
          $('.principal').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      },
        el('span', { class: 't' }, f.titulo),
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
    estado.mundo = mundo;
    estado.fuentes = fuentes;
    estado.lugares = Object.entries(ubicaciones.lugares)
      .map(([id, l]) => ({ id, ...l, fuentes: fuentes.filter((f) => f.lugar === id) }))
      .filter((l) => l.fuentes.length);
    for (const l of estado.lugares) for (const f of l.fuentes) f.lugarObj = l;

    if (excluidas) {
      const nota = $('#excluidas');
      nota.hidden = false;
      nota.textContent = excluidas === 1
        ? 'Una fuente del archivo no aparece en el mapa porque no se pudo determinar su origen.'
        : `${excluidas} fuentes del archivo no aparecen en el mapa porque no se pudo determinar su origen.`;
    }

    $('#cargando').remove();
    dibujarMapa();
    pintarPanel();
    pintarLista();

    document.querySelectorAll('.vistas button').forEach((b) => b.addEventListener('click', () => irAVista(b.dataset.vista)));
    $('#acercar').addEventListener('click', () => { svg.transition().duration(250).call(zoom.scaleBy, 1.8); marcarVista(null); });
    $('#alejar').addEventListener('click', () => { svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.8); marcarVista(null); });

    let anchoPrevio = ancho;
    new ResizeObserver(() => {
      if ($('#mapa').clientWidth !== anchoPrevio) { dibujarMapa(); anchoPrevio = ancho; }
    }).observe($('#mapa'));
  } catch (error) {
    console.error(error);
    $('#cargando').textContent = 'No se pudo cargar el mapa. Revisa tu conexión y vuelve a cargar la página.';
  }
}

iniciar();
