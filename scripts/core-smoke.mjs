// Run against Hafen Debug apps already connected to Metro; no real nodes required.
import WebSocket from "ws";
const port = Number(process.env.HAFEN_METRO_PORT || 8093);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid HAFEN_METRO_PORT");
const metro = `http://127.0.0.1:${port}`;
const targets = await (await fetch(`${metro}/json/list`)).json();
if (targets.length === 0) throw Error("No Hafen debugger target");
for (const target of targets) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { origin: metro });
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let serial = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    const p = pending.get(response.id);
    if (p) {
      pending.delete(response.id);
      p(response);
    }
  };
  async function evaluateRaw(expression) {
    const id = ++serial;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      })
    );
    const result = await Promise.race([
      reply,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("CDP timeout")), 15000).unref()
      ),
    ]);
    if (result.error || result.result?.exceptionDetails)
      throw Error(JSON.stringify(result));
    return result.result.result.value;
  }
  async function evaluate(expression) {
    const key = "__hafenSmokeResult_" + process.pid + "_" + serial;
    await evaluateRaw(
      `Promise.resolve().then(()=>(${expression})).then(value=>{globalThis[${JSON.stringify(
        key
      )}]={ok:true,value}},error=>{globalThis[${JSON.stringify(
        key
      )}]={ok:false,code:error.code,error:String(error)}});undefined`
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const json = await evaluateRaw(
        `JSON.stringify(globalThis[${JSON.stringify(key)}])`
      );
      if (json) {
        const result = JSON.parse(json);
        await evaluateRaw(`delete globalThis[${JSON.stringify(key)}]`);
        if (!result.ok) throw Error(JSON.stringify(result));
        return result.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Async native operation timed out");
  }
  const moduleId = (
    await evaluate(
      "Array.from(__r.getModules()).filter(([id,m]) => (m.verboseName || '').includes('NativeHafenPlatform')).map(([id])=>id)"
    )
  )[0];
  if (moduleId === undefined) throw Error("Native module not in bundle");
  const environment = JSON.parse(
    await evaluate(`__r(${moduleId}).default.getEnvironment()`)
  );
  const platform = environment.platform;
  if (
    environment.coreAvailable !== true ||
    environment.core.version !== "1.14.4" ||
    environment.core.tunnelAvailable !== false
  )
    throw Error("Unexpected linked core: " + JSON.stringify(environment));
  const result = await evaluate(`(async()=>{
  const b=__r(${moduleId}).default;
  await b.checkCoreProfile(JSON.stringify({type:'shadowsocks',server:'example.com',server_port:443,method:'aes-128-gcm',password:'test-only'}));
  await b.checkCoreProfile(JSON.stringify({type:'trojan',server:'example.com',server_port:443,password:'test-only'}));
  await b.checkCoreProfile(JSON.stringify({type:'vless',server:'example.com',server_port:443,uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
  try { await b.checkCoreProfile(JSON.stringify({type:'trojan',server:'example.com',server_port:443,password:'SECRET',insecure:true})); throw Error('unsafe profile accepted'); }
  catch(e){if(e.code!=='INVALID_CORE_PROFILE' || String(e).includes('SECRET')) throw Error('unsafe error contract: '+e.code);}
  const vless={type:'vless',server:'example.com',server_port:443,server_name:'example.com',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  for(const profile of [
    {...vless,transport:{type:'ws',path:'/tunnel',headers:{Host:'cdn.example.com'}}},
    {...vless,transport:{type:'grpc',service_name:'Hafen'}},
    {...vless,flow:'xtls-rprx-vision'},
    {...vless,flow:'xtls-rprx-vision',fingerprint:'chrome',reality:{public_key:'CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',short_id:'abcd'}},
  ])await b.checkCoreProfile(JSON.stringify(profile));
  await b.checkCoreProfile(JSON.stringify({type:'hysteria2',server:'example.com',server_port:443,password:'test-only',obfs:{type:'salamander',password:'test-obfs'},up_mbps:10,down_mbps:20}));
  const results=[];
  for(let i=0;i<3;i++){const r=JSON.parse(await b.runCoreSelfTest());if(r.ok!==true || r.vpnConnected!==false)throw Error('bad self test');results.push(r);}
  return {profiles:8,unsafeInputRejected:true,selfTests:results};
 })()`);
  console.log(platform, JSON.stringify({ environment, result }));

  ws.close();
}
