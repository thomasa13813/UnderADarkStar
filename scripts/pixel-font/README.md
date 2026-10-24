# DarkStar Pixel, the game's pixel face

The black-and-purple pixel lettering of the title and the menu buttons
(`branding/images/btn-*.svg`), as a font the UI can use for any text.

| File                                  | What it is                                                  |
| ------------------------------------- | ----------------------------------------------------------- |
| `branding/pixel-font/glyphs.txt`      | The source: every glyph drawn in `#` and `.`, editable here |
| `branding/fonts/darkstar-pixel.woff2` | What the game loads (`Main.ts`), built from the source      |
| `branding/fonts/darkstar-pixel.ttf`   | The same font to install on a desktop, for mock-ups         |
| `scripts/pixel-font/build.py`         | The compiler                                                |

The font and its source sit in `branding/` (© January Games, all rights
reserved, see `branding/LICENSE`), not in the CC BY-SA `resources/`.

## Using it

- `font-pixel` (Tailwind, `--font-pixel` in `src/client/styles.css`) sets the
  face. On its own the letters take the text colour.
- `pixel-hegemon` adds the title look: near-black letters, purple ring, dark
  outer ring, glow. It sets the colour, so use it with `font-pixel` only.
- One pixel of the drawing is 1/12 em: sizes of 12, 24, 36 or 48px land every
  pixel on the screen's pixels; other sizes work but blur a little at the edges.
- The face covers printable ASCII. Lowercase letters draw as the capitals;
  anything else (accents, `·`, `→`) falls through to Tektur.

```html
<h1 class="font-pixel pixel-hegemon text-5xl">UNDER A DARK STAR</h1>
```

## Changing a letter

1. Edit its grid in `branding/pixel-font/glyphs.txt`. Capitals are 9 rows
   high, strokes 2 pixels; a 10th row hangs below the baseline.
2. Rebuild, from the repository root, with fontTools in a scratch virtual
   environment outside the repository (so nothing lands in `package.json`):

   ```bash
   python -m venv ../fontenv
   ../fontenv/Scripts/python -m pip install fonttools brotli
   ../fontenv/Scripts/python scripts/pixel-font/build.py branding/pixel-font/glyphs.txt branding/fonts
   ```

   (On macOS or Linux the interpreter is `../fontenv/bin/python`.) The build
   is reproducible: unchanged glyphs give byte-identical files.

3. Commit the source and both built files together.
