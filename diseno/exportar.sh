#!/bin/sh
# Exporta el favicon y la imagen para compartir el link (necesita Google Chrome).
#   public/favicon.svg · favicon-32.png · apple-touch-icon.png · icon-512.png · assets/og.jpg
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
captura() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
  --default-background-color=00000000 --window-size="$2" --screenshot="$3" "file://$PWD/$1" >/dev/null 2>&1; }
captura icono.html 512,512 "$TMP/icono.png"
captura "icono.html#fondo" 512,512 "$TMP/icono-fondo.png"
captura og.html 1200,630 "$TMP/og.png"
P=../public
sips -z 32 32 "$TMP/icono.png" --out "$P/favicon-32.png" >/dev/null
sips -z 512 512 "$TMP/icono.png" --out "$P/icon-512.png" >/dev/null
sips -z 180 180 "$TMP/icono-fondo.png" -s format png --out "$P/apple-touch-icon.png" >/dev/null
sips -s format jpeg -s formatOptions 86 "$TMP/og.png" --out "$P/assets/og.jpg" >/dev/null
sips -z 16 16 "$TMP/icono.png" --out "$TMP/f16.png" >/dev/null
sips -z 48 48 "$TMP/icono.png" --out "$TMP/f48.png" >/dev/null
sips -z 192 192 "$TMP/icono.png" --out "$P/icon-192.png" >/dev/null
# favicon.ico con 16, 32 y 48 px (el formato ICO puede llevar PNG adentro)
python3 -I - "$P/favicon.ico" "$TMP/f16.png" "$P/favicon-32.png" "$TMP/f48.png" <<'PY'
import struct, sys
salida, *pngs = sys.argv[1:]
datos = [open(f, "rb").read() for f in pngs]
tam = [16, 32, 48]
cab = struct.pack("<HHH", 0, 1, len(datos))
off = 6 + 16 * len(datos)
dirs = b""
for t, d in zip(tam, datos):
    dirs += struct.pack("<BBBBHHII", t, t, 0, 0, 1, 32, len(d), off)
    off += len(d)
open(salida, "wb").write(cab + dirs + b"".join(datos))
PY
rm -f "$P/favicon.svg"
rm -rf "$TMP"
echo "Listo: favicon y imagen para compartir en public/"
