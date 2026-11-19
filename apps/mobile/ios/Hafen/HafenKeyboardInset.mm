#import <React/RCTViewComponentView.h>
#import <QuartzCore/QuartzCore.h>
#import <react/renderer/components/HafenPlatformSpec/ShadowNodes.h>
#import <react/renderer/core/ConcreteComponentDescriptor.h>

using namespace facebook::react;

namespace {
struct KeyboardInsetState {
  Float height = 0;
};
using KeyboardInsetNode = ConcreteViewShadowNode<HafenKeyboardInsetComponentName,
    HafenKeyboardInsetProps, HafenKeyboardInsetEventEmitter, KeyboardInsetState>;

class KeyboardInsetDescriptor final : public ConcreteComponentDescriptor<KeyboardInsetNode> {
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

  void adopt(ShadowNode &node) const override {
    ConcreteComponentDescriptor::adopt(node);
    auto &inset = static_cast<KeyboardInsetNode &>(node);
    double height = inset.getStateData().height - inset.getConcreteProps().bottomAdjustment;
    inset.setSize({0, static_cast<Float>(std::max(0.0, height))});
  }
};
}

// Auto Layout resizes this view in the keyboard layout guide's own UIKit transaction.
@interface HafenKeyboardProbe : UIView
@property (nonatomic, copy) void (^geometryChanged)(void);
@end

@implementation HafenKeyboardProbe
- (void)layoutSubviews {
  [super layoutSubviews];
  if (_geometryChanged) _geometryChanged();
}
@end

@interface HafenKeyboardInset : RCTViewComponentView
@end

@implementation HafenKeyboardInset {
  KeyboardInsetNode::ConcreteState::Shared _state;
  UIView *_guideHost;
  HafenKeyboardProbe *_probe;
  dispatch_block_t _pendingResize;
  CGFloat _pendingHeight;
  CGFloat _published;
  CFTimeInterval _animationEnd;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<KeyboardInsetDescriptor>();
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  [self stopTracking];
  UIWindow *window = self.window;
  if (!window) return;

  _guideHost = [[UIView alloc] initWithFrame:window.bounds];
  _guideHost.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  _guideHost.userInteractionEnabled = NO;
  _guideHost.accessibilityElementsHidden = YES;
  [window addSubview:_guideHost];
  UIKeyboardLayoutGuide *guide = _guideHost.keyboardLayoutGuide;
  if (@available(iOS 17.0, *)) guide.usesBottomSafeArea = NO;

  _probe = [HafenKeyboardProbe new];
  _probe.translatesAutoresizingMaskIntoConstraints = NO;
  [_guideHost addSubview:_probe];
  [NSLayoutConstraint activateConstraints:@[
    [_probe.topAnchor constraintEqualToAnchor:guide.topAnchor],
    [_probe.bottomAnchor constraintEqualToAnchor:_guideHost.bottomAnchor],
    [_probe.leadingAnchor constraintEqualToAnchor:_guideHost.leadingAnchor],
    [_probe.widthAnchor constraintEqualToConstant:1],
  ]];
  __weak HafenKeyboardInset *weakSelf = self;
  _probe.geometryChanged = ^{ [weakSelf updateFromKeyboardGuide]; };
}

- (void)publishHeight:(CGFloat)height {
  _published = height;
  _state->updateState(KeyboardInsetState{static_cast<Float>(height)}, EventQueue::UpdateMode::unstable_Immediate);
}

- (CGFloat)dockedHeight {
  CGFloat height = CGRectGetHeight(_probe.bounds);
  if (@available(iOS 17.0, *)) return height;
  // Earlier guides rest at the bottom safe area even with no software keyboard.
  return height <= _guideHost.safeAreaInsets.bottom ? 0 : height;
}

- (void)updateFromKeyboardGuide {
  if (!_state || !_probe.window) return;
  CGFloat height = [self dockedHeight];
  // A taller replacement for a pending shrink is the newly installed accessory.
  BOOL replacedAccessory = _pendingResize && height > _pendingHeight;
  if (_pendingResize) dispatch_block_cancel(_pendingResize);
  _pendingResize = nil;
  if (height == _published) return;
  CFTimeInterval now = CACurrentMediaTime();
  if (UIView.inheritedAnimationDuration > 0) {
    _animationEnd = now + UIView.inheritedAnimationDuration;
    [self publishHeight:height];
    return;
  }
  // A frame without an animation may refine the destination of an in-flight
  // keyboard animation, or replace a candidate bar while the keyboard is open.
  CFTimeInterval remaining = _animationEnd - now;
  __weak HafenKeyboardInset *weakSelf = self;
  void (^resize)(void) = ^{
    HafenKeyboardInset *view = weakSelf;
    if (!view || !view->_state || !view.window) return;
    view->_pendingResize = nil;
    if (UIAccessibilityIsReduceMotionEnabled()) {
      [view publishHeight:height];
      return;
    }
    [UIView animateWithDuration:(remaining > 0 ? remaining : 0.18) delay:0
                        options:UIViewAnimationOptionBeginFromCurrentState | UIViewAnimationOptionCurveEaseOut |
                                UIViewAnimationOptionAllowUserInteraction
                     animations:^{ [view publishHeight:height]; } completion:nil];
  };
  if (remaining <= 0 && height > 0 && height < _published && !replacedAccessory) {
    // UIKit can withdraw the old accessory row before installing the new one.
    _pendingHeight = height;
    _pendingResize = dispatch_block_create(static_cast<dispatch_block_flags_t>(0), resize);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), dispatch_get_main_queue(), _pendingResize);
  } else {
    resize();
  }
}

- (void)updateState:(State::Shared const &)state oldState:(State::Shared const &)oldState {
  _state = std::static_pointer_cast<KeyboardInsetNode::ConcreteState const>(state);
}

- (void)stopTracking {
  if (_pendingResize) dispatch_block_cancel(_pendingResize);
  _pendingResize = nil;
  _probe.geometryChanged = nil;
  [_guideHost removeFromSuperview];
  _guideHost = nil;
  _probe = nil;
  _animationEnd = 0;
}

- (void)prepareForRecycle {
  [self stopTracking];
  _state.reset();
  _published = 0;
  [super prepareForRecycle];
}
@end
