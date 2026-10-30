#!/bin/sh
# Regenerates the PWA PNG icons from the SVG sources (requires rsvg-convert from librsvg).
set -eu
cd "$(dirname "$0")/.."
rsvg-convert -w 192 -h 192 public/favicon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/favicon.svg -o public/icon-512.png
rsvg-convert -w 180 -h 180 scripts/icon-maskable.svg -o public/apple-touch-icon.png
rsvg-convert -w 512 -h 512 scripts/icon-maskable.svg -o public/icon-maskable-512.png
