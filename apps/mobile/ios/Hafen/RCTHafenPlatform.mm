#import "RCTHafenPlatform.h"
#import <Security/Security.h>
#import "HafenCoreBridge.h"
#import "HafenTunnelController.h"
#import "../Shared/HafenTunnelStore.h"

@interface RCTHafenPlatform ()
@property(nonatomic, strong) dispatch_queue_t vaultQueue;
@property(nonatomic, copy) NSString *service;
@property(nonatomic) NSUInteger vpnRequest;
@end

@implementation RCTHafenPlatform

+ (NSString *)moduleName { return @"NativeHafenPlatform"; }
+ (BOOL)requiresMainQueueSetup { return NO; }

- (instancetype)init {
  if ((self = [super init])) {
    _vaultQueue = dispatch_queue_create("hafen.subscription-vault", DISPATCH_QUEUE_SERIAL);
    _service = [[NSBundle mainBundle].bundleIdentifier stringByAppendingString:@".subscriptions.v1"];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(tunnelStateChanged:) name:HafenTunnelStateDidChange object:nil];
  }
  return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)tunnelStateChanged:(NSNotification *)notification {
  NSString *state=notification.userInfo[@"state"];
  if(state) [self emitOnVpnStateChanged:state];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeHafenPlatformSpecJSI>(params);
}

- (void)getEnvironment:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  // Simulator builds cannot establish a system Packet Tunnel.
  NSString *info = [HafenCoreBridge info];
  NSDictionary *core = info ? [NSJSONSerialization JSONObjectWithData:[info dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  if (![core isKindOfClass:NSDictionary.class]) { reject(@"NATIVE_OPERATION_FAILED", @"NATIVE_OPERATION_FAILED", nil); return; }
  resolve([self json:@{@"platform": @"ios", @"nativeVersion": @1,
                      @"coreAvailable": core[@"ready"] ?: @NO, @"core": core,
                      @"vpnAvailable": @([HafenTunnelController available]),
                      @"vpnPermission": [HafenTunnelController available] ? @"required" : @"unsupported"}]);
}

- (NSString *)coreError:(NSError *)error {
  NSSet *codes = [NSSet setWithArray:@[@"INVALID_CORE_PROFILE", @"UNSUPPORTED_CORE_PROTOCOL", @"CORE_CONFIGURATION_FAILED", @"CORE_CLOSE_FAILED", @"CORE_SELF_TEST_FAILED", @"OPERATION_IN_PROGRESS"]];
  return [codes containsObject:error.localizedDescription] ? error.localizedDescription : @"CORE_SELF_TEST_FAILED";
}

- (void)checkCoreProfile:(NSString *)profile resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSError *error = nil;
    if ([HafenCoreBridge checkProfile:profile error:&error]) resolve(nil);
    else { NSString *code = [self coreError:error]; reject(code, code, nil); }
  });
}

- (void)runCoreSelfTest:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSError *error = nil;
    NSString *result = [HafenCoreBridge selfTest:&error];
    if (result) resolve(result);
    else { NSString *code = [self coreError:error]; reject(code, code, nil); }
  });
}

- (void)prepareVpn:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [[HafenTunnelController shared] prepare:^(BOOL ready, NSString *code) {
    if(code) reject(code,code,nil);else resolve(@(ready));
  }];
}

- (void)getVpnState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [[HafenTunnelController shared] state:^(NSString *value){resolve(value);}];
}
- (void)getVpnDiagnostics:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [[HafenTunnelController shared] diagnose:^(NSString *value,NSString *code){if(code)reject(code,code,nil);else resolve(value);}];
}
- (void)startVpn:(NSString *)profile resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSUInteger request; @synchronized(self) { request = ++self.vpnRequest; }
  dispatch_async(self.vaultQueue, ^{
    NSError *error=nil;
    if(![HafenCoreBridge checkProfile:profile error:&error]) {NSString *code=[self coreError:error];reject(code,code,nil);return;}
    @synchronized(self) {
      if (request != self.vpnRequest) { reject(@"TUNNEL_CANCELLED", @"TUNNEL_CANCELLED", nil); return; }
      [[HafenTunnelController shared] start:profile subscription:nil selection:@{@"name":@"手动节点"} completion:^(NSString *value,NSString *code){if(code)reject(code,code,nil);else resolve(value);}];
    }
  });
}
- (void)stopVpn:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  @synchronized(self) {
    ++self.vpnRequest;
    [[HafenTunnelController shared] stop:^(NSString *value,NSString *code){if(code)reject(code,code,nil);else resolve(value);}];
  }
}

- (NSMutableDictionary *)query {
  return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: self.service,
            (__bridge id)kSecAttrSynchronizable: @NO} mutableCopy];
}

