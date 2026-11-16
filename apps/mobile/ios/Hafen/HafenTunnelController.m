#import "HafenTunnelController.h"
#import "HafenCoreBridge.h"
#import <NetworkExtension/NetworkExtension.h>
#import <TargetConditionals.h>
#import "../Shared/HafenTunnelStore.h"
#import "../Shared/HafenTunnelDiagnostics.h"

NSNotificationName const HafenTunnelStateDidChange = @"HafenTunnelStateDidChange";

@interface HafenTunnelController ()
@property(nonatomic, strong) NETunnelProviderManager *manager;
@property(nonatomic) BOOL busy;
@property(nonatomic) NSUInteger requestVersion;
@property(nonatomic) BOOL diagnosing;
@property(nonatomic,copy) NSString *lastError;
@property(nonatomic, copy) NSString *requestedSubscription;
@end
@implementation HafenTunnelController
- (instancetype)init {
  if((self=[super init])) {
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(vpnStatusChanged:) name:NEVPNStatusDidChangeNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(vpnConfigurationChanged:) name:NEVPNConfigurationChangeNotification object:nil];
  }
  return self;
}
- (void)publishState {
  [NSNotificationCenter.defaultCenter postNotificationName:HafenTunnelStateDidChange object:self userInfo:@{@"state":[self snapshot]}];
}
- (void)vpnStatusChanged:(NSNotification *)notification {
  dispatch_async(dispatch_get_main_queue(), ^{
    if(notification.object!=self.manager.connection) return;
    NEVPNConnection *connection=self.manager.connection;
    if(connection.status==NEVPNStatusConnecting || connection.status==NEVPNStatusConnected) self.lastError=nil;
    [self publishState];
    if(connection.status==NEVPNStatusDisconnected) {
      if(@available(iOS 16.0, macOS 13.0, *)) {
        NSUInteger version=self.requestVersion;
        [connection fetchLastDisconnectErrorWithCompletionHandler:^(NSError *error){
          dispatch_async(dispatch_get_main_queue(), ^{
            if(version!=self.requestVersion || self.manager.connection!=connection || connection.status!=NEVPNStatusDisconnected) return;
            NSSet *codes=[NSSet setWithArray:@[@"ENDPOINT_DNS_FAILED",@"NETWORK_UNAVAILABLE",@"NETWORK_CHANGED",@"CORE_START_FAILED",@"TUNNEL_START_FAILED",@"TUNNEL_START_TIMEOUT",@"TUNNEL_IO_FAILED"]];
            self.lastError=([error.domain isEqualToString:@"HafenTunnel"] && [codes containsObject:error.localizedDescription]) ? error.localizedDescription : (error ? @"TUNNEL_START_FAILED" : nil);
            [self publishState];
          });
        }];
      }
    }
  });
}
- (void)vpnConfigurationChanged:(NSNotification *)notification {
  [self state:^(NSString *state){ [self publishState]; }];
}
+ (instancetype)shared { static HafenTunnelController *value; static dispatch_once_t once; dispatch_once(&once, ^{value=[self new];}); return value; }
+ (BOOL)available {
#if TARGET_OS_SIMULATOR
  return NO;
#else
  return YES;
#endif
}
- (NSString *)providerID { return [[NSBundle mainBundle].bundleIdentifier stringByAppendingString:@".PacketTunnel"]; }
- (NSString *)snapshot {
  NSString *state=@"disconnected";
  switch(self.manager.connection.status) {
    case NEVPNStatusConnecting: case NEVPNStatusReasserting: state=@"connecting"; break;
    case NEVPNStatusConnected: state=@"connected"; break;
    case NEVPNStatusDisconnecting: state=@"disconnecting"; break;
    default: break;
  }
  NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"state":state,@"error":self.lastError ?: NSNull.null,@"internetReachable":NSNull.null} options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}
