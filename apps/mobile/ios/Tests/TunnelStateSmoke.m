#import "../Hafen/HafenTunnelController.h"
#import <NetworkExtension/NetworkExtension.h>

@interface FakeConnection : NSObject
@property NEVPNStatus status;
@property(nonatomic,strong) NSDate *connectedDate;
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
@property(nonatomic,copy) NSString *actualName;
@end
@implementation TestController
- (void)message:(NSString *)command session:(NETunnelProviderSession *)session timeout:(NSTimeInterval)timeout completion:(void (^)(NSDictionary *))completion {
  NSCAssert([command isEqualToString:@"selection"],@"unexpected command");
  completion(self.actualName ? @{@"name":self.actualName} : @{});
}
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
  manager.connection.connectedDate=NSDate.date;
  controller.actualName=@"Actual A";
  __block NSString *state;
  __block id connectionName;
  void (^receive)(NSString *)=^(NSString *json){NSDictionary *value=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];state=value[@"state"];connectionName=value[@"connectionName"];};
  [controller state:receive];drain();NSCAssert([state isEqualToString:@"connected"],@"initial state");
  NSCAssert([connectionName isEqualToString:@"Actual A"],@"system-started node identity missing");
  controller.actualName=@"Actual B";
  [controller state:receive];drain();
  NSCAssert([connectionName isEqualToString:@"Actual B"],@"active identity failed to refresh");
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
  NSCAssert(controller.loads==3 && [state isEqualToString:@"disconnected"],@"foreground refresh reused stale manager");
  [NSNotificationCenter.defaultCenter removeObserver:observer];
  puts("TUNNEL_STATE_SMOKE_PASSED");
} }
