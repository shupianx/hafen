#import <Foundation/Foundation.h>
#import <Network/Network.h>
#import <sys/socket.h>
#import <netinet/in.h>

// Use public BSD socket options; never access packetFlow's private descriptor.
static inline BOOL HafenBindSocketToInterface(int fd,unsigned int index) {
  if(index==0) return NO;
  struct sockaddr_storage address={0};socklen_t size=sizeof(address);
  if(getsockname(fd,(struct sockaddr *)&address,&size)!=0) return NO;
  int level,option;
  if(address.ss_family==AF_INET){level=IPPROTO_IP;option=IP_BOUND_IF;}
  else if(address.ss_family==AF_INET6){level=IPPROTO_IPV6;option=IPV6_BOUND_IF;}
  else return NO;
  return setsockopt(fd,level,option,&index,sizeof(index))==0;
}
static inline unsigned int HafenUnderlyingInterface(nw_path_t path) {
  if(nw_path_get_status(path)!=nw_path_status_satisfied) return 0;
  __block unsigned int index=0;
  nw_path_enumerate_interfaces(path, ^bool(nw_interface_t interface){
    nw_interface_type_t type=nw_interface_get_type(interface);
    if((type==nw_interface_type_wifi || type==nw_interface_type_cellular || type==nw_interface_type_wired) && nw_path_uses_interface_type(path,type)) {
      index=nw_interface_get_index(interface);return false;
    }
    return true;
  });
  return index;
}
// Obtain the physical path before installing default tunnel routes. Call only
// off the main queue. A missing path fails startup instead of claiming success.
static inline unsigned int HafenInitialInterface(void) {
  nw_path_monitor_t monitor=nw_path_monitor_create();
  dispatch_semaphore_t ready=dispatch_semaphore_create(0);
  dispatch_queue_t queue=dispatch_queue_create("hafen.initial-path",DISPATCH_QUEUE_SERIAL);
  __block unsigned int index=0;
  __block BOOL delivered=NO;
  nw_path_monitor_set_queue(monitor,queue);
  nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path){
    if(delivered) return;delivered=YES;
    index=HafenUnderlyingInterface(path);
    dispatch_semaphore_signal(ready);
  });
  nw_path_monitor_start(monitor);
  long timeout=dispatch_semaphore_wait(ready,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));
  nw_path_monitor_cancel(monitor);
  return timeout==0 ? index : 0;
}
