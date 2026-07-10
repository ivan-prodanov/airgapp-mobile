import * as Haptics from 'expo-haptics';

// The firm "click" every control press shares — the favorites bar, the Customize Controls grid, the Controls
// screen bottom bar, and the closure markers all fire this one Rigid impact so the whole control surface feels
// consistent. Kept out of controlActions.ts so that node-test importers of the action catalog don't pull in the
// native haptics module.
export const controlHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