- (NSArray<NSDictionary *> *)records {
  NSMutableDictionary *query = [self query];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitAll;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) return @[];
  if (status != errSecSuccess) {
#if DEBUG
    NSLog(@"[Hafen] Keychain read failed, OSStatus=%d", (int)status);
#endif
    if (result) CFRelease(result);
    return nil;
  }
  NSArray *dataItems = CFBridgingRelease(result);
  if (![dataItems isKindOfClass:NSArray.class]) return nil;
  NSMutableArray *records = [NSMutableArray new];
  for (NSData *data in dataItems) {
    if (![data isKindOfClass:NSData.class]) return nil;
    NSDictionary *record = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![record isKindOfClass:NSDictionary.class] ||
        ![record[@"id"] isKindOfClass:NSString.class] ||
        ![record[@"name"] isKindOfClass:NSString.class] ||
        ![record[@"sourceUrl"] isKindOfClass:NSString.class] ||
        ![record[@"createdAtMs"] isKindOfClass:NSNumber.class]) return nil;
    [records addObject:record];
  }
  return records;
}

- (NSDictionary *)metadata:(NSDictionary *)record {
  NSString *host = [NSURLComponents componentsWithString:record[@"sourceUrl"]].host;
  if (!host.length) return nil;
  return @{@"id": record[@"id"], @"name": record[@"name"],
           @"host": host, @"createdAtMs": record[@"createdAtMs"]};
}

- (NSString *)json:(id)value {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

- (void)listSubscriptions:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSArray *records = [self records];
    if (!records) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    NSMutableArray *result = [NSMutableArray new];
    for (NSDictionary *record in records) {
      NSDictionary *metadata = [self metadata:record];
      if (!metadata) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
      [result addObject:metadata];
    }
    NSString *json = [self json:result];
    if (json) resolve(json); else reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil);
  });
}

- (NSString *)validateName:(NSString *)name url:(NSString *)url {
  if (!name.length || name.length > 64 || [name rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) return @"INVALID_NAME";
  if (!url.length || url.length > 8192 || [url containsString:@"\\"] ||
      [url rangeOfCharacterFromSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].location != NSNotFound ||
      [url rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) return @"INVALID_URL";
  NSURLComponents *components = [NSURLComponents componentsWithString:url];
  if (!components) return @"INVALID_URL";
  if (![components.scheme.lowercaseString isEqualToString:@"https"]) return @"HTTPS_REQUIRED";
  if (!components.host.length || !components.URL || ![url.lowercaseString hasPrefix:@"https://"] || components.port.integerValue > 65535) return @"INVALID_URL";
  if (components.user != nil || components.password != nil) return @"URL_CREDENTIALS_NOT_ALLOWED";
  if (components.fragment != nil) return @"URL_FRAGMENT_NOT_ALLOWED";
  return nil;
}

- (void)saveSubscription:(NSString *)name sourceUrl:(NSString *)sourceUrl resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSString *title = [name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSString *url = [sourceUrl stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSString *errorCode = [self validateName:title url:url];
    if (errorCode) { reject(errorCode, errorCode, nil); return; }
    NSArray *records = [self records];
    if (!records) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    for (NSDictionary *record in records) {
      if ([record[@"sourceUrl"] isEqualToString:url]) { reject(@"DUPLICATE_SUBSCRIPTION", @"DUPLICATE_SUBSCRIPTION", nil); return; }
    }
    if (records.count >= 50) { reject(@"SUBSCRIPTION_LIMIT", @"SUBSCRIPTION_LIMIT", nil); return; }
    NSString *identifier = NSUUID.UUID.UUIDString.lowercaseString;
    NSDictionary *record = @{@"id": identifier, @"name": title, @"sourceUrl": url,
                             @"createdAtMs": @((long long)(NSDate.date.timeIntervalSince1970 * 1000))};
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
    NSDictionary *metadata = [self metadata:record];
    NSString *response = metadata ? [self json:metadata] : nil;
    if (!data || !response) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    NSMutableDictionary *query = [self query];
    query[(__bridge id)kSecAttrAccount] = identifier;
    query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    query[(__bridge id)kSecValueData] = data;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status == errSecSuccess) resolve(response);
    else reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil);
  });
}

- (NSString *)subscriptionError:(NSError *)error {
  NSSet *codes = [NSSet setWithArray:@[@"INVALID_URL", @"INVALID_SUBSCRIPTION_CONTENT", @"SUBSCRIPTION_DOWNLOAD_FAILED", @"SUBSCRIPTION_TIMEOUT", @"SUBSCRIPTION_HTTP_ERROR", @"SUBSCRIPTION_TOO_LARGE", @"SUBSCRIPTION_NODE_LIMIT", @"NO_SUPPORTED_NODES", @"STALE_SUBSCRIPTION", @"INVALID_NODE", @"NUMERIC_ENDPOINT_REQUIRED"]];
  return [codes containsObject:error.localizedDescription] ? error.localizedDescription : @"STORAGE_UNAVAILABLE";
}

