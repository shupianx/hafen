// Run against Hafen Debug apps already connected to Metro; no real nodes required.
import WebSocket from "ws";
import { readFile } from "node:fs/promises";
const action = process.argv[2] || "state";
if (["start", "lifecycle"].includes(action) && !process.env.HAFEN_TEST_PROFILE)
  throw Error("Set HAFEN_TEST_PROFILE to the local fixture JSON file");
const profile = ["start", "lifecycle"].includes(action)
  ? await readFile(process.env.HAFEN_TEST_PROFILE || "", "utf8")
  : null;
const port = Number(process.env.HAFEN_METRO_PORT || 8093);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid HAFEN_METRO_PORT");
const metro = `http://127.0.0.1:${port}`;
const targets = await (await fetch(`${metro}/json/list`)).json();
if (!targets.some((t) => t.appId === "com.hafen"))
  throw Error("No Hafen Android Debug target on this Metro port");
for (const target of targets.filter((t) => t.appId === "com.hafen")) {
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
    for (let attempt = 0; attempt < 450; attempt++) {
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
  if (platform !== "android") {
    ws.close();
    continue;
  }
  let result;
  if (action === "state")
    result = await evaluate(`__r(${moduleId}).default.getVpnState()`);
  else if (action === "prepare")
    result = await evaluate(`__r(${moduleId}).default.prepareVpn()`);
  else if (action === "start")
    result = await evaluate(
      `__r(${moduleId}).default.startVpn(${JSON.stringify(profile)})`
    );
  else if (action === "stop")
    result = await evaluate(`__r(${moduleId}).default.stopVpn()`);
  else if (action === "lifecycle")
    result = await evaluate(`(async()=>{
    const b=__r(${moduleId}).default;
    const profile=${JSON.stringify(profile)};
    const state=async()=>JSON.parse(await b.getVpnState());
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(v,m)=>{if(!v)throw Error(m)};
    await b.stopVpn();await wait(500);
    const first=JSON.parse(await b.startVpn(profile));check(first.state==='connected','first start failed');
    try{await b.startVpn(profile);throw Error('duplicate start accepted')}catch(e){check(e.code==='OPERATION_IN_PROGRESS','wrong duplicate code')}
    await b.stopVpn();await b.stopVpn();await wait(500);
    check((await state()).state==='disconnected','stop not complete');
    const race=await Promise.allSettled([b.startVpn(profile),b.stopVpn()]);
    await wait(700);check((await state()).state==='disconnected','cancelled start left a tunnel');
    const bad=JSON.stringify({...JSON.parse(profile),server:'https://invalid.example'});
    try{await b.startVpn(bad);throw Error('invalid endpoint accepted')}catch(e){check(e.code==='INVALID_CORE_PROFILE','wrong profile error')}
    await wait(500);check((await state()).state==='disconnected','failed start left a tunnel');
    await b.startVpn(profile);await b.stopVpn();await wait(500);
    return {duplicateStartRejected:true,idempotentStop:true,cancelledStartCleaned:true,invalidProfileCleaned:true,reconnectSucceeded:true,final:await state(),race:race.map(r=>({status:r.status,code:r.reason?.code}))};
  })()`);
  else throw Error("Use state|prepare|start|stop|lifecycle");
  console.log(platform, action, result);
  ws.close();
}
