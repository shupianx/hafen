#import <Foundation/Foundation.h>
#import <Security/Security.h>

// Only the most recently selected node is shared with the packet extension.
// Subscription URLs and whole subscription bundles remain in the app vault.
static inline NSMutableDictionary *HafenTunnelQuery(void) {
  NSString *group=[NSBundle.mainBundle objectForInfoDictionaryKey:@"HafenTunnelKeychainGroup"];
  if(![group isKindOfClass:NSString.class] || !group.length || [group containsString:@"$("]) return nil;
  return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrAccessGroup:group,
    (__bridge id)kSecAttrService:@"hafen.tunnel.resume.v1",
    (__bridge id)kSecAttrAccount:@"selected-node",
    (__bridge id)kSecAttrSynchronizable:@NO} mutableCopy];
}
static inline NSDictionary *HafenReadTunnelRecord(OSStatus *status) {
  NSMutableDictionary *query=HafenTunnelQuery();
  if(!query){*status=errSecMissingEntitlement;return nil;}
  query[(__bridge id)kSecReturnData]=@YES;
  query[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;
  CFTypeRef value=NULL;
  *status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&value);
  if(*status!=errSecSuccess) return nil;
  NSData *data=CFBridgingRelease(value);
  id record=[data isKindOfClass:NSData.class] ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if(![record isKindOfClass:NSDictionary.class] || ![record[@"profile"] isKindOfClass:NSString.class] || ![record[@"subscription"] isKindOfClass:NSString.class]){*status=errSecDecode;return nil;}
  return record;
}
static inline OSStatus HafenSaveTunnelSelection(NSString *profile,NSString *subscription,NSDictionary *selection) {
  NSMutableDictionary *query=HafenTunnelQuery();
  if(!query) return errSecMissingEntitlement;
  NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"profile":profile,@"subscription":subscription ?: @"",@"selection":selection ?: (id)NSNull.null} options:0 error:nil];
  if(!data || data.length>32768) return errSecParam;
  NSDictionary *attributes=@{(__bridge id)kSecValueData:data,
    (__bridge id)kSecAttrGeneric:[(subscription ?: @"") dataUsingEncoding:NSUTF8StringEncoding],
    (__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
  OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);
  if(status==errSecItemNotFound){[query addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)query,NULL);}
  return status;
}
static inline OSStatus HafenDeleteTunnelProfileForSubscription(NSString *subscription) {
  NSMutableDictionary *query=HafenTunnelQuery();
  if(!query) return errSecMissingEntitlement;
  // Atomically match the owner; deleting an old subscription cannot erase a
  // newer selection from another subscription.
  query[(__bridge id)kSecAttrGeneric]=[subscription dataUsingEncoding:NSUTF8StringEncoding];
  OSStatus status=SecItemDelete((__bridge CFDictionaryRef)query);
  return status==errSecItemNotFound ? errSecSuccess : status;
}

// Compatibility for manual profiles and records written by older builds.
static inline OSStatus HafenSaveTunnelProfile(NSString *profile,NSString *subscription) {
  return HafenSaveTunnelSelection(profile,subscription,nil);
}
