Pod::Spec.new do |s|
  s.name           = 'AppleSearch'
  s.version        = '1.0.0'
  s.summary        = 'MKLocalSearch / MKLocalSearchCompleter bridge for Navigate search.'
  s.description    = 'Wraps Apple MapKit search (POI/business + typeahead) via the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['MapKit', 'CoreLocation']

  s.source_files = 'AppleSearchModule.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
