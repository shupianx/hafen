// Real native storage/bridge tests; uses only synthetic credentials.
import WebSocket from "ws";
import { readFile, writeFile, rm } from "node:fs/promises";
const action = process.argv[2] || "seed";
if (!["seed", "verify", "download", "connect", "disconnect", "selection-seed", "selection-verify"].includes(action))
  throw Error("Use seed|verify|download|connect|disconnect|selection-seed|selection-verify");
if (action === "connect" && !process.env.HAFEN_TEST_PROFILE)
  throw Error("Set HAFEN_TEST_PROFILE to the local emulator fixture profile");
const fixture =
  action === "connect"
    ? await readFile(process.env.HAFEN_TEST_PROFILE, "utf8")
    : null;
const switchFixture = process.env.HAFEN_TEST_SWITCH === "1";
if (switchFixture && fixture && JSON.parse(fixture).type !== "shadowsocks")
  throw Error("The two-endpoint switch fixture requires Shadowsocks");
const port = Number(process.env.HAFEN_METRO_PORT || 8093);
const metro = `http://127.0.0.1:${port}`;
const all = await (await fetch(`${metro}/json/list`)).json();
const targets = all.filter(
  (t) =>
    process.env.HAFEN_TEST_APP ? t.appId === process.env.HAFEN_TEST_APP :
      ["com.hafen", "org.reactjs.native.example.Hafen"].includes(t.appId)
);
if (!targets.length) throw Error("No Hafen Debug target");
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
    for (let attempt = 0; attempt < 300; attempt++) {
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
  const b = `__r(${moduleId}).default`;
  const statePath = `/private/tmp/hafen-subscription-smoke-${target.appId}.json`;
  try {
    if (action === "selection-seed") {
      const result = await evaluate(`(async()=>{
        const b=${b};
        const check=(v,m)=>{if(!v)throw Error(m)};
        check(await b.getSelectedNode()==='null','Use a fresh isolated app; existing selection must not be overwritten');
        const a=JSON.parse(await b.saveSubscription('Selection fixture A','https://example.invalid/selection-a/'+Date.now()));
        const saved=JSON.parse(await b.saveSubscription('Selection fixture B','https://example.invalid/selection-b/'+Date.now()));
        try {
          const profile={type:'shadowsocks',tag:'Selected B',server:'192.0.2.1',server_port:443,method:'aes-128-gcm',password:'synthetic-selection-secret'};
          const content=JSON.stringify({outbounds:[profile]});
          const first=JSON.parse(await b.importSubscription(a.id,content));
          await b.selectSubscriptionNode(a.id,first.revision,first.nodes[0].id);
          const next=JSON.parse(await b.importSubscription(saved.id,content));
          const selection=JSON.parse(await b.selectSubscriptionNode(saved.id,next.revision,next.nodes[0].id));
          check(!JSON.stringify(selection).includes('secret') && !JSON.stringify(selection).includes('profile'),'credential escaped');
          await b.deleteSubscription(a.id);
          check(JSON.parse(await b.getSelectedNode()).subscriptionId===saved.id,'deleting another subscription cleared selection');
          await b.listSubscriptionNodes(saved.id);
          check(JSON.parse(await b.getSelectedNode()).nodeId===selection.nodeId,'browsing cleared selection');
          const updated=JSON.parse(await b.importSubscription(saved.id,JSON.stringify({outbounds:[profile,{...profile,tag:'Replacement',server:'192.0.2.2'}]})));
          const current=JSON.parse(await b.getSelectedNode());
          check(current.nodeId===selection.nodeId && current.revision===updated.revision,'update lost stable node or revision');
          try {await b.selectSubscriptionNode(saved.id,'0'.repeat(64),selection.nodeId);throw Error('stale accepted')}catch(e){check(e.code==='STALE_SUBSCRIPTION','wrong stale error')}
          const afterStale=JSON.parse(await b.getSelectedNode());
          check(Object.keys(current).every(k=>afterStale[k]===current[k]),'stale selection changed saved value');
          return {id:saved.id,selection:current,selectedBeforeConnect:true,unrelatedDeletePreserved:true,updatePreserved:true,staleRejected:true};
        } catch(e) {await b.deleteSubscription(a.id);await b.deleteSubscription(saved.id);throw e}
      })()`);
      await writeFile(statePath+'.selection',JSON.stringify(result),{mode:0o600});
      console.log(target.appId,action,JSON.stringify(result));
    } else if (action === "selection-verify") {
      const saved=JSON.parse(await readFile(statePath+'.selection','utf8'));
      const result=await evaluate(`(async()=>{
        const b=${b},saved=${JSON.stringify(saved)};
        const check=(v,m)=>{if(!v)throw Error(m)};
        const current=JSON.parse(await b.getSelectedNode());
        check(current && Object.keys(saved.selection).every(k=>current[k]===saved.selection[k]),'selection missing after restart');
        const profile={type:'shadowsocks',tag:'Replacement',server:'192.0.2.2',server_port:443,method:'aes-128-gcm',password:'synthetic-selection-secret'};
        const next=JSON.parse(await b.importSubscription(saved.id,JSON.stringify({outbounds:[profile]})));
        check(await b.getSelectedNode()==='null','removed node remained selected');
        await b.selectSubscriptionNode(saved.id,next.revision,next.nodes[0].id);
        await b.deleteSubscription(saved.id);
        check(await b.getSelectedNode()==='null','deleted subscription remained selected');
        return {persistedAfterRestart:true,removedNodeCleared:true,deletedSubscriptionCleared:true};
      })()`);
      await rm(statePath+'.selection');
      console.log(target.appId,action,JSON.stringify(result));
    } else if (["connect", "disconnect"].includes(action)) {
      if (target.appId !== "com.hafen") continue;
      const path = statePath + ".vpn";
      if (action === "connect") {
        const result = await evaluate(`(async()=>{
          const b=${b}, profile=JSON.parse(${JSON.stringify(fixture)});
          const check=(v,m)=>{if(!v)throw Error(m)};
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          check(JSON.parse(await b.getVpnState()).state==='disconnected','existing VPN must be stopped first');
          const previousSelection=JSON.parse(await b.getSelectedNode());
          const record=JSON.parse(await b.saveSubscription('VPN subscription fixture','https://example.invalid/fixture/'+Date.now()));
          try {
            const outbound={...profile,tag:${JSON.stringify(switchFixture ? "Switch A" : "Local subscription fixture")}};
            for(const key of ['server_name','fingerprint','alpn','reality']) delete outbound[key];
            if(profile.type!=='shadowsocks'){
              outbound.tls={enabled:true,server_name:profile.server_name||profile.server};
              if(profile.fingerprint)outbound.tls.utls={enabled:true,fingerprint:profile.fingerprint};
              if(profile.alpn)outbound.tls.alpn=profile.alpn;
              if(profile.reality)outbound.tls.reality={enabled:true,...profile.reality};
            }
            const outbounds=${switchFixture} ? [outbound,{...outbound,tag:'Switch B',server_port:29393}] : [outbound];
            const nodes=JSON.parse(await b.importSubscription(record.id,JSON.stringify({outbounds})));
            const args=[record.id,nodes.revision,nodes.nodes[0].id];
            check(await b.prepareVpn(),'permission required');
            const race=await Promise.allSettled([b.startSubscriptionNode(...args),b.stopVpn()]);
            await wait(700);
            check(JSON.parse(await b.getVpnState()).state==='disconnected','cancelled queued start left VPN running');
            const state=JSON.parse(await b.startSubscriptionNode(...args));
            check(state.state==='connected','node connection failed');
            return {id:record.id,previousSelection,fromStoredNode:true,cancelledStartCleaned:true,state:state.state,race:race.map(r=>({status:r.status,code:r.reason?.code}))};
          } catch(e) {
            await b.stopVpn();await b.deleteSubscription(record.id);
            if(previousSelection)await b.selectSubscriptionNode(previousSelection.subscriptionId,previousSelection.revision,previousSelection.nodeId);
            throw e;
          }
        })()`);
        await writeFile(path, JSON.stringify(result), { mode: 0o600 });
        console.log(target.appId, action, JSON.stringify(result));
      } else {
        const saved = JSON.parse(await readFile(path, "utf8"));
        const result = await evaluate(`(async()=>{
          const b=${b};await b.stopVpn();await b.deleteSubscription(${JSON.stringify(
          saved.id
        )});
          const previous=${JSON.stringify(saved.previousSelection ?? null)};
          if(previous)await b.selectSubscriptionNode(previous.subscriptionId,previous.revision,previous.nodeId);
          return JSON.parse(await b.getVpnState());
        })()`);
        await rm(path);
        console.log(target.appId, action, JSON.stringify(result));
      }
    } else if (action === "download") {
      // Public upstream documentation sample, never a commercial subscription.
      const result = await evaluate(`(async()=>{
        const b=${b};
        const record=JSON.parse(await b.saveSubscription('Public example download test','https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/docs/config.yaml'));
        try {
          const result=JSON.parse(await b.refreshSubscription(record.id));
          if(result.format!=='clash'||result.nodes.length<1)throw Error('download did not produce nodes');
          return {httpsDownload:true,format:result.format,nodes:result.nodes.length,skipped:result.skipped};
        } finally {await b.deleteSubscription(record.id);}
      })()`);
      console.log(target.appId, action, JSON.stringify(result));
    } else if (action === "seed") {
      const result = await evaluate(`(async()=>{
        const b=${b};
        const check=(v,m)=>{if(!v)throw Error(m)};
        const reject=async(f,code)=>{try{await f();throw Error('unexpected success')}catch(e){check(e.code===code,'wrong error code: '+e.code)}};
        const saved=JSON.parse(await b.saveSubscription('Subscription smoke', 'https://example.com/?hafen-test='+Date.now()));
        const id=saved.id;
        try {
          check(await b.listSubscriptionNodes(id)==='null','new subscription not empty');
          const profile={type:'shadowsocks',tag:'Test SS',server:'192.0.2.1',server_port:443,method:'aes-128-gcm',password:'synthetic-test-secret'};
          const initial=JSON.parse(await b.importSubscription(id,JSON.stringify({outbounds:[profile]})));
          check(initial.nodes.length===1,'import count');
          check(!JSON.stringify(initial).includes('synthetic-test-secret') && !JSON.stringify(initial).includes('profile'),'credential leak');
          await reject(()=>b.importSubscription(id,'<html>error</html>'),'INVALID_SUBSCRIPTION_CONTENT');
          check(JSON.parse(await b.listSubscriptionNodes(id)).revision===initial.revision,'bad import overwrote cache');
          let downloadError='';try{await b.refreshSubscription(id);throw Error('HTML accepted')}catch(e){downloadError=e.code;check(['INVALID_SUBSCRIPTION_CONTENT','SUBSCRIPTION_HTTP_ERROR','SUBSCRIPTION_DOWNLOAD_FAILED','SUBSCRIPTION_TIMEOUT'].includes(e.code),'wrong download error')}
          check(JSON.parse(await b.listSubscriptionNodes(id)).revision===initial.revision,'failed download overwrote cache');
          const domain={...profile,tag:'Domain uses encrypted bootstrap',server:'example.com'};
          const next=JSON.parse(await b.importSubscription(id,JSON.stringify({outbounds:[{...profile,tag:'Updated SS'},domain,{type:'vmess',tag:'Unsupported'}]})));
          check(next.nodes.length===2 && next.skipped===1,'mixed list');
          await reject(()=>b.startSubscriptionNode(id,initial.revision,initial.nodes[0].id),'STALE_SUBSCRIPTION');
          check(next.nodes.every(n=>n.blockedReason===''),'domain node remained blocked');
          return {id,revision:next.revision,nodes:2,failedImportPreserved:true,failedDownloadPreserved:true,downloadError,staleSelectionRejected:true,domainSelectable:true};
        } catch(e) {await b.deleteSubscription(id);throw e;}
      })()`);
      await writeFile(statePath, JSON.stringify(result), { mode: 0o600 });
      console.log(target.appId, action, JSON.stringify(result));
    } else {
      const saved = JSON.parse(await readFile(statePath, "utf8"));
      const result = await evaluate(`(async()=>{
        const b=${b}, saved=${JSON.stringify(saved)};
        const next=JSON.parse(await b.listSubscriptionNodes(saved.id));
        if(next.revision!==saved.revision || next.nodes.length!==saved.nodes) throw Error('persisted nodes mismatch');
        await b.deleteSubscription(saved.id);await b.deleteSubscription(saved.id);
        if(JSON.parse(await b.listSubscriptions()).some(s=>s.id===saved.id))throw Error('delete failed');
        try{await b.listSubscriptionNodes(saved.id);throw Error('deleted nodes accessible')}catch(e){if(e.code!=='INVALID_SUBSCRIPTION')throw e}
        return {persistedAfterRestart:true,deleteRemovedNodes:true};
      })()`);
      await rm(statePath);
      console.log(target.appId, action, JSON.stringify(result));
    }
  } finally {
    ws.close();
  }
}
