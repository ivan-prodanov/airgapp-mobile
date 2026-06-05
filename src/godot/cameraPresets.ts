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
      keep_aspect: 'WIDTH',
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
      // Controls screen: whole car centred, top-down. Telephoto (far + narrow fov) keeps it nearly
      // orthographic (true proportions, no perspective stretch). offset.y 10 / fov 18 fills ~the
      // reference width with the full car frunk-to-trunk.
      rotation: [0, 0, 0],
      offset: [0, 10, 0],
      cam_fov: 20,
      keep_aspect: 'WIDTH',
    },
    environment: {
      // Matches dev injector _send_top_down_view env.
      rotation: [-10, -10, 0],
      env_energy: 6,
      amb_energy: 2.5,
    },
    fadeRoof: false,
  },
  CLIMATE: {
    mode: 'CLIMATE',
    label: 'Climate',
    animationId: 'shell-camera-climate',
    moveCamera: {
      // Climate is an INTERIOR view: the cabin fills the screen and the hood/frunk is off the top.
      // offset.y 4.5 fills the width; offset.z 1.4 shifts the straight-down view toward the rear so
      // the frunk goes off-screen and the cabin + rear sit above the controls.
      rotation: [0, 0, 0],
      offset: [0, 4.5, 1.4],
      cam_fov: 40,
      keep_aspect: 'WIDTH',
    },
    environment: {
      // Matches dev injector _send_climate_view env.
      rotation: [0, -7, 83],
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
      keep_aspect: 'WIDTH',
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
      keep_aspect: 'WIDTH',
    },
    environment: {
      rotation: [0, 45, 0],
      env_energy: 14,
      amb_energy: 2,
    },
    fadeRoof: false,
  },
};
