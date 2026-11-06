/// <reference types="expo/types" />

// Committed on purpose. Expo generates `expo-env.d.ts` (the same reference) but gitignores it, so a
// fresh checkout / CI has no reference to Expo's ambient types — and tsc then fails on things that
// rely on them, e.g. `import './animated-icon.module.css'` in the .web.tsx files (the `*.module.css`
// module is declared in node_modules/expo/types/global.d.ts, loaded via this reference).
// `tsc` dedupes the reference directive, so having both this and expo-env.d.ts locally is harmless.
