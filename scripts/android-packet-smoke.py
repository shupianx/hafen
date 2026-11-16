import subprocess,select,os,time,struct,json
# Requires an already connected local SS or REALITY fixture; no credentials read.
adb=os.environ.get('ADB', 'adb')
serial=os.environ.get('ANDROID_SERIAL', 'emulator-5554')
def exchange(label,host,port,payload,udp=False,exact=True):
 command=['nc','-w','8','-W','8']+(['-u'] if udp else [])+[host,str(port)]
 p=subprocess.Popen([adb,'-s',serial,'shell','-T',*command],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 reply=b''
 try:
  p.stdin.write(payload);p.stdin.flush()
  end=time.monotonic()+12
  while time.monotonic()<end:
   ready,_,_=select.select([p.stdout],[],[],max(0,end-time.monotonic()))
   if not ready:break
   data=os.read(p.stdout.fileno(),4096)
   if not data:break
   reply+=data
   if not exact or len(reply)>=len(payload):break
 finally:
  p.terminate()
  try:p.communicate(timeout=2)
  except subprocess.TimeoutExpired:p.kill();p.communicate()
 if exact:
  result={'test':label,'passed':reply==payload,'receivedBytes':len(reply)}
 else:
  valid=len(reply)>=12
  values=struct.unpack('!6H',reply[:12]) if valid else (0,)*6
  result={'test':label,'passed':valid and values[0]==0x4866 and bool(values[1]&0x8000) and values[1]&15==0 and values[3]>0,'receivedBytes':len(reply),'rcode':values[1]&15,'answers':values[3]}
 print(json.dumps(result),flush=True)
 return result['passed']
results=[]
results.append(exchange('TCP echo','198.18.0.1',29392,b'hafen-android-tcp-check'))
results.append(exchange('UDP echo','198.18.0.1',29392,b'hafen-android-udp-check',udp=True))
query=struct.pack('!6H',0x4866,0x100,1,0,0,0)+b'\x07example\x03com\x00'+struct.pack('!HH',1,1)
results.append(exchange('Application DNS via proxy','172.19.0.2',53,query,udp=True,exact=False))
raise SystemExit(0 if all(results) else 1)
