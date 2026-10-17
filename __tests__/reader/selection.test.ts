import {
  actionBarPosition,
  boundsOf,
  characterCount,
  codePointEnd,
  codePointStart,
  dragHandle,
  handleGeometry,
  hasScrolledAway,
  hasSelectableText,
  hitTestChar,
  lineRects,
  nearestChar,
  pageHitAt,
  selectedText,
  selectionPath,
  selectionRange,
  selectWordAt,
  wordRangeAt,
  type PageText,
  type TextSelection,
} from '@/features/reader/selection';
import type { PageFrame } from '@/features/reader/layout';
import type { PageRotation } from '@/lib/engine';

/** Normalized char width/height used by the fixtures. */
const W = 0.01;
const H = 0.02;

type Line = { text: string; y: number; x?: number };

/**
 * A page made of lines: each UTF-16 unit of a line gets a W×H box from x
 * onwards (both halves of a surrogate pair share one box, like the engine),
 * spaces included; lines are joined by an engine-style "\r\n" with no boxes.
 */
function pageOf(lines: Line[], rotation: PageRotation = 0): PageText {
  let text = '';
  const boxes: number[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      text += '\r\n';
      boxes.push(0, 0, 0, 0, 0, 0, 0, 0);
    }
    let x = line.x ?? 0.1;
    for (let i = 0; i < line.text.length; i += 1) {
      const code = line.text.charCodeAt(i);
      const high = code >= 0xd800 && code <= 0xdbff;
      boxes.push(x, line.y, W, H);
      if (high) {
        boxes.push(x, line.y, W, H);
        i += 1;
      }
      x += W;
    }
    text += line.text;
  });
  return { text, boxes, rotation };
}

/** A view of 1000×1000 dp, so normalized 0.01 = 10 dp. */
const VIEW = { width: 1000, height: 1000 };

/** The view point at the centre of character `index` of an unrotated page. */
function centreOf(page: PageText, index: number) {
  const o = index * 4;
  return {
    x: ((page.boxes[o] ?? 0) + W / 2) * VIEW.width,
    y: ((page.boxes[o + 1] ?? 0) + H / 2) * VIEW.height,
  };
}

function selectionOf(page: PageText, anchor: number, focus: number): TextSelection {
  return {
    page: 0,
    pageText: page,
    anchor,
    focus,
    view: VIEW,
    origin: { x: 0, y: 0 },
    offsets: { main: 0, cross: 0 },
  };
}

describe('code points', () => {
  const text = 'a😀b';
  it('never splits a surrogate pair', () => {
    expect(codePointStart(text, 2)).toBe(1);
    expect(codePointStart(text, 1)).toBe(1);
    expect(codePointEnd(text, 1)).toBe(3);
    expect(codePointEnd(text, 0)).toBe(1);
    expect(characterCount(text)).toBe(3);
  });
});

describe('wordRangeAt', () => {
  const word = (text: string, index: number) => {
    const range = wordRangeAt(text, index);
    return text.slice(range.start, range.end);
  };

  it('expands to letters and digits around the index', () => {
    expect(word('pay 2500 naira now', 6)).toBe('2500');
    expect(word('pay 2500 naira now', 10)).toBe('naira');
  });

  it('keeps accented and Hausa letters in the word', () => {
    expect(word('le café ouvert', 5)).toBe('café');
    expect(word('ɗan ƙasa ɓarna ƴaƴa', 5)).toBe('ƙasa');
    expect(word('ɗan ƙasa ɓarna ƴaƴa', 10)).toBe('ɓarna');
    expect(word('ɗan ƙasa ɓarna ƴaƴa', 16)).toBe('ƴaƴa');
    // A decomposed accent (e + combining acute) stays with its letter.
    expect(word('café noir', 1)).toBe('café');
  });

  it('keeps apostrophes inside a word only', () => {
    expect(word("don't stop", 1)).toBe("don't");
    expect(word('l’école', 3)).toBe('l’école');
    expect(word("'quoted' text", 3)).toBe('quoted');
  });

  it('stops at punctuation, and selects punctuation on its own', () => {
    expect(word('end. Next', 1)).toBe('end');
    expect(word('end. Next', 3)).toBe('.');
    expect(word('well-known', 0)).toBe('well');
  });

  it('keeps supplementary-plane letters whole', () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A is a letter outside the BMP.
    const text = 'x \u{1D400}\u{1D401} y';
    const range = wordRangeAt(text, 3);
    expect(range).toEqual({ start: 2, end: 6 });
    expect(text.slice(range.start, range.end)).toBe('\u{1D400}\u{1D401}');
  });
});

