// Runs in Worker context
self.addEventListener("message", async (e)=>{
  const { code, ctx, msgId } = e.data;
  try{
    // Build an async function with the user's code as body.
    // eslint-disable-next-line no-new-func
    const fn = new Function("ctx", `"use strict"; return (async () => { ${code} })();`);
    const res = await fn(ctx);
    self.postMessage({ msgId, ok:true, result: res });
  }catch(err){
    self.postMessage({ msgId, ok:false, error: String(err && err.message || err) });
  }
});