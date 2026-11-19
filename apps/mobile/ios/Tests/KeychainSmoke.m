#import <UIKit/UIKit.h>
#import "../Shared/HafenTunnelStore.h"

@interface SmokeScene : UIResponder <UIWindowSceneDelegate>
@property(nonatomic,strong) UIWindow *window;
@end
@implementation SmokeScene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
  self.window=[[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  self.window.rootViewController=[UIViewController new];
  [self.window makeKeyAndVisible];
}
@end
@interface SmokeDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation SmokeDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    @try {
    NSString *mode=NSProcessInfo.processInfo.arguments.lastObject;
    OSStatus status;
    if([mode isEqualToString:@"write"]) {
      status=HafenSaveTunnelProfile(@"fixture-a",@"subscription-a"); NSCAssert(status==errSecSuccess,@"save failed %d",status);
      NSDictionary *selection=@{@"subscriptionId":@"subscription-a",@"revision":@"revision-b",@"nodeId":@"node-b",@"name":@"Saved B"};
      NSCAssert(HafenSaveTunnelSelection(@"fixture-updated",@"subscription-a",selection)==errSecSuccess,@"update failed");
      NSCAssert([HafenReadTunnelRecord(&status)[@"selection"] isEqual:selection],@"selection/profile did not commit together");
      NSCAssert(HafenDeleteTunnelProfileForSubscription(@"subscription-b")==errSecSuccess,@"delete other failed");
      NSCAssert([HafenReadTunnelRecord(&status)[@"profile"] isEqualToString:@"fixture-updated"],@"wrong owner deleted record");
    } else if([mode isEqualToString:@"read-delete"]) {
      NSCAssert([HafenReadTunnelRecord(&status)[@"profile"] isEqualToString:@"fixture-updated"],@"cross-process read failed");
      NSCAssert([HafenReadTunnelRecord(&status)[@"selection"][@"nodeId"] isEqualToString:@"node-b"],@"cross-process selection missing");
      NSCAssert(HafenDeleteTunnelProfileForSubscription(@"subscription-a")==errSecSuccess,@"delete failed");
    } else {
      NSCAssert(HafenReadTunnelRecord(&status)==nil && status==errSecItemNotFound,@"record survived deletion");
    }
    NSString *result=[NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject stringByAppendingPathComponent:@"result.txt"];
    [@"KEYCHAIN_SMOKE_PASSED" writeToFile:result atomically:YES encoding:NSUTF8StringEncoding error:nil];
    puts("KEYCHAIN_SMOKE_PASSED");fflush(stdout);exit(0);
    } @catch(NSException *error) {
      NSString *directory=NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject;
      [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
      [error.reason writeToFile:[directory stringByAppendingPathComponent:@"result.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
      exit(1);
    }
  });
  return YES;
}
@end
int main(int argc,char **argv) { @autoreleasepool { return UIApplicationMain(argc,argv,nil,NSStringFromClass(SmokeDelegate.class)); } }
