// Standalone simulator app: link the production HafenCoreBridge.m + HafenHost.
// Writes fixed booleans only; no subscription or endpoint credentials are logged.
#import <UIKit/UIKit.h>
#import "../Hafen/HafenCoreBridge.h"

static NSDictionary *Decode(NSString *json) {
  return json ? [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
}

@interface SmokeScene : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end
@implementation SmokeScene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  self.window.rootViewController = [UIViewController new];
  [self.window makeKeyAndVisible];
}
@end

@interface HostSmokeDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation HostSmokeDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    NSDictionary *info = Decode([HafenCoreBridge info]);
    NSString *uri = @"vless://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@proxy.example:443?security=tls&flow=xtls-rprx-vision&fp=chrome#Fixture";
    NSString *bundle = [HafenCoreBridge parseSubscription:uri error:&error];
    NSString *summary = bundle ? [HafenCoreBridge subscriptionSummary:bundle error:&error] : nil;
    NSDictionary *nodes = Decode(summary);
    NSDictionary *node = [nodes[@"nodes"] firstObject];
    NSString *profile = node ? [HafenCoreBridge subscriptionProfile:bundle revision:nodes[@"revision"] node:node[@"id"] error:&error] : nil;
    BOOL valid = profile && [HafenCoreBridge checkProfile:profile error:&error];
    BOOL invalidRejected = ![HafenCoreBridge checkProfile:@"{}" error:&error];
    error = nil;
    NSDictionary *relay = Decode([HafenCoreBridge selfTest:&error]);
    NSDictionary *result = @{
      @"coreReady": @([info[@"ready"] boolValue]),
      @"subscriptionRoundTrip": @(valid),
      @"summaryRedacted": @(summary && ![summary containsString:@"aaaaaaaa-aaaa"]),
      @"invalidRejected": @(invalidRejected),
      @"encryptedLoopback": @([relay[@"ok"] boolValue])
    };
    NSString *dir = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil] writeToFile:[dir stringByAppendingPathComponent:@"result.json"] atomically:YES];
  });
  return YES;
}
@end

int main(int argc, char *argv[]) {
  @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(HostSmokeDelegate.class)); }
}
