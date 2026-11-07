// MapLibre draws the map on Android only (src/components/MapSurface.android.tsx); iOS uses
// Apple Maps. Without this, iOS autolinking compiles MapLibre into the iOS app as dead weight.
module.exports = {
  dependencies: {
    '@maplibre/maplibre-react-native': {
      platforms: { ios: null },
    },
  },
};
