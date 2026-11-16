#import <Foundation/Foundation.h>

// C logical expressions have type int in .m files. Boxing @(a && b) emits
// JSON 0/1, not true/false, which breaks the typed bridge contract.
static inline NSNumber *HafenJSONBoolean(BOOL value) { return value ? @YES : @NO; }
static inline NSMutableDictionary *HafenDiagnosticReport(BOOL includeAllNetworks) {
  return [@{@"proxyHTTPS":NSNull.null,@"proxyError":@"UNAVAILABLE",
    @"endpointDNS":@"NOT_RUN",@"endpointTCP":@"NOT_RUN",@"proxyHandshake":@"NOT_RUN",@"targetTLS":@"NOT_RUN",@"errorTrace":@"",
    @"networkAvailable":NSNull.null,@"networkPaused":NSNull.null,
    @"systemHTTPS":NSNull.null,@"systemError":@"UNAVAILABLE",
    @"includeAllNetworks":HafenJSONBoolean(includeAllNetworks),
    @"packetsIn":NSNull.null,@"packetsOut":NSNull.null,
    @"packetsInDelta":NSNull.null,@"packetsOutDelta":NSNull.null} mutableCopy];
}