describe('hit testing', () => {
  const page = pageOf([
    { text: 'Hello world', y: 0.1 },
    { text: 'second line', y: 0.2 },
  ]);

  it('finds the character under the point', () => {
    expect(hitTestChar(page, centreOf(page, 1), VIEW)).toBe(1);
    // "second" starts after "Hello world" + "\r\n".
    expect(hitTestChar(page, centreOf(page, 13), VIEW)).toBe(13);
  });

  it('takes the nearest character on the same line within the tolerance', () => {
    // 8 dp right of the last character of "Hello world".
    const end = centreOf(page, 10);
    expect(hitTestChar(page, { x: end.x + 5 + 8, y: end.y }, VIEW)).toBe(10);
    // 40 dp away: blank.
    expect(hitTestChar(page, { x: end.x + 5 + 40, y: end.y }, VIEW)).toBeNull();
  });

  it('finds nothing on a blank area', () => {
    expect(hitTestChar(page, { x: 900, y: 900 }, VIEW)).toBeNull();
    expect(selectWordAt(page, { x: 900, y: 900 }, VIEW)).toBeNull();
  });

  it('never picks a space', () => {
    // The space between "Hello" and "world" (index 5) resolves to a neighbour.
    const hit = hitTestChar(page, centreOf(page, 5), VIEW);
    expect([4, 6]).toContain(hit);
  });

  it('selects the word under a long press', () => {
    expect(selectWordAt(page, centreOf(page, 7), VIEW)).toEqual({ anchor: 6, focus: 10 });
  });

  it('maps the press through the page rotation', () => {
    // At 90°, unrotated (u, v) is displayed at (1 − v, u).
    const rotated = pageOf([{ text: 'Rotated text', y: 0.3 }], 90);
    const u = 0.1 + 2 * W + W / 2;
    const v = 0.3 + H / 2;
    const point = { x: (1 - v) * VIEW.width, y: u * VIEW.height };
    expect(hitTestChar(rotated, point, VIEW)).toBe(2);
    expect(selectWordAt(rotated, point, VIEW)).toEqual({ anchor: 0, focus: 6 });
  });

  it('knows an image-only page has nothing to select', () => {
    expect(hasSelectableText({ text: '', boxes: [], rotation: 0 })).toBe(false);
    // Only generated whitespace without boxes.
    expect(hasSelectableText({ text: ' \r\n', boxes: new Array(12).fill(0), rotation: 0 })).toBe(
      false,
    );
    expect(hasSelectableText(page)).toBe(true);
  });

  it('keeps an emoji whole under the press', () => {
    const emoji = pageOf([{ text: 'hi 😀 there', y: 0.1 }]);
    // Both halves share a box; the hit returns the pair's first unit.
    const hit = hitTestChar(emoji, centreOf(emoji, 3), VIEW);
    expect(hit).toBe(3);
    expect(wordRangeAt(emoji.text, 4)).toEqual({ start: 3, end: 5 });
  });
});

describe('dragging handles', () => {
  const page = pageOf([
    { text: 'alpha beta', y: 0.1 },
    { text: 'gamma delta', y: 0.2 },
  ]);
  // "beta" = 6..9, "gamma" starts at 12.

  it('moves the focus by character across lines, in reading order', () => {
    const start = selectionOf(page, 6, 9);
    const moved = dragHandle(start, 'focus', centreOf(page, 14));
    expect(moved.focus).toBe(14);
    expect(selectedText(page, selectionRange(moved))).toBe('beta\ngam');
  });

  it('swaps when the handles cross', () => {
    const start = selectionOf(page, 6, 9);
    const moved = dragHandle(start, 'focus', centreOf(page, 1));
    expect(selectionRange(moved)).toEqual({ start: 1, end: 7 });
    expect(handleGeometry(moved, 'focus')?.isStart).toBe(true);
    expect(handleGeometry(moved, 'anchor')?.isStart).toBe(false);
  });

  it('returns the same selection when the character does not change', () => {
    const start = selectionOf(page, 6, 9);
    expect(dragHandle(start, 'focus', centreOf(page, 9))).toBe(start);
  });

  it('prefers the line under the finger', () => {
    // Below the end of line 1, well left of line 2's start: line 2 wins.
    const point = { x: 50, y: (0.2 + H / 2) * VIEW.height };
    expect(nearestChar(page, point, VIEW)).toBe(12);
  });

  it('places the start handle at the bottom-left and the end at the bottom-right', () => {
    const selection = selectionOf(page, 6, 9);
    const start = handleGeometry(selection, 'anchor');
    expect(start?.tip.x).toBeCloseTo(160);
    expect(start?.tip.y).toBeCloseTo(120);
    const end = handleGeometry(selection, 'focus');
    expect(end?.tip.x).toBeCloseTo(200);
    expect(end?.tip.y).toBeCloseTo(120);
  });
});

