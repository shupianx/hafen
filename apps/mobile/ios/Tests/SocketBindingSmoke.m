#import "../Shared/HafenSocketBinding.h"
#import <net/if.h>
#import <unistd.h>
int main(void){@autoreleasepool{
 unsigned int index=if_nametoindex("lo0");NSCAssert(index>0,@"loopback missing");
 for(NSNumber *familyValue in @[@(AF_INET),@(AF_INET6)]){
  int family=familyValue.intValue;
  for(NSNumber *typeValue in @[@(SOCK_STREAM),@(SOCK_DGRAM)]){
   int fd=socket(family,typeValue.intValue,0);NSCAssert(fd>=0,@"socket failed");
   NSCAssert(!HafenBindSocketToInterface(fd,0),@"missing path accepted");
   NSCAssert(HafenBindSocketToInterface(fd,index),@"bind failed");
   unsigned int bound=0;socklen_t size=sizeof(bound);
   NSCAssert(getsockopt(fd,family==AF_INET ? IPPROTO_IP : IPPROTO_IPV6,family==AF_INET ? IP_BOUND_IF : IPV6_BOUND_IF,&bound,&size)==0 && bound==index,@"socket was not bound");
   close(fd);NSCAssert(!HafenBindSocketToInterface(fd,index),@"closed fd accepted");
  }
 }
 NSCAssert(!HafenBindSocketToInterface(-1,index),@"invalid fd accepted");
 puts("SOCKET_BINDING_SMOKE_PASSED: IPv4/IPv6 TCP/UDP, zero index and invalid fd");
}}
