// Reproducible, opaque iOS test-build icon. Run from the repository root.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                        bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 11/255, green: 20/255, blue: 32/255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.setStrokeColor(CGColor(red: 124/255, green: 227/255, blue: 194/255, alpha: 1))
context.setLineWidth(92)
context.setLineCap(.round)
// H monogram, matching the application's navy and mint palette.
for (start, end) in [(CGPoint(x: 300, y: 282), CGPoint(x: 300, y: 742)),
                     (CGPoint(x: 724, y: 282), CGPoint(x: 724, y: 742)),
                     (CGPoint(x: 300, y: 512), CGPoint(x: 724, y: 512))] {
    context.move(to: start)
    context.addLine(to: end)
    context.strokePath()
}
let output = URL(fileURLWithPath: "apps/mobile/ios/Hafen/Images.xcassets/AppIcon.appiconset/AppIcon.png")
let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Cannot write icon") }
