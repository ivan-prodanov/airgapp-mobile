Pod::Spec.new do |s|
  s.name           = 'BgTask'
  s.version        = '1.0.0'
  s.summary        = 'UIApplication background-task assertion bridge.'
  s.description    = 'Lets JS hold a ~30s "finish what you started" background assertion so a command dispatched just before the app is backgrounded still completes (and can notify) instead of being suspended mid-flight.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['UIKit']

  s.source_files = 'BgTaskModule.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
