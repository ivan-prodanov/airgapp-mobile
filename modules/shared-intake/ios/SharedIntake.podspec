Pod::Spec.new do |s|
  s.name           = 'SharedIntake'
  s.version        = '1.0.0'
  s.summary        = 'Reads the shared-location payload from the App Group.'
  s.description    = 'Bridges the Share Extension App Group hand-off to JS via the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
