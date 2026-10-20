# The map-label MSDF atlas

`resources/atlases/msdf-atlas.{png,json}` holds the face the WebGL renderer
draws player names, troop counts, structure levels and world text in: Tektur
Bold (OFL, see `CREDITS.md`), 48px, distance range 16, the 317 glyphs of
`charset.txt` (Latin-1 and Latin Extended-A, which `CHAR_RANGE` covers).

Rebuild it in a scratch folder, outside the repo, so that neither tool lands
in `package.json`:

1. Get a static Tektur Bold TTF: `curl -A curl/8
"https://fonts.googleapis.com/css2?family=Tektur:wght@700"` names its URL.
2. `npm install msdf-bmfont-xml@2.7.0`, then
   `npx msdf-bmfont -f json -s 48 -r 16 -m 1024,1024 --pot --square -i charset.txt -o tektur-bold Tektur-Bold.ttf`.
3. msdf-bmfont reads almost none of Tektur's GPOS kerning, so take it from
   fontTools (`pip install fonttools`):
   `python kern.py Tektur-Bold.ttf charset.txt kernings.json`.
4. `node <repo>/scripts/normalizeMsdfAtlas.mjs Tektur-Bold.json kernings.json <repo>/resources/atlases/msdf-atlas.json`
   moves the baseline to y=36 (the shaders centre on `-base / 2 + yoffset`
   and size icons and line gaps from `base`), then copy `tektur-bold.png` to
   `msdf-atlas.png` and run Prettier on the JSON.
