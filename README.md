# Mapa de las humanidades digitales en español

Un mapa interactivo que muestra dónde se publican las fuentes de una bibliografía sobre humanidades digitales en español. Cada círculo es una ciudad; al hacer clic aparecen la cita y el enlace de cada fuente.

**Sitio:** https://mck-makes-stuff.github.io/humanidades-digitales-mapa/

## Cómo funciona

- `fuentes.csv` es la bibliografía exportada de Zotero (Archivo → Exportar biblioteca → CSV).
- `ubicaciones.json` asigna cada fuente (por su clave de Zotero, la columna `Key`) a una ciudad y explica por qué. También permite corregir datos incompletos del CSV (autores, título, publicación, enlace).
- `app.js` lee los dos archivos, une las fuentes repetidas y dibuja el mapa con D3.

## Cómo se ubicó cada fuente

1. En la ciudad donde tiene su sede la organización que la publicó (editorial, universidad o asociación).
2. Si ese dato no existe, en el lugar de origen del autor.
3. Si no se puede determinar ninguno de los dos, la fuente no aparece en el mapa.

## Añadir fuentes

1. Exporta de nuevo la biblioteca de Zotero como CSV y reemplaza `fuentes.csv`.
2. Añade en `ubicaciones.json` una entrada para cada fuente nueva, con su clave, el lugar, el criterio (`editorial` o `autor`) y una explicación breve.
