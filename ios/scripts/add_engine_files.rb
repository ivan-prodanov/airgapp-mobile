require 'xcodeproj'

# Registers the JavaScriptCore engine host into the ShareExtension target.
#
# Two different kinds of thing, which is why this is separate from
# add_share_resolver_files.rb:
#   - AirgappEngine.swift  -> COMPILE SOURCES. Lives under modules/ (tracked) and
#     is compiled into the extension by reference, like SharedLocationExtract.swift.
#   - AirgappEngine.js     -> COPY BUNDLE RESOURCES. A build artifact (gitignored,
#     ~2.4 MB) produced by scripts/build-extension-bundle.mjs. Without this the
#     host loads, finds no engine, and every share fails with bundleMissing.
#
# Idempotent: safe to re-run after a pod install or a project regeneration.
project = Xcodeproj::Project.open(File.expand_path('../airgapp.xcodeproj', __dir__))
target = project.targets.find { |t| t.name == 'ShareExtension' } or abort 'ShareExtension target not found'
group = project.main_group.find_subpath('ShareExtension', true)

swift_files = %w[AirgappEngine.swift SharedSecrets.swift PiTransport.swift CarPresence.swift TransportArbiter.swift BleBytePipe.swift].map do |name|
  File.expand_path("../../modules/shared-intake/ios/#{name}", __dir__)
end
js = File.expand_path('../../modules/shared-intake/ios/AirgappEngine.js', __dir__)

swift_files.each { |f| abort "missing #{f}" unless File.exist?(f) }
unless File.exist?(js)
  abort "missing #{js} — run `node scripts/build-extension-bundle.mjs` first"
end

sources = target.source_build_phase.files.map { |bf| bf.file_ref&.real_path&.to_s }.compact
swift_files.each do |path|
  if sources.include?(path)
    puts "#{File.basename(path)} already in compile sources"
  else
    target.add_file_references([group.new_reference(path)])
    puts "added #{File.basename(path)} to compile sources"
  end
end

resources = target.resources_build_phase.files.map { |bf| bf.file_ref&.real_path&.to_s }.compact
if resources.include?(js)
  puts 'AirgappEngine.js already in bundle resources'
else
  ref = group.new_reference(js)
  target.resources_build_phase.add_file_reference(ref)
  puts 'added AirgappEngine.js to bundle resources'
end

# JavaScriptCore must be linked or the host will not compile.
frameworks = target.frameworks_build_phase.files.map { |bf| bf.display_name }.compact
if frameworks.any? { |n| n.include?('JavaScriptCore') }
  puts 'JavaScriptCore already linked'
else
  fw = project.frameworks_group.new_reference('System/Library/Frameworks/JavaScriptCore.framework')
  fw.source_tree = 'SDKROOT'
  target.frameworks_build_phase.add_file_reference(fw)
  puts 'linked JavaScriptCore'
end

project.save
puts 'done'
