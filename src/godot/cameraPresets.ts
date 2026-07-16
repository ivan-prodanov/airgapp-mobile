import type { CameraMode } from '../types/vehicleTypes';

export interface CameraPreset {
  mode: CameraMode;
  label: string;
  animationId: string;
  moveCamera: {
    rotation: [number, number, number];
    offset: [number, number, number];
    cam_fov: number;
    // Which axis the camera preserves on the tall phone screen. 'WIDTH' for angled hero/charge views
    // (wide car fits width); 'HEIGHT' for straight-down views (car length fills height, hood cropped).
    keep_aspect: 'WIDTH' | 'HEIGHT';
  };
  environment: {
    rotation: [number, number, number];
    env_energy: number;
    amb_energy: number;
  };
  fadeRoof: boolean;
}

// The official app's camera/frame/env animation, VERBATIM
// (tesla-renderer-and-battery-FINDINGS §3a: defaultCameraAnimationDuration /
// Transition / Ease). Sent on ALL THREE messages — MOVE_CAMERA, SET_ENV_PARAMS
// and UPDATE_MAIN_VIEW_FRAME — so the pose, the lighting and the zoom travel
// together on one curve.
//
// We were sending duration 0.75 and no easing, so our scene fell back to its own
// defaults (0.75s, EASE_IN_OUT) — 50% too slow AND the wrong curve, which is why
// screen transitions felt sluggish next to theirs. Godot 3 enum values:
// Tween.TRANS_QUART = 3, Tween.EASE_OUT = 1.
export const CAMERA_ANIM = {
  duration: 0.5,
  transition_type: 3,
  ease_type: 1,
} as const;

export const cameraPresets: Record<CameraMode, CameraPreset> = {
  PARKED: {
    mode: 'PARKED',
    label: 'Home',
    animationId: 'shell-camera-parked',
    moveCamera: {
      // Matches the dev injector's parked framing (LocalDevMessageInjector._send_parked_view) so the
      // car reads as a hero shot, not a small zoomed-out figure. fov 62 / offset.y 8.65 was too far.
      rotation: [68.6, -138, 0],
      offset: [-0.06, 6.7, 0],
      cam_fov: 40,
      // HEIGHT = Godot's default, which is what the official app relies on:
      // their CameraManager NEVER sets keep_aspect, so cam_fov 40 is a VERTICAL
      // fov (tesla-renderer-frame-FINDINGS §3/§4). Our CameraManager._ready
      // force-sets KEEP_WIDTH on portrait "because the default over-zooms on
      // tall aspects" — but that over-zoom IS the Tesla look. Under KEEP_WIDTH
      // the same fov 40 becomes horizontal and the car renders at only ~0.461x
      // on a 393x852 phone. Sending HEIGHT here overrides that default per
      // message (CameraManager.gd:61), which is why this needs no .pck rebuild.
      keep_aspect: 'HEIGHT',
    },
    environment: {
      rotation: [0, -11, 83],
      env_energy: 6,
      amb_energy: 2.6,
    },
    fadeRoof: false,
  },
  TOP_DOWN: {
    mode: 'TOP_DOWN',
    label: 'Top',
    animationId: 'shell-camera-top-down',
    moveCamera: {
      // EXACT Tesla TOP_DOWN pose (Round 5 §3b: rotation [0,0,0], offset [0,10,0],
      // cam_fov 40). Device evidence overturns Round 5 §3b's OTHER claim that
      // "Controls IS the PARKED view": the official app's Controls screen is
      // plainly top-down in a side-by-side, so this pose is what it uses and our
      // top-down screen was structurally right all along.
      //
      // We ran fov 20 here (telephoto, "nearly orthographic") and compensated
      // with a small frame. With keep_aspect finally on their axis, their fov 40
      // + a full-screen frame (scale 1.0) reproduces the real app: it matches
      // both the measured size ratio and the car's exact mid-screen centre
      // (center_y = 0 + H/2 * 1.0 = H/2).
      rotation: [0, 0, 0],
      offset: [0, 10, 0],
      cam_fov: 40,
      keep_aspect: 'HEIGHT',
    },
    environment: {
      // EXACT Tesla TOP_DOWN env (Round 5 §3b); ours was the dev injector's
      // [-10,-10,0] 6/2.5.
      rotation: [0, -3, 87],
      env_energy: 4.5,
      amb_energy: 4,
    },
    fadeRoof: false,
  },
  CLIMATE: {
    mode: 'CLIMATE',
    label: 'Climate',
    animationId: 'shell-camera-climate',
    moveCamera: {
      // EXACT Tesla climate-view camera, decompiled from the official app's RN bundle
      // (CameraPose CLIMATE = rotation [0,0,0], offset [0,6,0.6], cam_fov 40). The higher y=6 (vs the
      // wrong 4.5 we had) flattens the perspective so the front seats read upright/reclined like the
      // real app, and z=0.6 keeps the frunk off the top with the cabin + rear above the controls.
      rotation: [0, 0, 0],
      offset: [0, 6, 0.6],
      cam_fov: 40,
      // WIDTH keeps the WHOLE car in frame (height-fit cut the frunk off). The Tesla-vs-ours zoom is
      // carried by the render FRAME scale (VIEW_FRAME.CLIMATE.heightFrac), not the camera — see there.
      keep_aspect: 'HEIGHT',
    },
    environment: {
      // EXACT Tesla CLIMATE env (Round 5 §3b). Ours was the dev injector's
      // rotation [0,-7,83] — a completely different sky orientation. The energies
      // happened to match; the rotation did not, and since the mobile ground
      // material is SHADED (§3d) the sky orientation moves the car's shadow and
      // reflections. This is a direct cause of the Climate-vs-Tesla shadow delta.
      rotation: [0, 40, 0],
      env_energy: 4,
      amb_energy: 4,
    },
    fadeRoof: true,
  },
  CHARGING: {
    mode: 'CHARGING',
    label: 'Charge',
    animationId: 'shell-camera-charging',
    moveCamera: {
      rotation: [74, -38, 0],
      offset: [0, 6.55, 0],
      cam_fov: 40,
      keep_aspect: 'HEIGHT',
    },
    environment: {
      rotation: [-20, 53, 30],
      env_energy: 5,
      amb_energy: 4,
    },
    fadeRoof: false,
  },
  CLOSURE_OPEN: {
    mode: 'CLOSURE_OPEN',
    label: 'Open',
    animationId: 'shell-camera-closure-open',
    moveCamera: {
      rotation: [62.654, -139.64, 0],
      offset: [-0.086, 4.7, 0],
      cam_fov: 58,
      keep_aspect: 'HEIGHT',
    },
    environment: {
      rotation: [0, 45, 0],
      env_energy: 14,
      amb_energy: 2,
    },
    fadeRoof: false,
  },
};
