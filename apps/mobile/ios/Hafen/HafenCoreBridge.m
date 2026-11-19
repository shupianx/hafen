#import "HafenCoreBridge.h"
#import <HafenHost/HafenHost.h>

@implementation HafenCoreBridge
+ (NSString *)info { return HostInfo(); }
+ (BOOL)checkProfile:(NSString *)profile error:(NSError **)error {
  return HostCheckProfile(profile, error);
}
+ (NSString *)selfTest:(NSError **)error { return HostSelfTest(error); }
+ (NSString *)fetchSubscription:(NSString *)url error:(NSError **)error { return HostFetchSubscription(url, error); }
+ (NSString *)parseSubscription:(NSString *)content error:(NSError **)error { return HostParseSubscription(content, error); }
+ (NSString *)subscriptionSummary:(NSString *)bundle error:(NSError **)error { return HostSubscriptionSummary(bundle, error); }
+ (NSString *)subscriptionProfile:(NSString *)bundle revision:(NSString *)revision node:(NSString *)node error:(NSError **)error { return HostSubscriptionProfile(bundle, revision, node, error); }
@end
