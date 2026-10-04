// Imported first by app/_layout.tsx so crash reporting is active before any
// other app module is evaluated.
import { initCrashReporting } from './index';

initCrashReporting();