// All calls run on vaultQueue, including download and commit. Delete/refresh/start
// therefore observe one version; no late download can resurrect a deleted record.
- (NSDictionary *)record:(NSString *)identifier reject:(RCTPromiseRejectBlock)reject {
  if (![[NSUUID alloc] initWithUUIDString:identifier]) { reject(@"INVALID_SUBSCRIPTION", @"INVALID_SUBSCRIPTION", nil); return nil; }
  NSArray *records = [self records];
  if (!records) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return nil; }
  for (NSDictionary *record in records) if ([record[@"id"] isEqualToString:identifier]) return record;
  reject(@"INVALID_SUBSCRIPTION", @"INVALID_SUBSCRIPTION", nil);
  return nil;
}

// Only opaque node IDs are kept in display preferences, keyed by subscription.
- (void)getNodeOrder:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    resolve([NSUserDefaults.standardUserDefaults stringForKey:[@"nodeOrder." stringByAppendingString:identifier]] ?: @"[]");
  });
}

- (void)setNodeOrder:(NSString *)identifier order:(NSString *)order resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    if (![self record:identifier reject:reject]) return;
    [NSUserDefaults.standardUserDefaults setObject:order forKey:[@"nodeOrder." stringByAppendingString:identifier]];
    resolve(nil);
  });
}

- (void)listSubscriptionNodes:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSDictionary *record = [self record:identifier reject:reject]; if (!record) return;
    NSString *bundle = record[@"bundle"];
    if (!bundle) { resolve(@"null"); return; }
    if (![bundle isKindOfClass:NSString.class]) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    NSError *error = nil;
    NSString *summary = [HafenCoreBridge subscriptionSummary:bundle error:&error];
    if (summary) resolve(summary); else { NSString *code=[self subscriptionError:error]; reject(code,code,nil); }
  });
}

- (void)updateSubscription:(NSString *)identifier content:(NSString *)content resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSDictionary *record = [self record:identifier reject:reject]; if (!record) return;
    NSError *error = nil;
    NSString *bundle = content ? [HafenCoreBridge parseSubscription:content error:&error] : [HafenCoreBridge fetchSubscription:record[@"sourceUrl"] error:&error];
    NSString *summary = bundle ? [HafenCoreBridge subscriptionSummary:bundle error:&error] : nil;
    if (!summary) { NSString *code=[self subscriptionError:error]; reject(code,code,nil); return; }
    NSMutableDictionary *next = [record mutableCopy]; next[@"bundle"] = bundle;
    NSData *data = [NSJSONSerialization dataWithJSONObject:next options:0 error:nil];
    if (!data) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    NSArray *records = [self records];
    if (!records) { reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil); return; }
    NSUInteger total = data.length;
    for (NSDictionary *other in records) if (![other[@"id"] isEqualToString:identifier]) total += [NSJSONSerialization dataWithJSONObject:other options:0 error:nil].length;
    if (total > 2000000) { reject(@"SUBSCRIPTION_STORAGE_LIMIT", @"SUBSCRIPTION_STORAGE_LIMIT", nil); return; }
    NSMutableDictionary *query = [self query]; query[(__bridge id)kSecAttrAccount] = identifier;
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData:data});
    if (status == errSecSuccess && [self reconcileSelection:identifier bundle:bundle summary:summary]) resolve(summary); else reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil);
  });
}
- (void)refreshSubscription:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self updateSubscription:identifier content:nil resolve:resolve reject:reject];
}
- (void)importSubscription:(NSString *)identifier content:(NSString *)content resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self updateSubscription:identifier content:content resolve:resolve reject:reject];
}
// The selection and restart profile are one Keychain item: Settings never reads
// a profile belonging to a different visible selection.
- (NSDictionary *)selection:(NSString *)identifier bundle:(NSString *)bundle revision:(NSString *)revision node:(NSString *)nodeId {
  NSString *json=[HafenCoreBridge subscriptionSummary:bundle error:nil];
  NSDictionary *summary=json ? [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  for(NSDictionary *node in summary[@"nodes"]) if([node[@"id"] isEqualToString:nodeId])
    return @{@"subscriptionId":identifier,@"revision":revision,@"nodeId":nodeId,@"name":node[@"name"]};
  return nil;
}
- (void)getSelectedNode:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    OSStatus status;
    NSDictionary *record=HafenReadTunnelRecord(&status);
    if(status!=errSecSuccess && status!=errSecItemNotFound){reject(@"STORAGE_UNAVAILABLE",@"STORAGE_UNAVAILABLE",nil);return;}
    NSDictionary *selection=record[@"selection"];
    resolve([selection isKindOfClass:NSDictionary.class] && selection[@"subscriptionId"] ? [self json:selection] : @"null");
  });
}
- (void)selectSubscriptionNode:(NSString *)identifier revision:(NSString *)revision nodeId:(NSString *)nodeId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    NSDictionary *record=[self record:identifier reject:reject]; if(!record)return;
    NSString *bundle=record[@"bundle"];
    if(![bundle isKindOfClass:NSString.class]){reject(@"INVALID_NODE",@"INVALID_NODE",nil);return;}
    NSError *error=nil;
    NSString *profile=[HafenCoreBridge subscriptionProfile:bundle revision:revision node:nodeId error:&error];
    if(!profile){NSString *code=[self subscriptionError:error];reject(code,code,nil);return;}
    NSDictionary *selection=[self selection:identifier bundle:bundle revision:revision node:nodeId];
    if(!selection || HafenSaveTunnelSelection(profile,identifier,selection)!=errSecSuccess){reject(@"STORAGE_UNAVAILABLE",@"STORAGE_UNAVAILABLE",nil);return;}
    resolve([self json:selection]);
  });
}
- (BOOL)reconcileSelection:(NSString *)identifier bundle:(NSString *)bundle summary:(NSString *)json {
  OSStatus status;
  NSDictionary *saved=HafenReadTunnelRecord(&status);
  if(status==errSecItemNotFound)return YES;
  if(status!=errSecSuccess)return NO;
  if(![saved[@"subscription"] isEqualToString:identifier])return YES;
  NSDictionary *selection=saved[@"selection"];
  if(![selection isKindOfClass:NSDictionary.class] || !selection[@"nodeId"]) {
    // Old builds did not store identity. Do not guess a node by display name.
    return HafenDeleteTunnelProfileForSubscription(identifier)==errSecSuccess;
  }
  NSDictionary *summary=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  NSString *revision=summary[@"revision"];
  NSDictionary *next=[self selection:identifier bundle:bundle revision:revision node:selection[@"nodeId"]];
  if(!next)return HafenDeleteTunnelProfileForSubscription(identifier)==errSecSuccess;
  NSString *profile=[HafenCoreBridge subscriptionProfile:bundle revision:revision node:selection[@"nodeId"] error:nil];
  return profile && HafenSaveTunnelSelection(profile,identifier,next)==errSecSuccess;
}

