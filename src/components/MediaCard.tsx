import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import type { MediaNowPlaying } from '@/types/vehicleTypes';

// MediaCard — the home-screen "now playing" card.
//
// Structure recovered from the official app's own StyleSheet, not eyeballed.
// The thing that makes it read as Tesla's, and that our first cut got wrong, is
// that it is NOT one card with an internal divider. It is TWO STACKED PANELS
// with a 1pt gap, and the "divider" is the page colour showing through:
//
//   topContainer            { flexDirection:'row', height: 7*Gutter, marginBottom: 1, opacity: 0.9 }
//   bottomContainer         { flexDirection:'row', height: 7*Gutter, marginBottom: 0, opacity: 0.9 }
//   mediaDetailsContainer   { flexDirection:'column', justifyContent:'center',
//                             paddingLeft: 18, paddingRight: 18, borderTopLeftRadius: 0.5*Gutter }
//   sourceIconContainer     { flexDirection:'column', justifyContent:'center', width: 50,
//                             borderTopRightRadius: 0.5*Gutter }
//   controlButtonContainer  { flexDirection:'row', flex:1, alignItems:'center',
//                             justifyContent:'space-between', height: 7*Gutter }
//   controlsVolumeDivider   { width: 0.1*Gutter, marginVertical: 0, backgroundColor: <page> }
//   infoControlsDivider     { height: 1, marginHorizontal: 0, backgroundColor: <page> }
//
// `Gutter` is 10, so both panels are 70pt tall and both dividers are 1pt. The
// divider colour is `theme.backgroundColor` — the PAGE colour — which is why it
// reads as a gap between two panels rather than as a line drawn on one.
//
// Confirmed against a real screenshot: the card measures SCREEN_WIDTH minus
// 2 x 10, and 10 is exactly the recovered `Specifications.homeScreenBoxGutter`.
const GUTTER = 10;
const PANEL_H = 7 * GUTTER; // 70
const PANEL_RADIUS = 0.5 * GUTTER; // 5 — the outer corners only
const HAIRLINE = 1;

// theme.secondaryBackgroundColor on the dark theme, and the same value the
// palette calls `nightCardBackground`. Our previous rgba(255,255,255,0.06) over
// black resolved to ~#0F0F0F — far darker than the real card.
const PANEL_BG = '#222324';
// theme.backgroundColor is #161718 in their app because that is THEIR page.
// Ours is black, and the divider's job is to be the page — so it is black here.
// Copying #161718 onto a black page would draw a visible line where they have a
// gap, which is the opposite of the intent.
const PAGE_BG = '#000000';

// TextCategory.BodyLabel for both lines; the artist differs only by
// TextAppearance.Light -> theme.textColorLight. Same size, not smaller.
const TITLE_COLOR = '#F3F3F3';
const ARTIST_COLOR = '#8A8B8B';

export interface MediaCardProps {
  media: MediaNowPlaying;
  onAction: (action: 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown') => void;
}

// CarServer.MediaSourceType -> a glyph. Tesla ships a per-source NamedIcon set;
// we have not extracted those assets, so this is the nearest SF Symbol per
// source rather than their artwork. The MAPPING is real (the enum is from
// vehicle.proto); only the glyphs are ours.
function sourceSymbol(sourceType: number | undefined): SFSymbol {
  switch (sourceType) {
    case 1: // AM
    case 2: // FM
    case 10: // DAB
    case 13: // USRadio
    case 14: // EURadio
      return 'antenna.radiowaves.left.and.right';
    case 3: // XM
      return 'dot.radiowaves.left.and.right';
    case 8: // Bluetooth
      return 'wave.3.right';
    case 6: // LocalFiles
    case 7: // iPod
      return 'folder.fill';
    default:
      return 'music.note';
  }
}

export function MediaCard({ media, onAction }: MediaCardProps) {
  // Title falls back to station, then source label: a radio stream has no
  // `title` but has a `station`, and a Bluetooth phone has neither but names
  // itself. A card with no text at all is the one outcome worth avoiding.
  const title = media.title ?? media.station ?? media.sourceName ?? null;
  // Never print the title twice — a station whose title fell back to `station`
  // must not repeat it underneath.
  const artist = media.artist && media.artist !== title ? media.artist : null;
  const playing = media.playbackStatus === 1;

  return (
    <View style={styles.card}>
      <View style={styles.topPanel}>
        <View style={styles.details}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {/* Rendered only when the field `isSomething`, so a station with no
              artist collapses to one line instead of leaving a gap. */}
          {artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
          ) : null}
        </View>
        <View style={styles.sourceIcon}>
          <SymbolView name={sourceSymbol(media.sourceType)} tintColor={ARTIST_COLOR} size={22} />
        </View>
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.half}>
          <MediaButton symbol="backward.end.fill" size={24} onPress={() => onAction('prev')} />
          {/* The glyph is the ACTION, not the state — show pause while playing. */}
          <MediaButton
            symbol={playing ? 'pause.fill' : 'play.fill'}
            size={26}
            onPress={() => onAction('toggle')}
          />
          <MediaButton symbol="forward.end.fill" size={24} onPress={() => onAction('next')} />
        </View>
        <View style={styles.volumeDivider} />
        <View style={styles.half}>
          <MediaButton symbol="chevron.left" size={20} tint={ARTIST_COLOR} onPress={() => onAction('volumeDown')} />
          <SymbolView name="speaker.wave.2.fill" tintColor={TITLE_COLOR} size={22} />
          <MediaButton symbol="chevron.right" size={20} tint={ARTIST_COLOR} onPress={() => onAction('volumeUp')} />
        </View>
      </View>
    </View>
  );
}

// A transport control. Nothing here is optimistic — the car owns the truth and
// the play/pause glyph flips when the next read (or the optimistic mirror in
// useFleetState, for toggle only) says so.
function MediaButton({
  symbol,
  size,
  tint = TITLE_COLOR,
  onPress,
}: {
  symbol: SFSymbol;
  size: number;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={14}
      onPress={() => {
        controlHaptic();
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.45 : 1 })}
    >
      <SymbolView name={symbol} tintColor={tint} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No background of its own: the two panels carry it, and the 1pt gap between
  // them is the page. Giving the card a background would fill that gap in.
  card: {
    marginBottom: 8,
  },
  topPanel: {
    flexDirection: 'row',
    height: PANEL_H,
    marginBottom: HAIRLINE,
    opacity: 0.9,
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
  },
  bottomPanel: {
    flexDirection: 'row',
    height: PANEL_H,
    opacity: 0.9,
    backgroundColor: PANEL_BG,
    borderBottomLeftRadius: PANEL_RADIUS,
    borderBottomRightRadius: PANEL_RADIUS,
    overflow: 'hidden',
  },
  details: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    paddingLeft: 18,
    paddingRight: 18,
  },
  sourceIcon: {
    width: 50,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TITLE_COLOR,
  },
  artist: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: ARTIST_COLOR,
  },
  // Each half spreads its three glyphs. `controlsSideSpacer` in their sheet
  // keeps the outer two off the edges; padding does the same job here.
  half: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: PANEL_H,
    paddingHorizontal: 26,
  },
  // 0.1 * Gutter wide, full height (their marginVertical is 0 off-Cybertruck),
  // in the page colour — a gap between the two halves, not a drawn rule.
  volumeDivider: {
    width: HAIRLINE,
    backgroundColor: PAGE_BG,
  },
});
