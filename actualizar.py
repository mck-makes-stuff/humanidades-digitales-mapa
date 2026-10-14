#!/usr/bin/env python3
"""Actualiza el sitio con una exportación CSV de Zotero.

Uso:
    python3 actualizar.py                 # usa el CSV de Zotero más reciente en Descargas, Escritorio o la carpeta superior
    python3 actualizar.py ruta/al.csv     # usa ese archivo (se pueden pasar varios)
    python3 actualizar.py --sin-publicar  # actualiza los archivos pero no hace commit ni push

Copia las fuentes a fuentes.csv (sin rutas locales ni notas), avisa de las que no se
pueden ubicar en el mapa y publica los cambios en GitHub Pages.
"""
import csv
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SITIO = Path(__file__).resolve().parent
PRIVADAS = ["File Attachments", "Notes"]  # columnas que no deben publicarse


def es_csv_de_zotero(ruta):
    try:
        with open(ruta, encoding="utf-8-sig", newline="") as f:
            cabecera = next(csv.reader(f), [])
    except (OSError, UnicodeDecodeError):
        return False
    return {"Key", "Item Type", "Title", "Author"} <= set(cabecera)


def mas_reciente():
    carpetas = [Path.home() / "Downloads", Path.home() / "Desktop", SITIO.parent]
    candidatos = [p for c in carpetas if c.is_dir() for p in c.glob("*.csv") if es_csv_de_zotero(p)]
    return max(candidatos, key=lambda p: p.stat().st_mtime, default=None)


def normalizar(texto):
    texto = re.sub(r"<[^>]+>", "", texto or "").lower()
    texto = unicodedata.normalize("NFD", texto)
    return re.sub(r"[^a-z0-9]", "", texto)


def leer(rutas):
    filas, columnas = [], []
    for ruta in rutas:
        with open(ruta, encoding="utf-8-sig", newline="") as f:
            lector = csv.DictReader(f)
            columnas += [c for c in lector.fieldnames if c not in columnas]
            filas += list(lector)
    for fila in filas:
        for columna in PRIVADAS:
            if columna in fila:
                fila[columna] = ""
    return filas, columnas


def sin_ubicar(filas):
    """Las mismas reglas que app.js: entrada propia (clave o DOI), revista o editorial."""
    ubic = json.loads((SITIO / "ubicaciones.json").read_text(encoding="utf-8"))
    revistas = {normalizar(k) for k in ubic.get("revistas", {})}
    editoriales = {normalizar(k) for k in ubic.get("editoriales", {})}
    propias = ubic.get("fuentes", {})
    vistas, pendientes = {}, []
    for fila in filas:
        vistas.setdefault(normalizar(fila.get("Title")), []).append(fila)
    for grupo in vistas.values():
        ubicada = any(
            fila.get("Key") in propias
            or (fila.get("DOI") or "").lower() in propias
            or normalizar(fila.get("Publication Title")) in revistas
            or normalizar(fila.get("Publisher")) in editoriales
            for fila in grupo
        )
        if not ubicada:
            pendientes.append(grupo[0])
    return len(vistas), pendientes


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    publicar = "--sin-publicar" not in sys.argv
    rutas = [Path(a).expanduser() for a in args] or [mas_reciente()]
    if rutas == [None]:
        sys.exit("No encontré ningún CSV exportado de Zotero. Pasa la ruta del archivo como argumento.")
    for ruta in rutas:
        if not es_csv_de_zotero(ruta):
            sys.exit(f"{ruta} no parece una exportación CSV de Zotero.")
    print("Leyendo:", ", ".join(str(r) for r in rutas))

    filas, columnas = leer(rutas)
    with open(SITIO / "fuentes.csv", "w", encoding="utf-8", newline="") as f:
        escritor = csv.DictWriter(f, fieldnames=columnas, quoting=csv.QUOTE_ALL, restval="")
        escritor.writeheader()
        escritor.writerows(filas)

    total, pendientes = sin_ubicar(filas)
    print(f"{total} fuentes distintas; {total - len(pendientes)} aparecerán en el mapa.")
    if pendientes:
        print("\nSin ubicar (añade su revista, su editorial o la fuente misma a ubicaciones.json):")
        for fila in pendientes:
            origen = fila.get("Publication Title") or fila.get("Publisher") or "sin revista ni editorial"
            print(f"  - [{fila.get('Key')}] {fila.get('Title', '')[:70]} | {origen}")

    if not publicar:
        return
    git = lambda *a: subprocess.run(["git", "-C", str(SITIO), *a], check=True)
    git("add", "fuentes.csv", "ubicaciones.json")
    if subprocess.run(["git", "-C", str(SITIO), "diff", "--cached", "--quiet"]).returncode == 0:
        print("\nNo hay cambios que publicar.")
        return
    git("commit", "-q", "-m", f"Actualizar fuentes ({total})")
    git("push", "-q")
    print("\nPublicado. El sitio se actualiza en uno o dos minutos.")


if __name__ == "__main__":
    main()
