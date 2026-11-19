#import <React/RCTViewComponentView.h>
#import <react/renderer/components/HafenPlatformSpec/ComponentDescriptors.h>

using namespace facebook::react;

// Mounted inside the home scroll content. UIKit draws the default top edge.
@interface HafenHomeScrollEdges : RCTViewComponentView
@end

@implementation HafenHomeScrollEdges {
  __weak UIScrollView *_scrollView;
  BOOL _previousBottomHidden;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<HafenHomeScrollEdgesComponentDescriptor>();
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (@available(iOS 26.0, *)) {
    UIView *ancestor = self.window ? self.superview : nil;
    while (ancestor && ![ancestor isKindOfClass:UIScrollView.class]) {
      ancestor = ancestor.superview;
    }
    UIScrollView *scroll = (UIScrollView *)ancestor;
    if (scroll == _scrollView) return;
    _scrollView.bottomEdgeEffect.hidden = _previousBottomHidden;
    _scrollView = scroll;
    _previousBottomHidden = scroll.bottomEdgeEffect.hidden;
    scroll.bottomEdgeEffect.hidden = YES;
  }
}
@end
