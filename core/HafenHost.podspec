Pod::Spec.new do |s|
  s.name = 'HafenHost'
  s.version = '0.1.0'
  s.summary = 'Hafen iOS host services without the packet engine'
  s.homepage = 'https://github.com/SagerNet/sing-box'
  s.license = { :type => 'GPL-3.0-only', :file => '../LICENSE' }
  s.author = 'Hafen contributors'
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.vendored_frameworks = 'artifacts/ios-host/HafenHost.xcframework'
  s.static_framework = true
  s.frameworks = 'Foundation', 'Security', 'SystemConfiguration', 'CoreFoundation', 'Network', 'UIKit'
  s.libraries = 'resolv'
end
