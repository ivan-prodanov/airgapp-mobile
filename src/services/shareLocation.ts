// shareLocation — what leaves the app through the native iOS share sheet when you
// share a place (long-pressed pin, tapped POI, or charger).
//
// The label follows the SAME rules as a send to the car (destinationTitle): a
// synthesised placeholder like "Dropped Pin" is useless to whoever you share
// with, so it falls through to the coordinate, which at least says where it is.
//
// The url is an Apple Maps universal link. On iOS it renders as a rich map bubble
// in Messages/Mail and opens Apple Maps when tapped; ll pins the exact point and q
// labels it. (Waze and Apple Maps have no receive-share extension, so this is a
// share-to-a-person / copy-the-link feature, not a jump-into-a-map-app one.)
//
// No React Native imports — node-testable. The Share.share() call lives in
// useShareLocation, the same split as destinationTitle vs useSendToCar.

import { destinationTitle, type TitleInput } from '@/services/destinationTitle';

export type ShareTarget = TitleInput;

export interface ShareContent {
  message: string;
  url: string;
}

export function shareLocationContent(target: ShareTarget): ShareContent {
  const title = destinationTitle(target);
  const { latitude, longitude } = target.coordinate;
  const url = `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(title)}`;
  return { message: title, url };
}