describe('selection geometry and text', () => {
  const page = pageOf([
    { text: 'first   line', y: 0.1 },
    { text: 'next line', y: 0.2 },
  ]);

  it('merges each line into one rect', () => {
    const rects = lineRects(page, { start: 0, end: page.text.length }, VIEW);
    expect(rects).toHaveLength(2);
    expect(rects[0]?.x).toBeCloseTo(100);
    expect(rects[0]?.width).toBeCloseTo(120);
    expect(rects[1]?.y).toBeCloseTo(200);
  });

  it('starts a new rect on a change of line without a text break', () => {
    // Two lines with no "\r\n" between them in the text.
    const one = pageOf([{ text: 'top', y: 0.1 }]);
    const two = pageOf([{ text: 'low', y: 0.3 }]);
    const joined: PageText = {
      text: one.text + two.text,
      boxes: [...one.boxes, ...two.boxes],
      rotation: 0,
    };
    expect(lineRects(joined, { start: 0, end: 6 }, VIEW)).toHaveLength(2);
    expect(selectedText(joined, { start: 0, end: 6 })).toBe('top\nlow');
  });

  it('collapses runs of spaces and breaks lines', () => {
    expect(selectedText(page, { start: 0, end: page.text.length })).toBe('first line\nnext line');
  });

  it('handles generated spaces without boxes', () => {
    const generated: PageText = {
      text: 'a b',
      boxes: [0.1, 0.1, W, H, 0, 0, 0, 0, 0.12, 0.1, W, H],
      rotation: 0,
    };
    expect(selectedText(generated, { start: 0, end: 3 })).toBe('a b');
    expect(lineRects(generated, { start: 0, end: 3 }, VIEW)).toHaveLength(1);
  });

  it('draws the rects as one SVG path, rotated with the page', () => {
    const rects = [{ x: 10, y: 20, width: 30, height: 5 }];
    expect(selectionPath(rects)).toBe('M10 20h30v5h-30Z');
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([rects[0]!, { x: 0, y: 40, width: 5, height: 5 }])).toEqual({
      x: 0,
      y: 20,
      width: 40,
      height: 25,
    });
  });
});

/**
 * A page whose text reads level ON SCREEN on a page with /Rotate
 * `rotation`: each line runs left to right in displayed space from x 0.1 at
 * displayed y; the boxes are turned back into unrotated page space, like the
 * engine reports them (e.g. a sideways scan put upright with /Rotate 90).
 */
function levelOnScreen(lines: Line[], rotation: PageRotation): PageText {
  const shown = pageOf(lines, 0);
  const boxes: number[] = [];
  for (let i = 0; i < shown.boxes.length; i += 4) {
    const nx = shown.boxes[i] ?? 0;
    const ny = shown.boxes[i + 1] ?? 0;
    const nw = shown.boxes[i + 2] ?? 0;
    const nh = shown.boxes[i + 3] ?? 0;
    if (nw === 0 && nh === 0) {
      boxes.push(0, 0, 0, 0);
      continue;
    }
    // Inverse of normalizedRectToView for each rotation.
    switch (rotation) {
      case 0:
        boxes.push(nx, ny, nw, nh);
        break;
      case 90:
        boxes.push(ny, 1 - nx - nw, nh, nw);
        break;
      case 180:
        boxes.push(1 - nx - nw, 1 - ny - nh, nw, nh);
        break;
      case 270:
        boxes.push(1 - ny - nh, nx, nh, nw);
        break;
    }
  }
  return { text: shown.text, boxes, rotation };
}

