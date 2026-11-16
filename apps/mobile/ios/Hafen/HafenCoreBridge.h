#import <Foundation/Foundation.h>

// Keep gomobile's Objective-C module imports out of RN's Objective-C++ units.
@interface HafenCoreBridge : NSObject
+ (NSString *)info;
+ (BOOL)checkProfile:(NSString *)profile error:(NSError **)error;
+ (NSString *)selfTest:(NSError **)error;
+ (NSString *)fetchSubscription:(NSString *)url error:(NSError **)error;
+ (NSString *)parseSubscription:(NSString *)content error:(NSError **)error;
+ (NSString *)subscriptionSummary:(NSString *)bundle error:(NSError **)error;
+ (NSString *)subscriptionProfile:(NSString *)bundle revision:(NSString *)revision node:(NSString *)node error:(NSError **)error;
@end
