import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import {
  MEDIA_APPLE_MUSIC_URI,
  MEDIA_BLUETOOTH_URI,
  MEDIA_RADIO_URI,
  MEDIA_SIRIUSXM_URI,
  MEDIA_SPOTIFY_URI,
  MEDIA_TIDAL_URI,
  MEDIA_TUNEIN_URI,
} from '@/constants/mediaSourceIcons';
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
  // Cover art for the current track, when we have it. The CAR cannot supply
  // this — neither MediaState nor MediaDetailState carries an image field, URL
  // or blob, which is precisely why the official app renders a per-source glyph
  // instead. So this is always sourced outside the car, and `null` (no artwork
  // yet, or none found) must stay a first-class state rather than an error: it
  // falls back to the source glyph in the same slot.
  artworkUri?: string | null;
  onAction: (action: 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown') => void;
}

// CarServer.MediaSourceType -> Tesla's OWN source icon.
//
// Both halves are recovered, not guessed: the enum is from vehicle.proto, and
// the artwork is extracted from their icon registry (see mediaSourceIcons.ts).
// Their own mapper switches on the same MediaSourceType enum, so this is the
// same key they use.
//
// `null` for sources we have no icon for — the caller falls back rather than
// showing a wrong brand, which on a card whose whole job is "what is playing"
// would be worse than showing nothing.
function sourceIconUri(sourceType: number | undefined): string | null {
  switch (sourceType) {
    case 12: // Spotify
      return MEDIA_SPOTIFY_URI;
    case 8: // Bluetooth
      return MEDIA_BLUETOOTH_URI;
    case 1: // AM
    case 2: // FM
    case 10: // DAB
    case 13: // USRadio
    case 14: // EURadio
    case 24: // OnlineRadio
    case 25: // OnlineRadio2
      return MEDIA_RADIO_URI;
    case 3: // XM
    case 19: // SiriusXM
      return MEDIA_SIRIUSXM_URI;
    case 17: // TuneIn
      return MEDIA_TUNEIN_URI;
    case 20: // Tidal
      return MEDIA_TIDAL_URI;
    case 7: // iPod
      return MEDIA_APPLE_MUSIC_URI;
    default:
      return null;
  }
}

export function MediaCard({ media, artworkUri = null, onAction }: MediaCardProps) {
  // Title falls back to station, then source label: a radio stream has no
  // `title` but has a `station`, and a Bluetooth phone has neither but names
  // itself. A card with no text at all is the one outcome worth avoiding.
  const title = media.title ?? media.station ?? media.sourceName ?? null;
  // Never print the title twice — a station whose title fell back to `station`
  // must not repeat it underneath.
  const artist = media.artist && media.artist !== title ? media.artist : null;
  const playing = media.playbackStatus === 1;
  const sourceUri = sourceIconUri(media.sourceType);

  return (
    <View style={styles.card}>
      <View style={styles.topPanel}>
        {/* Artwork on the LEFT, in place of the official app's right-hand source
            icon. A square the full height of the panel, so it reads as the
            record rather than as another button. When there is no artwork the
            same slot holds the source glyph — the tile never collapses, or the
            title would shift sideways every time a track changed. */}
        <View style={styles.artwork}>
          {artworkUri ? (
            <Image source={{ uri: artworkUri }} style={styles.artworkImage} contentFit="cover" transition={180} />
          ) : sourceUri ? (
            // Tinted, not rendered in brand colour — their NamedIcon takes a
            // `color` and the artwork carries none, so monochrome IS the design.
            <Image source={{ uri: sourceUri }} style={styles.sourceGlyph} tintColor={ARTIST_COLOR} />
          ) : (
            <SymbolView name="music.note" tintColor={ARTIST_COLOR} size={24} />
          )}
        </View>
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
    // 14 rather than their 18: the artwork tile already supplies the optical
    // left margin, so 18 on top of it reads as a gap.
    paddingLeft: 14,
    paddingRight: 18,
  },
  // Square, panel-height, flush with the panel's leading edge — its outer corner
  // inherits the panel's radius so the art doesn't overhang it.
  artwork: {
    width: PANEL_H,
    height: PANEL_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: PANEL_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#2A2B2C',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  sourceGlyph: {
    width: 26,
    height: 26,
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
