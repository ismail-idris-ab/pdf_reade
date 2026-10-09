import {
  centerOf,
  decodeEntities,
  escapeInputText,
  findCrashLines,
  findNodes,
  parseBounds,
  parseDump,
  parseFocusedPackage,
} from '../../scripts/device/parse.cjs';

const PKG = 'com.ismailidris.pdfreader';

const XML = `UI hierchary dumped to: /dev/tty
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2340]">
  <node index="0" text="Pdf Reader" resource-id="" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[42,120][600,200]" />
  <node index="1" text="" resource-id="library-more-7" class="android.view.ViewGroup" package="${PKG}" content-desc="More actions for a &amp; b (copy).pdf" clickable="true" long-clickable="false" enabled="true" bounds="[960,300][1080,420]" />
  <node index="2" text="" class="android.widget.EditText" package="${PKG}" content-desc="Search by name" focused="true" clickable="true" bounds="[60,220][1020,330]">
    <node index="0" text="line1&#10;&quot;q&quot; &#x201C;x&#x201D;" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[bad]" />
  </node>
</node>
</hierarchy>`;

describe('parseBounds / centerOf', () => {
  it('parses bounds and rounds the centre', () => {
    const b = parseBounds('[960,300][1080,421]');
    expect(b).toEqual({ x1: 960, y1: 300, x2: 1080, y2: 421 });
    expect(centerOf(b!)).toEqual({ x: 1020, y: 361 });
  });

  it('returns null for malformed bounds', () => {
    expect(parseBounds('[1,2]')).toBeNull();
    expect(parseBounds(undefined as unknown as string)).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities and keeps unknown ones', () => {
    expect(decodeEntities('a &amp; b &lt;&gt; &#10;&#x41; &nbsp;')).toBe('a & b <> \nA &nbsp;');
  });
});

describe('parseDump', () => {
  const { nodes, rotation } = parseDump(XML);

  it('reads every node in document order with parents', () => {
    expect(rotation).toBe(0);
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 1, 1, 2]);
    expect(nodes[4]!.parent).toBe(3);
    expect(nodes[1]!.parent).toBe(0);
  });

  it('maps attributes and decodes entities', () => {
    const more = nodes[2]!;
    expect(more.desc).toBe('More actions for a & b (copy).pdf');
    expect(more.resourceId).toBe('library-more-7');
    expect(more.clickable).toBe(true);
    expect(more.longClickable).toBe(false);
    expect(more.pkg).toBe(PKG);
    expect(more.center).toEqual({ x: 1020, y: 360 });
    expect(nodes[4]!.text).toBe('line1\n"q" “x”');
  });

  it('gives zero bounds to unparsable bounds and defaults enabled', () => {
    expect(nodes[4]!.bounds).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
    expect(nodes[1]!.enabled).toBe(true);
  });

  it('tolerates empty or junk input', () => {
    expect(parseDump('').nodes).toEqual([]);
    expect(parseDump('ERROR: could not get idle state.').nodes).toEqual([]);
  });

  it('finds nodes by text, desc, regex, class and predicate', () => {
    expect(findNodes(nodes, { text: 'Pdf Reader' })).toHaveLength(1);
    expect(findNodes(nodes, { label: 'Search by name' })[0]!.cls).toContain('EditText');
    expect(findNodes(nodes, { descContains: '(copy)' })).toHaveLength(1);
    expect(findNodes(nodes, { descRegex: /^More actions for / })).toHaveLength(1);
    expect(findNodes(nodes, { regex: 'Pdf' })).toHaveLength(1);
    expect(findNodes(nodes, { cls: 'EditText', focused: true })).toHaveLength(1);
    expect(findNodes(nodes, { clickable: true, where: (n) => n.center.x > 900 })).toHaveLength(1);
    expect(findNodes(nodes, { text: 'Pdf Reader', clickable: true })).toHaveLength(0);
  });
});

describe('escapeInputText', () => {
  it('escapes spaces and shell characters', () => {
    expect(escapeInputText('Smoke A')).toBe('Smoke%sA');
    expect(escapeInputText('a (copy)&b.pdf')).toBe('a%s\\(copy\\)\\&b.pdf');
    expect(escapeInputText("it's")).toBe("it\\'s");
  });

  it('rejects non-ASCII and %', () => {
    expect(() => escapeInputText('Résumé')).toThrow(/ASCII/);
    expect(() => escapeInputText('100%')).toThrow(/%/);
  });
});

describe('findCrashLines', () => {
  const log = [
    '10-07 21:00:00.100  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main',
    `10-07 21:00:00.101  1234  1234 E AndroidRuntime: Process: ${PKG}, PID: 1234`,
    '10-07 21:00:01.000  1234  1300 E ReactNativeJS: TypeError: undefined is not a function',
    '10-07 21:00:01.500  9999  9999 E ReactNativeJS: another app',
    '10-07 21:00:02.000  1234  1301 F libc    : Fatal signal 11 (SIGSEGV), code 1',
    `10-07 21:00:03.000   500   600 E ActivityManager: ANR in ${PKG}`,
    '10-07 21:00:04.000  1234  1234 I ReactNativeJS: fine',
    'garbage line',
  ].join('\n');

  it('reports the app crashes only', () => {
    const kinds = findCrashLines(log, { pkg: PKG, pids: [1234] }).map((c) => c.kind);
    expect(kinds).toEqual([
      'FATAL EXCEPTION',
      'FATAL EXCEPTION',
      'E ReactNativeJS',
      'Fatal signal',
      'ANR',
    ]);
  });

  it('is empty for a clean log', () => {
    expect(findCrashLines('10-07 21:00:04.000  1 1 I X: ok', { pkg: PKG, pids: [1] })).toEqual([]);
  });
});

describe('parseFocusedPackage', () => {
  it('reads mCurrentFocus, falling back to mFocusedApp', () => {
    expect(parseFocusedPackage(`  mCurrentFocus=Window{a1 u0 ${PKG}/${PKG}.MainActivity}`)).toBe(
      PKG,
    );
    expect(
      parseFocusedPackage(
        '  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{b2 u0 com.sec.android.app.launcher/.Launcher t1}',
      ),
    ).toBe('com.sec.android.app.launcher');
    expect(parseFocusedPackage('')).toBeNull();
  });
});