- (void)load:(void (^)(NSError *))completion {
  [NETunnelProviderManager loadAllFromPreferencesWithCompletionHandler:^(NSArray<NETunnelProviderManager *> *managers,NSError *error){
    dispatch_async(dispatch_get_main_queue(), ^{
      if(error){completion(error);return;}
      self.manager=nil;
      for(NETunnelProviderManager *candidate in managers) {
        NETunnelProviderProtocol *protocol=(NETunnelProviderProtocol *)candidate.protocolConfiguration;
        if([protocol isKindOfClass:NETunnelProviderProtocol.class] && [protocol.providerBundleIdentifier isEqualToString:[self providerID]]) {self.manager=candidate;break;}
      }
      completion(error);
    });
  }];
}
- (void)prepare:(void (^)(BOOL,NSString *))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    if(![HafenTunnelController available]) {completion(NO,@"VPN_UNAVAILABLE");return;}
    if(self.busy){completion(NO,@"OPERATION_IN_PROGRESS");return;}self.busy=YES;
    [self load:^(NSError *error){
      if(error){self.busy=NO;completion(NO,@"VPN_PERMISSION_REQUIRED");return;}
      // Migrate already-installed build 1/2 configurations as well as new ones.
      if(self.manager.isEnabled && self.manager.protocolConfiguration.includeAllNetworks){self.busy=NO;completion(YES,nil);return;}
      NETunnelProviderManager *manager=self.manager ?: [NETunnelProviderManager new];
      NETunnelProviderProtocol *protocol=[NETunnelProviderProtocol new];
      protocol.providerBundleIdentifier=[self providerID];protocol.serverAddress=@"Hafen";
      protocol.disconnectOnSleep=NO;
      protocol.includeAllNetworks=YES;
      protocol.excludeLocalNetworks=NO;
      manager.protocolConfiguration=protocol;manager.localizedDescription=@"Hafen";manager.enabled=YES;
      manager.onDemandEnabled=NO;manager.onDemandRules=@[];
      [manager saveToPreferencesWithCompletionHandler:^(NSError *saveError){
        dispatch_async(dispatch_get_main_queue(), ^{
          if(saveError){self.busy=NO;completion(NO,@"VPN_PERMISSION_REQUIRED");return;}
          [self load:^(NSError *reloadError){self.busy=NO;completion(reloadError==nil,reloadError?@"VPN_PERMISSION_REQUIRED":nil);}];
        });
      }];
    }];
  });
}
- (void)start:(NSString *)profile subscription:(NSString *)subscription completion:(void (^)(NSString *,NSString *))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    if(![HafenTunnelController available]){completion(nil,@"VPN_UNAVAILABLE");return;}
    if(self.busy){completion(nil,@"OPERATION_IN_PROGRESS");return;}self.busy=YES;
    self.lastError=nil;
    NSUInteger version=++self.requestVersion;
    self.requestedSubscription=subscription;
    [self load:^(NSError *error){
      if(version!=self.requestVersion){self.busy=NO;completion(nil,@"TUNNEL_CANCELLED");return;}
      if(error || !self.manager.isEnabled){self.busy=NO;completion(nil,@"VPN_PERMISSION_REQUIRED");return;}
      NEVPNStatus status=self.manager.connection.status;
      if(status!=NEVPNStatusDisconnected && status!=NEVPNStatusInvalid){self.busy=NO;completion(nil,@"OPERATION_IN_PROGRESS");return;}
      if(HafenSaveTunnelProfile(profile,subscription)!=errSecSuccess){self.busy=NO;completion(nil,@"STORAGE_UNAVAILABLE");return;}
      NSError *startError=nil;
      BOOL started=[(NETunnelProviderSession *)self.manager.connection startTunnelWithOptions:@{@"profile":profile} andReturnError:&startError];
      self.busy=NO;completion(started?[self snapshot]:nil,started?nil:@"TUNNEL_START_FAILED");
    }];
  });
}
- (void)stop:(void (^)(NSString *,NSString *))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.requestVersion+=1;
    if(self.busy){[self.manager.connection stopVPNTunnel];completion([self snapshot],nil);return;}
    self.busy=YES;
    [self load:^(NSError *error){
      self.busy=NO;
      if(error){completion(nil,@"TUNNEL_STOP_FAILED");return;}
      [self.manager.connection stopVPNTunnel];completion([self snapshot],nil);
    }];
  });
}
- (void)forgetSubscription:(NSString *)subscription completion:(void (^)(BOOL))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    if([self.requestedSubscription isEqualToString:subscription]) self.requestVersion+=1;
    completion(HafenDeleteTunnelProfileForSubscription(subscription)==errSecSuccess);
  });
}
- (void)state:(void (^)(NSString *))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Refresh from preferences, including after Settings switched/deleted a VPN.
    // Never keep returning a manager cached before the app was suspended.
    if(![HafenTunnelController available] || self.busy){completion([self snapshot]);return;}
    self.busy=YES;
    [self load:^(NSError *error){self.busy=NO;completion([self snapshot]);}];
  });
}
// Completion is main-queue, exactly once, even if the extension exits mid-request.
- (void)message:(NSString *)command session:(NETunnelProviderSession *)session timeout:(NSTimeInterval)timeout completion:(void (^)(NSDictionary *))completion {
  __block BOOL finished=NO;
  void (^finish)(NSData *)=^(NSData *data) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if(finished) return; finished=YES;
      id value=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      completion([value isKindOfClass:NSDictionary.class] ? value : nil);
    });
  };
  NSError *error=nil;
  if(![session sendProviderMessage:[command dataUsingEncoding:NSUTF8StringEncoding] returnError:&error responseHandler:finish]) finish(nil);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout*NSEC_PER_SEC)), dispatch_get_main_queue(), ^{finish(nil);});
}
- (void)diagnose:(void (^)(NSString *, NSString *))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    if(self.diagnosing){completion(nil,@"OPERATION_IN_PROGRESS");return;}
    if(self.manager.connection.status!=NEVPNStatusConnected){completion(nil,@"VPN_NOT_CONNECTED");return;}
    self.diagnosing=YES;
    NSUInteger version=self.requestVersion;
    NETunnelProviderSession *session=(NETunnelProviderSession *)self.manager.connection;
    NSDate *connectedDate=session.connectedDate;
    BOOL includeAllNetworks=self.manager.protocolConfiguration.includeAllNetworks;
    [self message:@"stats" session:session timeout:2 completion:^(NSDictionary *before){
      NSMutableDictionary *result=HafenDiagnosticReport(includeAllNetworks);
      dispatch_group_t group=dispatch_group_create();
      dispatch_group_enter(group);
      [self message:@"probe" session:session timeout:26 completion:^(NSDictionary *probe){
        if([probe[@"proxyHTTPS"] isKindOfClass:NSNumber.class]) result[@"proxyHTTPS"]=probe[@"proxyHTTPS"];
        NSSet *codes=[NSSet setWithArray:@[@"NONE",@"DNS",@"TLS",@"TIMEOUT",@"CONNECT",@"HTTP",@"CLOSED",@"BUSY",@"PROTECTION",@"REALITY",@"REFUSED",@"RESET",@"UNREACHABLE",@"EOF",@"TLS_HANDSHAKE"]];
        if([codes containsObject:probe[@"proxyError"]]) result[@"proxyError"]=probe[@"proxyError"];
        NSMutableSet *stages=[codes mutableCopy];
        [stages addObjectsFromArray:@[@"IP",@"SKIPPED",@"NOT_RUN",@"UNAVAILABLE"]];
        for(NSString *key in @[@"endpointDNS",@"endpointTCP",@"proxyHandshake",@"targetTLS"]) {
          if([stages containsObject:probe[key]]) result[key]=probe[key];
        }
        NSString *trace=probe[@"errorTrace"];
        NSCharacterSet *safe=[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.*: >[]-"];
        if([trace isKindOfClass:NSString.class] && trace.length<=200 && [trace rangeOfCharacterFromSet:safe.invertedSet].location==NSNotFound) result[@"errorTrace"]=trace;
        dispatch_group_leave(group);
      }];
      // Run in the containing app: unlike provider sockets this traverses system
      // routes and the tunnel DNS. A new ephemeral session avoids cached responses.
      NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
      configuration.URLCache=nil;configuration.HTTPCookieStorage=nil;
      configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
      configuration.timeoutIntervalForRequest=12;configuration.timeoutIntervalForResource=12;
      NSURLSession *http=[NSURLSession sessionWithConfiguration:configuration];
      NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://www.cloudflare.com/cdn-cgi/trace"]];
      [request setValue:@"no-cache" forHTTPHeaderField:@"Cache-Control"];
      dispatch_group_enter(group);
      [[http dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        [http finishTasksAndInvalidate];
        dispatch_async(dispatch_get_main_queue(), ^{
          NSInteger status=[response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
          result[@"systemHTTPS"]=HafenJSONBoolean(!error && status==200);
          NSString *code=error ? @"CONNECT" : (status==200 ? @"NONE" : @"HTTP");
          if([error.domain isEqualToString:NSURLErrorDomain]) {
            if(error.code==NSURLErrorCannotFindHost || error.code==NSURLErrorDNSLookupFailed) code=@"DNS";
            else if(error.code==NSURLErrorTimedOut) code=@"TIMEOUT";
            else if(error.code<=NSURLErrorSecureConnectionFailed && error.code>=NSURLErrorClientCertificateRequired) code=@"TLS";
          }
          result[@"systemError"]=code;
          dispatch_group_leave(group);
        });
      }] resume];
      dispatch_group_notify(group,dispatch_get_main_queue(), ^{
        [self message:@"stats" session:session timeout:2 completion:^(NSDictionary *after){
          self.diagnosing=NO;
          if(version!=self.requestVersion || session.status!=NEVPNStatusConnected || ![connectedDate isEqual:session.connectedDate]) {completion(nil,@"TUNNEL_CANCELLED");return;}
          for(NSString *key in @[@"networkAvailable",@"networkPaused"]) {
            if([after[key] isKindOfClass:NSNumber.class]) result[key]=HafenJSONBoolean([after[key] boolValue]);
          }
          for(NSString *key in @[@"packetsIn",@"packetsOut"]) {
            NSNumber *start=before[key], *end=after[key];
            BOOL valid=[start isKindOfClass:NSNumber.class] && [end isKindOfClass:NSNumber.class] && end.longLongValue>=start.longLongValue;
            result[key]=[end isKindOfClass:NSNumber.class] ? end : NSNull.null;
            result[[key stringByAppendingString:@"Delta"]]=valid ? @(end.longLongValue-start.longLongValue) : NSNull.null;
          }
          NSData *data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
          completion([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding],nil);
        }];
      });
    }];
  });
}
@end
