import { useEffect, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { recommendedColdPressure } from '@/ble/tirePressureText';
import { TeslaFonts } from '@/constants/fonts';
import { TIRE_PRESSURE_BAR_URI } from '@/constants/tirePressureIcon';

import { CARD_FADE_MS, cardFadeEasing } from '@/godot/cardTransition';
import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { SnapshotDriver } from '@/godot/SnapshotDriver';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { ControlsScreen } from '@/screens/ControlsScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useActiveVehicleId, useFleet, useVehicle } from '@/state/VehicleProvider';
import { AppIcon } from '../icons/AppIcon';

// Tesla home + sub-screens (climate / controls) over the embedded Godot car. Each view swaps the
// bottom panel and camera; the back chevron returns to Home (parked).
export default function Index() {
  const [state, actions] = useVehicle();
  const vehicleId = useActiveVehicleId();
  const fleet = useFleet();
  const { width } = useWindowDimensions();
  const carTranslateX = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);

  // Commit a switch: slide the live car fully off-screen in `direction` (-1 left / +1 right), swap
  // the active vehicle WHILE off-screen (the engine re-renders the incoming car in its real state),
  // jump the surface to the opposite edge, then slide it back to centre.
  const commitSwitch = (direction: -1 | 1) => {
    animating.current = true;
    Animated.timing(carTranslateX, {
      toValue: direction * width,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      if (direction < 0) {
        fleet.nextVehicle();
      } else {
        fleet.prevVehicle();
      }
      carTranslateX.setValue(-direction * width);
      Animated.timing(carTranslateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        animating.current = false;
      });
    });
  };

  const springBack = () => {
    Animated.spring(carTranslateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  // Horizontal car-switch swipe via PanResponder (RN's core responder system). RNGH's GestureDetector
  // never received touches inside the native-tab Home screen; PanResponder (same system as the proven
  // edge-back swipe) does. The handlers are spread onto the car-band view in HomeScreen. A horizontal
  // drag switches cars; a vertical drag returns false from onMoveShouldSet so the menu ScrollView
  // scrolls. The long-lived responder reads fleet/width from a ref refreshed every render (no stale
  // closures).
  const swipeLogic = useRef({ fleet, width });
  swipeLogic.current = { fleet, width };
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => {
        const { fleet: f } = swipeLogic.current;
        return (
          !animating.current &&
          f.vehicles.length >= 2 &&
          Math.abs(g.dx) > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.4
        );
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        if (animating.current) {
          return;
        }
        const { fleet: f } = swipeLogic.current;
        const atStart = f.activeIndex === 0;
        const atEnd = f.activeIndex === f.vehicles.length - 1;
        const damped = (g.dx > 0 && atStart) || (g.dx < 0 && atEnd);
        carTranslateX.setValue(damped ? g.dx * 0.25 : g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        const { fleet: f, width: w } = swipeLogic.current;
        if (animating.current) {
          return;
        }
        // Commit on EITHER a moderate drag distance OR a flick — so a quick swipe switches even when
        // it doesn't physically travel far (matches the edge-back gesture's dx-or-vx feel). Without
        // the velocity term a fast flick under `distThreshold` used to snap back, which felt sticky.
        const distThreshold = w * 0.18;
        const flickVelocity = 0.3;
        const atStart = f.activeIndex === 0;
        const atEnd = f.activeIndex === f.vehicles.length - 1;
        const goLeft = g.dx <= -distThreshold || (g.vx <= -flickVelocity && g.dx < 0);
        const goRight = g.dx >= distThreshold || (g.vx >= flickVelocity && g.dx > 0);
        if (goLeft && !atEnd) {
          commitSwitch(-1);
        } else if (goRight && !atStart) {
          commitSwitch(1);
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => springBack(),
    }),
  ).current;

  const mode =
    state.cameraMode === 'CLIMATE' ? 'climate' : state.cameraMode === 'TOP_DOWN' ? 'controls' : 'home';

  // iOS-style left-edge swipe-back: a rightward swipe from the left edge returns to Home (parked),
  // available on climate & controls (like the system back gesture). A narrow strip catches the start.
  const insets = useSafeAreaInsets();
  const goBack = useRef(() => actions.setCameraMode('PARKED'));
  goBack.current = () => actions.setCameraMode('PARKED');
  const edgeBack = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && g.dx > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 70 || g.vx > 0.4) {
          // Defer one frame: navigating flips `mode` to 'home', which unmounts THIS strip — doing it
          // synchronously during its own release crashes RN's touch handler (active responder freed).
          requestAnimationFrame(() => goBack.current());
        }
      },
    }),
  ).current;

  // ── The CARD layer (findings §1c) ────────────────────────────────────────
  // We used to swap `panel` outright, which is why leaving Controls/Climate had
  // no fade at all: the screen simply vanished. Their model is a stack —
  //   Home = the ROOT card, always mounted, static at opacity 1;
  //   Controls/Climate = a PUSHED card composited over it, opacity =
  //     current.progress, on the TransitionIOSSpec spring (~479ms).
  // Pushing runs that 0 -> 1; popping runs the SAME interpolator backwards, so
  // the pushed card fades OUT and reveals Home beneath. `detachPreviousScreen:
  // false` is what keeps Home mounted to composite against — so we keep it
  // mounted too, and let it keep its scroll position while covered.
  const pushed = mode === 'climate' ? 'climate' : mode === 'controls' ? 'controls' : null;
  const cardProgress = useRef(new Animated.Value(0)).current;
  // The pushed screen stays rendered until its fade-OUT finishes.
  const [renderedPush, setRenderedPush] = useState<'climate' | 'controls' | null>(null);

  useEffect(() => {
    if (pushed) setRenderedPush(pushed);
    Animated.timing(cardProgress, {
      toValue: pushed ? 1 : 0,
      duration: CARD_FADE_MS,
      easing: cardFadeEasing,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Unmount only after the pop has actually finished, or we'd cut the fade.
      if (finished && !pushed) setRenderedPush(null);
    });
  }, [pushed, cardProgress]);

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId} carTranslateX={carTranslateX}>
        {/* Drives per-car snapshot rendering into vehicleSnapshotStore (needs the
            Godot bridge, so it lives inside VehicleCanvas). Renders nothing. */}
        <SnapshotDriver />
        {/* Root card: always mounted, never fades (its CONTENT does — HomeScreen
            owns that clock). Untouchable while a card covers it. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={pushed ? 'none' : 'box-none'}>
          <HomeScreen
            state={state}
            actions={actions}
            swipeHandlers={swipe.panHandlers}
            covered={pushed !== null}
          />
        </View>

        {/* Pushed card. */}
        {renderedPush ? (
          <Animated.View
            // justifyContent MUST match VehicleCanvas's overlay: ControlsScreen
            // is a fragment whose bottom bar isn't positioned — it relies on the
            // parent's flex-end. Wrapping it in a bare absoluteFill sent the bar
            // to the top.
            style={[StyleSheet.absoluteFill, styles.card, { opacity: cardProgress }]}
            pointerEvents={pushed ? 'box-none' : 'none'}>
            {renderedPush === 'climate' ? (
              <ClimateScreen state={state} actions={actions} />
            ) : (
              <ControlsScreen state={state} actions={actions} />
            )}

            {/* The back chevron + "Controls" title are part of the pushed CARD,
                so they fade with it. They used to live outside the canvas and
                appeared/vanished instantly while everything else faded. */}
            {/* Their `HeaderButton` (@1871461), which the climate screen mounts
                as <HeaderButton name="back" iconSize={LARGE} hideBackgroundView=
                {isCybertruck} /> (@5222652). Its box comes from `headerView`
                (@1871606):

                  { minWidth: 36, minHeight: 36, alignItems: 'center',
                    justifyContent: 'center', zIndex: 100,
                    borderRadius: Specifications.borderRadius = 5,
                    backgroundColor: hideBackgroundView ? transparent
                                                        : theme.secondaryBackgroundColor }

                so on a non-Cybertruck the background IS drawn, opaque #222324 —
                not the translucent grey we had. onPress fires lightHaptic()
                before navigating; ours had none.

                POSITION is per-screen, not shared: climate declares its own
                `backButtonContainer` { top: 6*Gutter = 60 } — measured from the
                SCREEN, which is why this now sits OUTSIDE the SafeAreaView — and
                `backButton` { marginLeft: 2*Gutter = 20 }. Six other screens
                declare their own offsets, so Controls keeps the safe-area
                placement it already had, where it lines up with its title. Only
                climate's is recovered; I have not read Controls'. */}
            <Pressable
              style={[
                styles.backButton,
                renderedPush === 'climate'
                  ? styles.backButtonClimate
                  : [styles.backButtonControls, { top: insets.top + 4, left: 12 }],
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                actions.setCameraMode('PARKED');
              }}
            >
              <AppIcon icon="chevron-270" color="#FFFFFF" size={22} />
            </Pressable>

            <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
              <View style={styles.topBarRow}>
                {renderedPush === 'controls' ? (
                  <View style={styles.titleStack}>
                    <Text style={styles.title}>Controls</Text>
                    {/* The car supplies its own placard value (TirePressureState
                        fields 18/19) — never hardcoded per model. Shown only
                        while the overlay is open, and only once we actually have
                        it, so the header never claims a recommendation we have
                        not read. Front and rear are usually equal; when they
                        differ, say both rather than picking one. */}
                    {state.tirePressureVisible && state.tirePressures
                      ? (() => {
                          const rcp = recommendedColdPressure(state.tirePressures);
                          return rcp ? <Text style={styles.subtitle}>{rcp}</Text> : null;
                        })()
                      : null}
                  </View>
                ) : null}
                {renderedPush === 'controls' ? (
                  <Pressable
                    style={styles.tireButton}
                    hitSlop={8}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      actions.setTirePressureVisible(!state.tirePressureVisible);
                    }}
                  >
                    {/* Tesla's own glyph, not the nearest SF Symbol. Theirs is a
                        treaded wheel over a "bar" badge — the badge is the UNIT,
                        which is why `tirepressure` alone never looked right. Size
                        30 and the two tint colours are theirs verbatim
                        (theme.buttonActivePrimaryText / buttonInactivePrimaryText). */}
                    <Image
                      source={{ uri: TIRE_PRESSURE_BAR_URI }}
                      style={[
                        styles.tireIcon,
                        { tintColor: state.tirePressureVisible ? '#F1F1F1' : '#969696' },
                      ]}
                      resizeMode="contain"
                    />
                  </Pressable>
                ) : null}
              </View>
            </SafeAreaView>
          </Animated.View>
        ) : null}
      </VehicleCanvas>

      {mode !== 'home' ? (
        <View style={styles.edgeBack} {...edgeBack.panHandlers} />
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'black',
  },
  card: {
    justifyContent: 'flex-end',
  },
  homePanel: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  edgeBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 26,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  topBarRow: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The title and its subtitle stack, so adding the recommendation does not
  // shift the title off the row's centre.
  titleStack: {
    alignItems: 'center',
  },
  // The "Recommended Cold Pressure" line. Official app renders it
  // `<Text category={TextCategory.CaptionLabel} style={[tpmsRcpText, {color:
  // theme.textColorLight}]}>` — so Typography.CaptionLabel verbatim
  // ({type:'Medium', fontSize:12, lineHeight:16, letterSpacing:0.1}) in
  // #8A8B8B, centred. We had 13pt in whatever the system font is, at a
  // brighter grey; both read a size too large next to the reference.
  subtitle: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: '#8A8B8B',
    textAlign: 'center',
    marginTop: 1,
  },
  tireButton: {
    position: 'absolute',
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 30, from `NamedIcon width/height` at the official app's own call site. The
  // 44x44 box around it is ours — their header lays the button out through a
  // `rightControls` slot we don't have, so only the glyph size transfers.
  tireIcon: {
    width: 30,
    height: 30,
  },
  // `headerView` verbatim. 44/14/translucent were all ours: theirs is a 36pt
  // square at the same radius 5 every other control on this screen uses, filled
  // with the opaque theme surface. The SF chevron stays 22 — their icon is
  // IconSize.LARGE (36) but their glyph carries its own padding inside that box
  // while SF Symbols draw to the edge, so copying the number would produce a
  // chevron the full width of the button. Same call as the setpoint arrows:
  // match the box, leave the glyph to the deferred icon job.
  backButton: {
    position: 'absolute',
    minWidth: 36,
    minHeight: 36,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222324',
    zIndex: 100,
  },
  backButtonClimate: {
    top: 60,
    left: 20,
  },
  // CONTROLS passes `hideBackgroundView: TRUE` — a literal, where climate passes
  // isCybertruck (@4039963 vs @5222659). Through `headerView` (@1871606) that
  // resolves the fill to Colors.transparent instead of
  // theme.secondaryBackgroundColor, so their Controls back button is a BARE
  // chevron with no plate behind it. Same component, same 36x36 box, same white
  // icon, same light haptic — only the background differs, and it is the one
  // thing that made ours look wrong here after the climate copy.
  //
  // Its placement is a `TopNavigation` bar rather than an absolute offset, which
  // is why this keeps the safe-area position it already had: that is what a nav
  // bar does, and it stays aligned with the centred "Controls" title exactly as
  // theirs is (TopNavigationAlignment.CENTER).
  backButtonControls: {
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
});
