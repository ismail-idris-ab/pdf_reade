// Renders the Pdf Reader icon (concept B) to the PNGs app.config.ts expects.
//
// Not part of the app build. Run it from a scratch folder outside the repo:
//   npm i @resvg/resvg-js@2   (MPL-2.0; a dev-only tool, never shipped)
//   download ArchivoBlack-Regular.ttf (SIL OFL 1.1, github.com/google/fonts) as ArchivoBlack.ttf
//   node build.mjs out        then copy out/*.png into assets/ (play-store-icon-512.png → assets/store/)
// The year lives in the `mark` tag below; change it there each January and re-render.
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const RED = '#E3262B';
const FOLD = '#FFB3B5';
const YELLOW = '#FFC72C';
const INK = '#1A1A1A';
const FONT = 'Archivo Black';

// The mark: page with folded corner, PDF, 2026 tag. Drawn in a 108-unit box.
const mark = (
  pageFill = '#FFFFFF',
  pdfFill = RED,
  foldFill = FOLD,
  tagFill = YELLOW,
  yearFill = INK,
) => `
  <path d="M32 14 H64 L80 30 V76 a4 4 0 0 1 -4 4 H32 a4 4 0 0 1 -4 -4 V18 a4 4 0 0 1 4 -4 Z" fill="${pageFill}"/>
  <path d="M64 14 V26 a4 4 0 0 0 4 4 H80 Z" fill="${foldFill}"/>
  <text x="54" y="60" text-anchor="middle" font-family="${FONT}" font-size="21" fill="${pdfFill}">PDF</text>
  <rect x="26" y="74" width="56" height="20" rx="10" fill="${tagFill}"/>
  <text x="54" y="89" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${yearFill}">2026</text>`;

const svg = (body, { bg } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${bg ? `<rect width="108" height="108" fill="${bg}"/>` : ''}${body}</svg>`;

// Adaptive-icon layers: keep the mark inside the 66-unit safe zone (scale ~0.78 around centre).
const safe = (body) => `<g transform="translate(54 54) scale(0.78) translate(-54 -54)">${body}</g>`;

// Monochrome: one-colour silhouette; PDF and 2026 are cut out of the shapes.
const mono = `
  <defs><mask id="m"><rect width="108" height="108" fill="#fff"/>
    <text x="54" y="60" text-anchor="middle" font-family="${FONT}" font-size="21" fill="#000">PDF</text>
  </mask></defs>
  <g mask="url(#m)"><path d="M32 14 H64 L80 30 V72 H28 V18 a4 4 0 0 1 4 -4 Z" fill="#fff"/></g>
  <defs><mask id="t"><rect width="108" height="108" fill="#fff"/>
    <text x="54" y="89" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#000">2026</text>
  </mask></defs>
  <rect x="26" y="74" width="56" height="20" rx="10" fill="#fff" mask="url(#t)"/>`;

const render = (file, source, size) => {
  const png = new Resvg(source, {
    fitTo: { mode: 'width', value: size },
    font: {
      fontFiles: [path.resolve('ArchivoBlack.ttf')],
      loadSystemFonts: false,
      defaultFontFamily: FONT,
    },
  })
    .render()
    .asPng();
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(file, size, png.length);
};

fs.mkdirSync(OUT, { recursive: true });
// Full-bleed square: Play Store and launchers apply their own mask.
render('icon.png', svg(mark(), { bg: RED }), 1024);
render('play-store-icon-512.png', svg(mark(), { bg: RED }), 512);
render('android-icon-foreground.png', svg(safe(mark())), 1024);
render('android-icon-background.png', svg('', { bg: RED }), 1024);
render('android-icon-monochrome.png', svg(safe(mono)), 1024);
render(
  'splash-icon.png',
  svg(`<rect width="108" height="108" rx="24" fill="${RED}"/>${mark()}`),
  1024,
);
render('favicon.png', svg(mark(), { bg: RED }), 48);
render('check-mono.png', svg(`<circle cx="54" cy="54" r="54" fill="#333"/>${safe(mono)}`), 256);
render(
  'check-adaptive-circle.png',
  svg(
    `<defs><clipPath id="c"><circle cx="54" cy="54" r="54"/></clipPath></defs><g clip-path="url(#c)"><rect width="108" height="108" fill="${RED}"/>${safe(mark())}</g>`,
  ),
  256,
);
render(
  'preview-48.png',
  svg(`<rect width="108" height="108" rx="24" fill="${RED}"/>${mark()}`),
  144,
);
