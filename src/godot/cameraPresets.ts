import type { CameraMode } from '../types/vehicleTypes';

export interface CameraPreset {
  mode: CameraMode;
  label: string;
  animationId: string;
  moveCamera: {
    rotation: [number, number, number];
    offset: [number, number, number];
    cam_fov: number;
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
      rotation: [68.6, -138, 0],
      offset: [-0.28, 8.65, 0],
      cam_fov: 62,
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
      rotation: [0, 0, 0],
      offset: [0, 10, 0],
      cam_fov: 40,
    },
    environment: {
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
      rotation: [0, 0, 0],
      offset: [0, 6, 0.6],
      cam_fov: 40,
    },
    environment: {
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
    },
    environment: {
      rotation: [0, 45, 0],
      env_energy: 14,
      amb_energy: 2,
    },
    fadeRoof: false,
  },
};