describe('rotated pages and right-to-left text', () => {
  const lines = [
    { text: 'Sannu da', y: 0.1 },
    { text: 'zuwa gida', y: 0.2 },
  ];
  /** Displayed point over character `index` (same layout as pageOf at 0°). */
  const shownCentre = (index: number) => centreOf(pageOf(lines, 0), index);

  it.each<PageRotation>([90, 180, 270])(
    'keeps text that reads level on screen as lines at %i°',
    (rotation) => {
      const page = levelOnScreen(lines, rotation);
      const all = { start: 0, end: page.text.length };
      expect(selectedText(page, all)).toBe('Sannu da\nzuwa gida');
      const rects = lineRects(page, all, VIEW);
      expect(rects).toHaveLength(2);
      expect(rects[0]?.x).toBeCloseTo(100);
      expect(rects[0]?.y).toBeCloseTo(100);
      expect(rects[0]?.width).toBeCloseTo(80);
      expect(rects[0]?.height).toBeCloseTo(20);
    },
  );

  it.each<PageRotation>([90, 180, 270])('hit-tests and drags on screen axes at %i°', (rotation) => {
    const page = levelOnScreen(lines, rotation);
    // 10 dp right of the end of "da": same line on screen, within tolerance.
    const end = shownCentre(7);
    expect(hitTestChar(page, { x: end.x + 5 + 10, y: end.y }, VIEW)).toBe(7);
    expect(selectWordAt(page, shownCentre(1), VIEW)).toEqual({ anchor: 0, focus: 4 });
    // Far left of line 2, level with it: line 2 wins over line 1.
    expect(nearestChar(page, { x: 20, y: shownCentre(10).y }, VIEW)).toBe(10);
    const handle = handleGeometry(selectionOf(page, 0, 4), 'anchor');
    expect(handle?.tip.x).toBeCloseTo(100);
    expect(handle?.tip.y).toBeCloseTo(120);
  });

  it('keeps a right-to-left run on one line', () => {
    // Characters in reading order, each placed left of the previous one.
    const text = 'abcd';
    const boxes: number[] = [];
    for (let i = 0; i < text.length; i += 1) boxes.push(0.5 - i * W, 0.1, W, H);
    const page: PageText = { text, boxes, rotation: 0 };
    expect(selectedText(page, { start: 0, end: 4 })).toBe('abcd');
    const rects = lineRects(page, { start: 0, end: 4 }, VIEW);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.x).toBeCloseTo(470);
    expect(rects[0]?.width).toBeCloseTo(40);
  });
});

describe('pageHitAt', () => {
  const frame: PageFrame = {
    cellWidth: 400,
    cellHeight: 608,
    pageWidth: 400,
    pageHeight: 600,
    left: 0,
    top: 8,
  };
  const spans = [
    { index: 0, start: 0, length: 608 },
    { index: 1, start: 608, length: 608 },
  ];

  it('finds the page and the point on it (vertical)', () => {
    expect(pageHitAt(spans, () => frame, 700, 50, false)).toEqual({
      page: 1,
      point: { x: 50, y: 84 },
      view: { width: 400, height: 600 },
    });
  });

  it('finds the page across a horizontal list', () => {
    const paged = { ...frame, cellWidth: 400, cellHeight: 900, left: 0, top: 150 };
    const hit = pageHitAt(
      [
        { index: 0, start: 0, length: 400 },
        { index: 1, start: 400, length: 400 },
      ],
      () => paged,
      450,
      200,
      true,
    );
    expect(hit).toEqual({ page: 1, point: { x: 50, y: 50 }, view: { width: 400, height: 600 } });
  });

  it('is null in the gap above a page or past the list', () => {
    expect(pageHitAt(spans, () => frame, 612, 50, false)).toBeNull();
    expect(pageHitAt(spans, () => frame, 5000, 50, false)).toBeNull();
  });
});

describe('scroll and action bar placement', () => {
  it('treats only real movement as a scroll', () => {
    expect(hasScrolledAway({ main: 100, cross: 0 }, { main: 101, cross: 0 })).toBe(false);
    expect(hasScrolledAway({ main: 100, cross: 0 }, { main: 110, cross: 0 })).toBe(true);
    expect(hasScrolledAway({ main: 100, cross: 0 }, { main: 100, cross: 5 })).toBe(true);
  });

  const base = {
    bar: { width: 200, height: 48 },
    area: { width: 400, height: 800 },
    top: 80,
    bottom: 100,
    handleSpace: 26,
  };

  it('goes centred above the selection', () => {
    expect(
      actionBarPosition({ ...base, selection: { x: 100, y: 400, width: 100, height: 20 } }),
    ).toEqual({ x: 50, y: 344 });
  });

  it('goes below the selection and its handles when there is no room above', () => {
    expect(
      actionBarPosition({ ...base, selection: { x: 100, y: 100, width: 100, height: 20 } }),
    ).toEqual({ x: 50, y: 154 });
  });

  it('stays inside the free part of the screen', () => {
    const position = actionBarPosition({
      ...base,
      selection: { x: 350, y: 60, width: 40, height: 700 },
    });
    expect(position.x).toBe(400 - 8 - 200);
    expect(position.y).toBe(800 - 100 - 8 - 48);
  });
});
