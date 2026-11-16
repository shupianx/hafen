Pod::Spec.new do |s|
  s.name = 'HafenCore'
  s.version = '0.1.0'
  s.summary = 'Hafen mobile bindings to pinned sing-box 1.14.4'
  s.homepage = 'https://github.com/SagerNet/sing-box'
  s.license = { :type => 'GPL-3.0-only', :file => '../LICENSE' }
  s.author = 'Hafen contributors'
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.vendored_frameworks = 'artifacts/ios/HafenCore.xcframework'
  s.static_framework = true
  s.frameworks = 'Foundation', 'Security', 'SystemConfiguration', 'CoreFoundation', 'Network', 'UIKit'
  s.libraries = 'resolv'
end
