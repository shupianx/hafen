#import <NetworkExtension/NetworkExtension.h>
#import <Network/Network.h>
#import <arpa/inet.h>
#import <net/if.h>
#import <HafenCore/HafenCore.h>
#import "../Shared/HafenTunnelStore.h"
#import "../Shared/HafenSocketBinding.h"

@interface HafenSocketProtector : NSObject <MobileSocketProtector>
@property(nonatomic) int32_t interfaceIndex;
@end
@implementation HafenSocketProtector
// Pin every core TCP/UDP socket to the physical network.
// Endpoint system DNS runs before installing any tunnel routes.
- (BOOL)protect:(int32_t)fd { return HafenBindSocketToInterface(fd,self.interfaceIndex); }
- (NSString *)interfaceName {
 char name[IF_NAMESIZE]={0};
 return if_indextoname(self.interfaceIndex,name) ? [NSString stringWithUTF8String:name] : @"";
}
@end

@interface PacketTunnelProvider : NEPacketTunnelProvider
@property(nonatomic, strong) dispatch_queue_t control;
@property(nonatomic, strong) MobilePacketSession *session;
@property(nonatomic, strong) nw_path_monitor_t pathMonitor;
@property(nonatomic) NSUInteger generation;
@property(nonatomic, copy) void (^pendingStart)(NSError *);
@end

