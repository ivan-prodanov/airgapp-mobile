require 'xcodeproj'

proj_path = 'airgapp.xcodeproj'
project = Xcodeproj::Project.open(proj_path)
app = project.targets.find { |t| t.name == 'airgapp' }
raise 'app target not found' unless app

if project.targets.any? { |t| t.name == 'ShareExtension' }
  puts 'ShareExtension target already exists — skipping'
  exit 0
end

ext = project.new_target(:app_extension, 'ShareExtension', :ios, '16.4')

# Source file (Info.plist + entitlements are referenced via build settings, not compiled).
grp = project.main_group.new_group('ShareExtension', 'ShareExtension')
src = grp.new_reference('ShareViewController.swift')
ext.source_build_phase.add_file_reference(src)

ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'local.airgapp.mobile.ShareExtension'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = '859B8N529C'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['CLANG_ENABLE_MODULES'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/../../Frameworks']
end

# App depends on the extension and embeds it in PlugIns (code-signed on copy).
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
appex = embed.add_file_reference(ext.product_reference)
appex.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts 'ShareExtension target added OK'
