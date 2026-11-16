#import "HafenCoreBridge.h"
#import <HafenCore/HafenCore.h>

@implementation HafenCoreBridge
+ (NSString *)info { return MobileInfo(); }
+ (BOOL)checkProfile:(NSString *)profile error:(NSError **)error {
  return MobileCheckProfile(profile, error);
}
+ (NSString *)selfTest:(NSError **)error { return MobileSelfTest(error); }
+ (NSString *)fetchSubscription:(NSString *)url error:(NSError **)error { return MobileFetchSubscription(url, error); }
+ (NSString *)parseSubscription:(NSString *)content error:(NSError **)error { return MobileParseSubscription(content, error); }
+ (NSString *)subscriptionSummary:(NSString *)bundle error:(NSError **)error { return MobileSubscriptionSummary(bundle, error); }
+ (NSString *)subscriptionProfile:(NSString *)bundle revision:(NSString *)revision node:(NSString *)node error:(NSError **)error { return MobileSubscriptionProfile(bundle, revision, node, error); }
@end
