// T1.4 smoke test: file actions + My Files, driven over adb.
//   node scripts/device/t14-file-actions.mjs
// Env: DEVICE, FIXTURE, RENAMED, FOLDER, DEV=1, FRESH=1 (see README.md).
// Labels come from src/i18n/locales/en.ts; the phone must be in English.
import process from 'node:process';

import { createRun } from './run.mjs';
import * as ui from './ui.mjs';

const FIXTURE = process.env.FIXTURE ?? 'doc_20_100.pdf';
const RENAMED = process.env.RENAMED ?? 'smoke_t14_renamed.pdf';
const FOLDER = process.env.FOLDER ?? 'Smoke A';

// ---- labels (en.ts)
const L = {
  appTitle: 'Pdf Reader', // app.config.ts name, the library header
  search: 'Search by name', // library.searchPlaceholder (accessibilityLabel)
  clearSearch: 'Clear search',
  sources: 'Sources', // library.chipsLabel (chips ScrollView)
  chipAll: 'All',
  chipMyFiles: 'My Files',
  favorites: 'Favorites', // library.favorites shelf header
  moreFor: (name) => `More actions for ${name}`,
  details: 'Details',
  rename: 'Rename',
  duplicate: 'Duplicate',
  favorite: 'Add to favorites',
  unfavorite: 'Remove from favorites',
  move: 'Move',
  del: 'Delete',
  nameField: 'Name', // fileActions.nameLabel (TextInput accessibilityLabel)
  save: 'Save',
  newFolder: 'New folder',
  create: 'Create',
  moveHere: 'Move here',
  folderRow: (name) => `${name}, folder`, // folders.folderLabel
  folderEmpty: 'This folder is empty',
  deleteTitle: (name) => `Delete “${name}”?`, // fileActions/folders.deleteTitle
};

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = (name) => name.replace(/\.[^.]+$/, '');

/** A library/My Files file row or tile: its label starts with "<name>, ". */
const fileRow = (name) => ({ descRegex: new RegExp(`^${reEscape(name)}, `) });
const sheetItem = (label) => ({ desc: label, clickable: true });

// ---- helpers

async function setSearch(query) {
  if (await ui.exists({ desc: L.clearSearch })) await ui.tap({ desc: L.clearSearch });
  if (query !== '') {
    await ui.tap({ desc: L.search, cls: 'EditText' });
    await ui.clearField();
    await ui.typeText(query);
    await ui.pressEnter();
  }
  await ui.hideKeyboard();
  await ui.sleep(500); // search debounce + query
}

/** Taps a source chip, scrolling the chip row sideways if needed. */
async function selectChip(label) {
  const row = await ui.find({ desc: L.sources });
  const inRow = (n) =>
    n.center.y >= row.bounds.y1 &&
    n.center.y <= row.bounds.y2 &&
    n.center.x > row.bounds.x1 &&
    n.center.x < row.bounds.x2;
  const chip = await ui.scrollUntil(
    { text: label, where: inRow },
    { direction: label === L.chipAll ? 'left' : 'right', maxSwipes: 3, area: row.bounds },
  );
  await ui.tap(chip);
  await ui.sleep(500);
}

/** Selects the All type tab (the first "All" above the chip row). */
async function selectAllTab() {
  const row = await ui.find({ desc: L.sources });
  const tab = await ui.find({ text: L.chipAll, where: (n) => n.center.y < row.bounds.y1 });
  await ui.tap(tab);
}

/** Opens the actions sheet of a file/folder row (scrolling to it). */
async function openActions(name) {
  const more = await ui.scrollUntil({ desc: L.moreFor(name) });
  await ui.tap(more);
  await ui.find(sheetItem(L.del));
}

async function chooseAction(label) {
  await ui.tap(sheetItem(label));
}

/** Types a full new name into the open name dialog and submits it. */
async function submitName(name) {
  await ui.find({ desc: L.nameField, cls: 'EditText' });
  await ui.focusedField();
  await ui.clearField();
  await ui.typeText(name);
  const field = await ui.focusedField();
  if (field.text !== name) throw new Error(`name field shows "${field.text}", expected "${name}"`);
  await ui.pressEnter(); // onSubmitEditing submits
  await ui.waitGone({ desc: L.nameField, cls: 'EditText' });
  await ui.hideKeyboard();
}

