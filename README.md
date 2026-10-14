# Mapa de las humanidades digitales en español

Un mapa interactivo que muestra dónde se publican las fuentes de una bibliografía sobre humanidades digitales en español. Cada círculo es una ciudad; al hacer clic aparecen la cita y el enlace de cada fuente.

**Sitio:** https://mck-makes-stuff.github.io/humanidades-digitales-mapa/

## Cómo funciona

- `fuentes.csv` es la bibliografía exportada de Zotero.
- `ubicaciones.json` dice dónde va cada fuente. Tiene cuatro partes:
  - `lugares`: las ciudades del mapa, con sus coordenadas.
  - `revistas`: en qué ciudad se publica cada revista. Cualquier artículo de una revista de esta lista se ubica solo.
  - `editoriales`: lo mismo para las editoriales de libros.
  - `fuentes`: casos particulares, por clave de Zotero o por DOI (por ejemplo, cuando se ubica por el autor o hay que corregir un dato).
- `app.js` lee los dos archivos, une las fuentes repetidas y dibuja el globo con D3. Respeta las cursivas y otros formatos que Zotero guarda en los títulos (`<i>`, `<b>`, `<sub>`, `<sup>`).

## Cómo se ubicó cada fuente

1. En la ciudad donde tiene su sede la organización que la publicó (editorial, universidad o asociación).
2. Si ese dato no existe, en el lugar de origen del autor.
3. Si no se puede determinar ninguno de los dos, la fuente no aparece en el mapa.

## Actualizar las fuentes

1. En Zotero, selecciona las fuentes y expórtalas en formato CSV.
2. Ejecuta `python3 actualizar.py` en esta carpeta. El script busca el CSV de Zotero más reciente en Descargas, el Escritorio o la carpeta superior (o usa la ruta que le pases), lo copia a `fuentes.csv` sin rutas locales ni notas, y publica el cambio.
3. Si el script avisa de fuentes sin ubicar, añade su revista o editorial a `ubicaciones.json` y vuelve a ejecutarlo.
