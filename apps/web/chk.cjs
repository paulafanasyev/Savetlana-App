require("/workspace/project/apps/web/src/lib/ai/tools");
const { toolRegistry } = require("/workspace/project/apps/web/src/lib/ai/tools");
(async () => {
  const t = toolRegistry.get("vision_search");
  console.log("vision_search registered:", !!t);
  if (t) {
    const r = await t.execute({ userId: null, traceId: "t1", role: "BUYER" }, { label: "смартфон", limit: 3 });
    console.log("ok:", r.ok, "| ver:", r.verification);
    console.log("summary:", r.summary);
  }
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
