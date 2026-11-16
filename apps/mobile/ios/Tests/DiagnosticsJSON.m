#import "../Shared/HafenTunnelDiagnostics.h"
int main(void) { @autoreleasepool {
  NSMutableArray *reports=[NSMutableArray new];
  for(NSNumber *success in @[@YES,@NO]) {
    NSMutableDictionary *report=HafenDiagnosticReport(success.boolValue);
    NSError *error=success.boolValue ? nil : [NSError errorWithDomain:@"test" code:1 userInfo:nil];
    NSInteger status=200;
    report[@"systemHTTPS"]=HafenJSONBoolean(!error && status==200);
    report[@"systemError"]=success.boolValue ? @"NONE" : @"CONNECT";
    [reports addObject:report];
  }
  NSData *data=[NSJSONSerialization dataWithJSONObject:reports options:0 error:nil];
  puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
} }
