// T1.4 system-UI checks: opens Print for a PDF and Import in My Files, takes a
// screenshot of each system screen, then returns to the app. It never taps
// inside system UI (only BACK), so no file is printed or imported.
import process from 'node:process';

import * as ui from './ui.mjs';

const FIXTURE = process.env.FIXTURE ?? 'doc_20_100.pdf';
const OUT = process.env.OUT_DIR ?? 'scripts/device/out';

async function systemBack() {
  // System screens are not our app, so the guarded back() would refuse.
  await ui.adb(['shell', 'input', 'keyevent', '4']);
  await ui.sleep(1200);
}

async function main() {
  await ui.launch({ marker: { text: 'Pdf Reader' } });

  // Print
  await ui.tap({ desc: 'Search by name', cls: 'EditText' });
  await ui.clearField();
  await ui.typeText(FIXTURE.replace(/[_.]/g, ' ').replace(/ pdf$/, ''));
  await ui.hideKeyboard();
  await ui.sleep(800);
  await ui.tap({ desc: `More actions for ${FIXTURE}` });
  await ui.tap({ text: 'Print' });
  await ui.sleep(4000);
  await ui.screenshot(`${OUT}/t14-print.png`);
  console.log(`print screen: ${OUT}/t14-print.png`);
  await systemBack();
  await ui.launch({ marker: { text: 'Pdf Reader' } });
  if (await ui.exists({ desc: 'Clear search' })) await ui.tap({ desc: 'Clear search' });

  // Import
  await ui.tap({ text: 'My Files' });
  await ui.tap({ desc: 'Import' });
  await ui.sleep(3000);
  await ui.screenshot(`${OUT}/t14-import.png`);
  console.log(`import screen: ${OUT}/t14-import.png`);
  await systemBack();
  await ui.launch({ marker: { text: 'Pdf Reader' } });
  await ui.screenshot(`${OUT}/t14-after.png`);
  console.log(`after: ${OUT}/t14-after.png`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
