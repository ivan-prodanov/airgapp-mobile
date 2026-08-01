import { useCallback } from 'react';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';

import { shareLocationContent, type ShareTarget } from '@/services/shareLocation';

// Opens the native iOS share sheet (UIActivityViewController) for a place. The
// content-building rules live in the node-tested shareLocationContent; this is the
// thin React Native call, the same split as useSendToCar vs destinationTitle.
//
// Light impact: sharing is a confirm/nav-class action, not a primary one (that
// tier is Medium/Rigid — see controlHaptic). A dismissed sheet resolves normally
// on iOS, so there is nothing to report; only a real failure is swallowed.
export function useShareLocation(): (target: ShareTarget) => void {
  return useCallback((target: ShareTarget) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Share.share(shareLocationContent(target)).catch(() => {});
  }, []);
}