@implementation PacketTunnelProvider
- (instancetype)init {
  if ((self = [super init])) _control = dispatch_queue_create("hafen.packet-tunnel", DISPATCH_QUEUE_SERIAL);
  return self;
}
- (NSError *)failure:(NSString *)code {
  return [NSError errorWithDomain:@"HafenTunnel" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];
}
- (void)closeSession {
  self.generation += 1;
  if (self.pathMonitor) { nw_path_monitor_cancel(self.pathMonitor); self.pathMonitor = nil; }
  MobilePacketSession *session = self.session; self.session = nil;
  [session networkLost];
  [session close:nil];
  if (self.pendingStart) { self.pendingStart([self failure:@"TUNNEL_CANCELLED"]); self.pendingStart = nil; }
}
- (void)startTunnelWithOptions:(NSDictionary<NSString *, NSObject *> *)options completionHandler:(void (^)(NSError *))completionHandler {
  dispatch_async(self.control, ^{
    if (self.session || self.pendingStart) { completionHandler([self failure:@"OPERATION_IN_PROGRESS"]); return; }
    NSString *profile = [options[@"profile"] isKindOfClass:NSString.class] ? (NSString *)options[@"profile"] : nil;
    if(!profile) {
      OSStatus status;
      profile=HafenReadTunnelRecord(&status)[@"profile"];
      if(status!=errSecSuccess){completionHandler([self failure:status==errSecItemNotFound ? @"VPN_PROFILE_REQUIRED" : @"STORAGE_UNAVAILABLE"]);return;}
    }
    if (!profile || profile.length > 16384) { completionHandler([self failure:@"INVALID_CORE_PROFILE"]); return; }
    unsigned int interfaceIndex=HafenInitialInterface();
    if(!interfaceIndex){completionHandler([self failure:@"NETWORK_UNAVAILABLE"]);return;}
    HafenSocketProtector *protector=[HafenSocketProtector new];
    protector.interfaceIndex=interfaceIndex;
    NSError *error = nil;
    MobilePacketSession *session = MobileStartPacketSessionBeforeRoutes(profile, protector, &error);
    if (!session || error) {
      NSString *code=[error.localizedDescription containsString:@"ENDPOINT_DNS_FAILED"] ? @"ENDPOINT_DNS_FAILED" : @"CORE_START_FAILED";
      completionHandler([self failure:code]); return;
    }
    self.session = session; self.pendingStart = completionHandler;
    NSUInteger generation = ++self.generation;
    NSDictionary *node = [NSJSONSerialization JSONObjectWithData:[profile dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *remote = node[@"server"];
    struct in6_addr address;
    // NE requires an IP here. The local packet engine is the logical endpoint;
    // Endpoint addresses were resolved before routes; application DNS uses proxy.
    if (inet_pton(AF_INET, remote.UTF8String, &address) != 1 && inet_pton(AF_INET6, remote.UTF8String, &address) != 1) remote = @"127.0.0.1";
    NEPacketTunnelNetworkSettings *settings = [[NEPacketTunnelNetworkSettings alloc] initWithTunnelRemoteAddress:remote];
    settings.MTU = @1500;
    settings.IPv4Settings = [[NEIPv4Settings alloc] initWithAddresses:@[@"172.19.0.1"] subnetMasks:@[@"255.255.255.252"]];
    settings.IPv4Settings.includedRoutes = @[[NEIPv4Route defaultRoute]];
    settings.IPv6Settings = [[NEIPv6Settings alloc] initWithAddresses:@[@"fdfe:dcba:9876::1"] networkPrefixLengths:@[@126]];
    settings.IPv6Settings.includedRoutes = @[[NEIPv6Route defaultRoute]];
    settings.DNSSettings = [[NEDNSSettings alloc] initWithServers:@[@"172.19.0.2", @"fdfe:dcba:9876::2"]];
    settings.DNSSettings.matchDomains = @[@""];
    [self setTunnelNetworkSettings:settings completionHandler:^(NSError *settingsError) {
      dispatch_async(self.control, ^{
        if (generation != self.generation) return;
        void (^done)(NSError *) = self.pendingStart; self.pendingStart = nil;
        if (settingsError) { [self closeSession]; done([self failure:@"TUNNEL_START_FAILED"]); return; }
        [self readPackets:generation];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
          for (;;) { @autoreleasepool {
            NSError *readError = nil; NSData *packet = [session nextPacket:&readError];
            if (readError) {
              dispatch_async(self.control, ^{ if (generation == self.generation) { [self closeSession]; [self cancelTunnelWithError:[self failure:@"TUNNEL_IO_FAILED"]]; } });
              break;
            }
            if (!packet.length) continue;
            uint8_t version = ((const uint8_t *)packet.bytes)[0] >> 4;
            if (![self.packetFlow writePackets:@[packet] withProtocols:@[version == 6 ? @(AF_INET6) : @(AF_INET)]]) {
              dispatch_async(self.control, ^{ if (generation == self.generation) { [self closeSession]; [self cancelTunnelWithError:[self failure:@"TUNNEL_IO_FAILED"]]; } });
              break;
            }
          }}
        });
        self.pathMonitor = nw_path_monitor_create();
        nw_path_monitor_set_queue(self.pathMonitor, self.control);
        __weak PacketTunnelProvider *weakSelf = self;
        __block BOOL receivedInitialPath=NO;
        nw_path_monitor_set_update_handler(self.pathMonitor, ^(nw_path_t path) {
          PacketTunnelProvider *strongSelf = weakSelf;
          if (!strongSelf || generation != strongSelf.generation) return;
          if (HafenUnderlyingInterface(path)!=interfaceIndex) {
            [strongSelf closeSession]; [strongSelf cancelTunnelWithError:[strongSelf failure:@"NETWORK_CHANGED"]];
            return;
          }
          if (receivedInitialPath) {
            NSError *updateError=nil;
            if (![session refreshNetwork:&updateError]) {
              [strongSelf closeSession]; [strongSelf cancelTunnelWithError:[strongSelf failure:@"NETWORK_CHANGED"]];
            }
          }
          receivedInitialPath=YES;
        });
        nw_path_monitor_start(self.pathMonitor);
        done(nil);
      });
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), self.control, ^{
      if (generation == self.generation && self.pendingStart) { [self closeSession]; [self cancelTunnelWithError:[self failure:@"TUNNEL_START_TIMEOUT"]]; }
    });
  });
}
- (void)readPackets:(NSUInteger)generation {
  [self.packetFlow readPacketsWithCompletionHandler:^(NSArray<NSData *> *packets, NSArray<NSNumber *> *protocols) {
    dispatch_async(self.control, ^{
      if (generation != self.generation || !self.session) return;
      for (NSData *packet in packets) {
        NSError *error = nil;
        if (![self.session submitPacket:packet error:&error]) {
          [self closeSession]; [self cancelTunnelWithError:[self failure:@"TUNNEL_IO_FAILED"]]; return;
        }
      }
      [self readPackets:generation];
    });
  }];
}
- (void)stopTunnelWithReason:(NEProviderStopReason)reason completionHandler:(void (^)(void))completionHandler {
  dispatch_async(self.control, ^{ [self closeSession]; completionHandler(); });
}
- (void)handleAppMessage:(NSData *)messageData completionHandler:(void (^)(NSData *))completionHandler {
  dispatch_async(self.control, ^{
    NSString *command = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];
    if ([command isEqualToString:@"probe"]) {
      MobilePacketSession *session = self.session;
      // Network I/O must not block packet ingestion, stop, or path monitoring.
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSString *result = session ? [session probe] : @"{\"proxyHTTPS\":false,\"proxyError\":\"CLOSED\"}";
        if (completionHandler) completionHandler([result dataUsingEncoding:NSUTF8StringEncoding]);
      });
      return;
    }
    if (![command isEqualToString:@"stats"]) { if (completionHandler) completionHandler(nil); return; }
    NSString *stats = self.session ? [self.session stats] : @"{\"running\":false}";
    if (completionHandler) completionHandler([stats dataUsingEncoding:NSUTF8StringEncoding]);
  });
}
@end
