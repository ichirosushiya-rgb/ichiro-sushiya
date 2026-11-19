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
# favicon.svg: el koi en círculo, con la foto incrustada (64 px)
sips -z 64 64 ../public/assets/img/koi.jpg --out "$TMP/k64.jpg" >/dev/null
B64=$(base64 -i "$TMP/k64.jpg" | tr -d '\n')
cat > "$P/favicon.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><clipPath id="c"><circle cx="32" cy="32" r="31"/></clipPath></defs><image href="data:image/jpeg;base64,$B64" width="64" height="64" clip-path="url(#c)"/></svg>
SVG
rm -rf "$TMP"
echo "Listo: favicon y imagen para compartir en public/"
