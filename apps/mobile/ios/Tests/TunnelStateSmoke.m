#import "../Hafen/HafenTunnelController.h"
#import <NetworkExtension/NetworkExtension.h>

@interface FakeConnection : NSObject
@property NEVPNStatus status;
@property(nonatomic,strong) NSError *disconnectError;
@end
@implementation FakeConnection
- (void)fetchLastDisconnectErrorWithCompletionHandler:(void (^)(NSError *))handler { handler(self.disconnectError); }
@end
@interface FakeManager : NSObject
@property(nonatomic,strong) FakeConnection *connection;
@end
@implementation FakeManager
@end
@interface TestController : HafenTunnelController
@property(nonatomic,strong) FakeManager *freshManager;
@property NSUInteger loads;
@end
@implementation TestController
- (void)load:(void (^)(NSError *))completion {
  self.loads+=1;
  [self setValue:self.freshManager forKey:@"manager"];
  completion(nil);
}
@end
static void drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }
int main(void) { @autoreleasepool {
  TestController *controller=[TestController new];
  FakeManager *manager=[FakeManager new];manager.connection=[FakeConnection new];manager.connection.status=NEVPNStatusConnected;
  controller.freshManager=manager;
  __block NSString *state;
  void (^receive)(NSString *)=^(NSString *json){state=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil][@"state"];};
  [controller state:receive];drain();NSCAssert([state isEqualToString:@"connected"],@"initial state");
  id observer=[NSNotificationCenter.defaultCenter addObserverForName:HafenTunnelStateDidChange object:controller queue:nil usingBlock:^(NSNotification *notification){receive(notification.userInfo[@"state"]);}];
  manager.connection.status=NEVPNStatusDisconnected;
  [NSNotificationCenter.defaultCenter postNotificationName:NEVPNStatusDidChangeNotification object:manager.connection];drain();
  NSCAssert([state isEqualToString:@"disconnected"],@"Settings stop did not emit state");
  manager.connection.disconnectError=[NSError errorWithDomain:@"HafenTunnel" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ENDPOINT_DNS_FAILED"}];
  [NSNotificationCenter.defaultCenter postNotificationName:NEVPNStatusDidChangeNotification object:manager.connection];drain();
  NSCAssert([[controller valueForKey:@"lastError"] isEqualToString:@"ENDPOINT_DNS_FAILED"],@"lost safe DNS failure");
  manager.connection.disconnectError=[NSError errorWithDomain:@"private" code:1 userInfo:@{NSLocalizedDescriptionKey:@"secret"}];
  [NSNotificationCenter.defaultCenter postNotificationName:NEVPNStatusDidChangeNotification object:manager.connection];drain();
  NSCAssert([[controller valueForKey:@"lastError"] isEqualToString:@"TUNNEL_START_FAILED"],@"raw error escaped");
  manager.connection.status=NEVPNStatusConnected;
  [NSNotificationCenter.defaultCenter postNotificationName:NEVPNStatusDidChangeNotification object:manager.connection];drain();
  NSCAssert([state isEqualToString:@"connected"],@"Settings start did not emit state");
  NSCAssert([controller valueForKey:@"lastError"]==nil,@"old error survived reconnect");
  controller.freshManager=nil;
  [controller state:receive];drain();
  NSCAssert(controller.loads==2 && [state isEqualToString:@"disconnected"],@"foreground refresh reused stale manager");
  [NSNotificationCenter.defaultCenter removeObserver:observer];
  puts("TUNNEL_STATE_SMOKE_PASSED");
} }
