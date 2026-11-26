// Run from the repository root: swift scripts/app-icons.swift [square artwork.png]
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let icon = "apps/mobile/ios/Hafen/Images.xcassets/AppIcon.appiconset/AppIcon.png"
let input = CommandLine.arguments.dropFirst().first ?? icon
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: input) as CFURL, nil),
      let artwork = CGImageSourceCreateImageAtIndex(source, 0, nil),
      artwork.width == artwork.height else { fatalError("Expected square artwork") }

func exportIcon(size: Int, radius: CGFloat, to path: String) {
    let bounds = CGRect(x: 0, y: 0, width: size, height: size)
    let alpha: CGImageAlphaInfo = radius == 0 ? .noneSkipLast : .premultipliedLast
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: alpha.rawValue)!
    if radius > 0 {
        context.addPath(CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil))
        context.clip()
    }
    context.interpolationQuality = .high
    context.draw(artwork, in: bounds)
    let file = URL(fileURLWithPath: path) as CFURL
    let destination = CGImageDestinationCreateWithURL(file, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot write \(path)") }
}

if input != icon { exportIcon(size: 1024, radius: 0, to: icon) }
for (density, size) in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)] {
    let dir = "apps/mobile/android/app/src/main/res/mipmap-\(density)"
    exportIcon(size: size, radius: CGFloat(size) * 0.22, to: "\(dir)/ic_launcher.png")
    exportIcon(size: size, radius: CGFloat(size) / 2, to: "\(dir)/ic_launcher_round.png")
}
