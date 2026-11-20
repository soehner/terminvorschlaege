#!/bin/sh
# Baut das Thunderbird-Add-on als .xpi
set -e
cd "$(dirname "$0")/addon"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
OUT="../dist/terminvorschlaege-$VERSION.xpi"
mkdir -p ../dist
rm -f "$OUT"
zip -qr -X "$OUT" . -x '*.DS_Store'
echo "Erstellt: dist/terminvorschlaege-$VERSION.xpi"
