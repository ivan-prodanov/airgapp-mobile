require 'xcodeproj'

# Registers the extension's Swift files into the ShareExtension target's compile sources.
# One lives in the gitignored ios/ tree; the other is the tracked pure parser core, added BY REFERENCE
# (compiled into the extension while its canonical home stays in modules/). Idempotent.
project = Xcodeproj::Project.open(File.expand_path('../airgapp.xcodeproj', __dir__))
target = project.targets.find { |t| t.name == 'ShareExtension' } or abort 'ShareExtension target not found'

files = {
  'SharedLocationResolver.swift' => File.expand_path('../ShareExtension/SharedLocationResolver.swift', __dir__),
  # The pure core is tracked under modules/ and compiled into the extension by reference.
  'SharedLocationExtract.swift'  => File.expand_path('../../modules/shared-location-resolver/Sources/SharedLocationParsing/SharedLocationExtract.swift', __dir__),
}

existing = target.source_build_phase.files.map { |bf| bf.file_ref&.real_path&.to_s }.compact
group = project.main_group.find_subpath('ShareExtension', true)

files.each do |name, path|
  if existing.include?(path)
    next
  end
  ref = group.new_reference(path)
  target.add_file_references([ref])
  puts "added #{name}"
end

project.save
puts 'done'
