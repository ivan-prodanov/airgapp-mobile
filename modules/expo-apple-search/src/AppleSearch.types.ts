export interface AppleRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface AppleCompletion {
  title: string;
  subtitle: string;
}

export interface AppleResult {
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

export interface AppleRouteLeg {
  distanceM: number;
  durationS: number;
}
export interface AppleRoute {
  polyline: { latitude: number; longitude: number }[];
  legs: AppleRouteLeg[];
  totalDistanceM: number;
  totalDurationS: number;
}
