#import <Foundation/Foundation.h>
FOUNDATION_EXPORT NSNotificationName const HafenTunnelStateDidChange;
@interface HafenTunnelController : NSObject
+ (instancetype)shared;
+ (BOOL)available;
- (void)prepare:(void (^)(BOOL, NSString *))completion;
- (void)start:(NSString *)profile subscription:(NSString *)subscription selection:(NSDictionary *)selection completion:(void (^)(NSString *, NSString *))completion;
- (void)stop:(void (^)(NSString *, NSString *))completion;
- (void)state:(void (^)(NSString *))completion;
- (void)diagnose:(void (^)(NSString *, NSString *))completion;
- (void)forgetSubscription:(NSString *)subscription completion:(void (^)(BOOL))completion;
@end