/** Deletes via the open dialog after checking its title names `name`. */
async function confirmDelete(name) {
  const title = await ui.find({ text: L.deleteTitle(name) });
  // The dialog's Delete button sits below its title (a closing sheet may
  // still list a "Delete" row for a moment).
  await ui.tap({ desc: L.del, clickable: true, where: (n) => n.center.y > title.bounds.y2 });
  await ui.waitGone({ text: L.deleteTitle(name) }, { timeoutMs: 15000 });
}

// ---- scenario

const MANUAL_CHECKLIST = `
Manual checks (system UI, not automated):
  [ ] Print: library -> More actions for a PDF -> Print. The Android print
      preview opens with the right page count; Back returns to the library
      with no error toast.
  [ ] Import: My Files chip -> Import. The system picker opens; pick 2 files;
      toast "Imported to My Files (2)" and both appear in My Files. Cancel
      the picker once: nothing changes, no error.
`;

async function main() {
  const run = await createRun('T1.4 file actions + My Files');
  const { step } = run;
  const state = { renamed: false, favorited: false, folder: false, dup: null, dupMoved: false };

  try {
    await step('a. launch, library title visible', async () => {
      await ui.launch({
        marker: { text: L.appTitle },
        dev: process.env.DEV === '1',
        fresh: process.env.FRESH === '1',
      });
      await run.rememberPid();
      await selectAllTab();
      await selectChip(L.chipAll);
    });

    await step(`preflight: no leftover "${RENAMED}" from an earlier run`, async () => {
      await setSearch(baseName(RENAMED));
      if (await ui.exists(fileRow(RENAMED))) {
        throw new Error(`"${RENAMED}" already exists; rename it back to ${FIXTURE} first`);
      }
    });

    await step(`b. details of ${FIXTURE} show name/size/location`, async () => {
      await setSearch(baseName(FIXTURE));
      await ui.scrollUntil(fileRow(FIXTURE));
      await openActions(FIXTURE);
      await chooseAction(L.details);
      await ui.find({ desc: `${L.nameField}, ${FIXTURE}` });
      await ui.find({ descRegex: /^Size, \S/ });
      await ui.find({ descRegex: /^Location, \S/ });
      await ui.back();
      await ui.waitGone({ descRegex: /^Location, / });
    });

    await step(`c. rename ${FIXTURE} -> ${RENAMED}`, async () => {
      await openActions(FIXTURE);
      await chooseAction(L.rename);
      await submitName(RENAMED);
      state.renamed = true;
      await setSearch(baseName(RENAMED));
      await ui.scrollUntil(fileRow(RENAMED));
      await setSearch(baseName(FIXTURE));
      if (await ui.exists(fileRow(FIXTURE))) throw new Error(`old name ${FIXTURE} still listed`);
    });

    await step('d. duplicate -> "(copy)" entry appears', async () => {
      await setSearch(baseName(RENAMED));
      const copyRe = new RegExp(`^(${reEscape(baseName(RENAMED))} \\(copy(?: \\d+)?\\)\\.pdf), `);
      const before = new Set((await ui.findAll({ descRegex: copyRe })).map((n) => n.desc));
      await openActions(RENAMED);
      await chooseAction(L.duplicate);
      const deadline = Date.now() + 10000;
      for (;;) {
        const fresh = (await ui.findAll({ descRegex: copyRe })).find((n) => !before.has(n.desc));
        if (fresh) {
          state.dup = copyRe.exec(fresh.desc)[1];
          break;
        }
        if (Date.now() > deadline) throw new Error('no new "(copy)" row appeared');
        await ui.sleep(400);
      }
      console.log(`       duplicate: ${state.dup}`);
    });

    await step('e. favorite -> star in sheet + Favorites shelf', async () => {
      await openActions(RENAMED);
      await chooseAction(L.favorite);
      state.favorited = true;
      await openActions(RENAMED);
      await ui.find(sheetItem(L.unfavorite));
      await ui.back();
      await ui.waitGone(sheetItem(L.unfavorite));
      await setSearch('');
      // Shelf cards are the only file cards narrower than half the screen
      // (list rows span the width), so no header position is needed: swipes
      // can scroll the header away while the card stays visible.
      await ui.scrollUntil({ text: L.favorites }, { direction: 'up' });
      const screenW = ui.getLastDump().screen.w;
      const inShelf = (n) => n.bounds.y2 > n.bounds.y1 && n.bounds.x2 - n.bounds.x1 < screenW / 2;
      await ui.scrollUntil({ ...fileRow(RENAMED), where: inShelf }, { direction: 'up' });
    });

    await step(`f. My Files: create "${FOLDER}", open it, back to root`, async () => {
      await selectChip(L.chipMyFiles);
      await ui.find({ desc: L.newFolder });
      if (await ui.exists({ desc: L.folderRow(FOLDER) })) {
        throw new Error(`folder "${FOLDER}" already exists; delete it first`);
      }
      await ui.tap({ desc: L.newFolder });
      await submitName(FOLDER);
      state.folder = true;
      await ui.tap(await ui.scrollUntil({ desc: L.folderRow(FOLDER) }));
      await ui.find({ text: L.folderEmpty });
      await ui.find({ text: FOLDER });
      await ui.back(); // BackHandler: up one folder
      await ui.find({ desc: L.folderRow(FOLDER) });
      await ui.waitGone({ text: L.folderEmpty });
    });

    await step(`g. move duplicate into "${FOLDER}"`, async () => {
      await selectChip(L.chipAll);
      await setSearch(baseName(RENAMED));
      await openActions(state.dup);
      await chooseAction(L.move);
      await ui.tap(await ui.find({ desc: L.folderRow(FOLDER), clickable: true }));
      await ui.find({ text: FOLDER });
      await ui.tap({ desc: L.moveHere });
      await ui.waitGone({ desc: L.moveHere }, { timeoutMs: 15000 });
      state.dupMoved = true;
      await setSearch('');
      await selectChip(L.chipMyFiles);
      await ui.tap(await ui.scrollUntil({ desc: L.folderRow(FOLDER) }));
      await ui.find(fileRow(state.dup));
    });

    await step('h. delete the moved file (dialog names it)', async () => {
      await openActions(state.dup);
      await chooseAction(L.del);
      await confirmDelete(state.dup);
      await ui.waitGone(fileRow(state.dup));
      await ui.find({ text: L.folderEmpty });
      state.dup = null;
    });

    await step(`i. delete folder "${FOLDER}" (dialog names it)`, async () => {
      await ui.back(); // up to the My Files root
      await ui.find({ desc: L.folderRow(FOLDER) });
      await openActions(FOLDER);
      await chooseAction(L.del);
      await confirmDelete(FOLDER);
      await ui.waitGone({ desc: L.folderRow(FOLDER) });
      state.folder = false;
    });

    await step(`j. cleanup: unfavorite, rename back to ${FIXTURE}`, async () => {
      await selectChip(L.chipAll);
      await setSearch(baseName(RENAMED));
      await openActions(RENAMED);
      await chooseAction(L.unfavorite);
      state.favorited = false;
      await openActions(RENAMED);
      await chooseAction(L.rename);
      await submitName(FIXTURE);
      state.renamed = false;
      await setSearch(baseName(FIXTURE));
      await ui.scrollUntil(fileRow(FIXTURE));
      await setSearch('');
    });

    await step('k. no crashes in logcat for the whole run', async () => {
      const problems = await run.crashCheck();
      if (problems.length > 0) throw new Error(problems.join('\n       '));
    });
  } catch (error) {
    if (!error.stepLogged) console.log(`ERROR ${error.stack ?? error}`);
    const left = [];
    if (state.renamed) left.push(`rename "${RENAMED}" back to "${FIXTURE}"`);
    if (state.favorited) left.push(`remove "${RENAMED}" from favorites`);
    if (state.dup) {
      left.push(`delete "${state.dup}"${state.dupMoved ? ` in My Files/${FOLDER}` : ''}`);
    }
    if (state.folder) left.push(`delete My Files folder "${FOLDER}"`);
    if (left.length > 0) console.log(`\nManual cleanup needed:\n  - ${left.join('\n  - ')}`);
  }

  run.summary();
  console.log(MANUAL_CHECKLIST);
}

await main();
