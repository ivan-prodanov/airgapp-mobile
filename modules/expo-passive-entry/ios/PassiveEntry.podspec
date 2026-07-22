Pod::Spec.new do |s|
  s.name           = 'PassiveEntry'
  s.version        = '1.0.0'
  s.summary        = 'Native background VCSEC passive-entry responder.'
  s.description    = 'Owns a restorable CoreBluetooth central that answers the car\'s passive-entry challenge (routable authenticationResponse) while the app is suspended, signing with the enrolled key read from the shared Keychain.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['CoreBluetooth', 'CoreLocation', 'Security', 'CryptoKit']

  s.source_files = '*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