- (void)startSubscriptionNode:(NSString *)identifier revision:(NSString *)revision nodeId:(NSString *)nodeId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSUInteger request; @synchronized(self) { request = ++self.vpnRequest; }
  dispatch_async(self.vaultQueue, ^{
    NSDictionary *record = [self record:identifier reject:reject]; if (!record) return;
    NSString *bundle = record[@"bundle"];
    if (![bundle isKindOfClass:NSString.class]) { reject(@"INVALID_NODE", @"INVALID_NODE", nil); return; }
    NSError *error=nil;
    NSString *profile=[HafenCoreBridge subscriptionProfile:bundle revision:revision node:nodeId error:&error];
    if (!profile) {NSString *code=[self subscriptionError:error];reject(code,code,nil);return;}
    @synchronized(self) {
      if (request != self.vpnRequest) { reject(@"TUNNEL_CANCELLED", @"TUNNEL_CANCELLED", nil); return; }
      [[HafenTunnelController shared] start:profile subscription:identifier selection:[self selection:identifier bundle:bundle revision:revision node:nodeId] completion:^(NSString *value,NSString *code){if(code)reject(code,code,nil);else resolve(value);}];
    }
  });
}

- (void)deleteSubscription:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.vaultQueue, ^{
    if (![[NSUUID alloc] initWithUUIDString:identifier]) { reject(@"INVALID_SUBSCRIPTION", @"INVALID_SUBSCRIPTION", nil); return; }
    [[HafenTunnelController shared] forgetSubscription:identifier completion:^(BOOL cleared){
      if(!cleared){reject(@"STORAGE_UNAVAILABLE",@"STORAGE_UNAVAILABLE",nil);return;}
      dispatch_async(self.vaultQueue, ^{
        NSMutableDictionary *query = [self query];
        query[(__bridge id)kSecAttrAccount] = identifier;
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        if (status == errSecSuccess || status == errSecItemNotFound) {
          [NSUserDefaults.standardUserDefaults removeObjectForKey:[@"nodeOrder." stringByAppendingString:identifier]];
          resolve(nil);
        }
        else reject(@"STORAGE_UNAVAILABLE", @"STORAGE_UNAVAILABLE", nil);
      });
    }];
  });
}
@end
