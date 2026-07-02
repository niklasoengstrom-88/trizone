/* TRIZONE core.test.mjs — vaktar kärnlogiken (rollup / computeFlags / computeGoodFlags / pickFocus).
   Körs med:  node core.test.mjs   (från repo-roten, bredvid index.html)
   Ingår i DoD per deploy tillsammans med node --check.

   Metod: extraherar funktionerna ur index.html vid körning (namnbaserad extraktion med
   klammerbalansering — tål radnummerändringar). Kör dem i en vm-sandbox med fryst datum
   (2026-07-02) och syntetiska fixtures. Inga DOM- eller nätverksberoenden.

   OBS extraktionens gräns: klammerräkningen antar att extraherade funktioner inte innehåller
   OBALANSERADE { } inuti strängar. Balanserade (t.ex. regex-kvantifierare {4}) är ofarliga. */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

/* ---------- extraktion ---------- */
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const mScript = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(mScript, "hittar inget <script>-block i index.html");
const js = mScript[1];

function grabFn(name){
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "hittar inte function " + name);
  const start = js.indexOf("{", i);
  let depth = 0, j = start;
  for (; j < js.length; j++){
    if (js[j] === "{") depth++;
    else if (js[j] === "}"){ depth--; if (depth === 0){ j++; break; } }
  }
  return js.slice(i, j);
}
function grabConst(name){
  const m = js.match(new RegExp("^const " + name + "=.*$", "m"));
  assert.ok(m, "hittar inte const " + name);
  return m[0];
}

const pieces = [
  grabConst("DAY"), grabConst("CAP_G"), grabConst("DIMS"), grabConst("DIM_RANK"), grabConst("actDate"),
  grabFn("pd"), grabFn("iso"), grabFn("today"), grabFn("addDays"), grabFn("dfmt"), grabFn("n1"),
  grabFn("sportOf"), grabFn("zones"), grabFn("currentPhase"), grabFn("nextMilestone"),
  grabFn("computeRecovery"), grabFn("raceCategoryKey"), grabFn("postraceDays"),
  grabFn("pauseInfo"), grabFn("dampenFlags"), grabConst("PUSH_KEYS"),
  grabFn("computeFlags"), grabFn("computeGoodFlags"), grabFn("rollup"), grabFn("pickFocus"),
  /* fryst 'idag' för deterministiska tester */
  'today = function(){ return new Date(2026, 6, 2); };',
  'globalThis.core = { computeFlags, computeGoodFlags, rollup, pickFocus, nextMilestone, pauseInfo, dampenFlags };'
].join("\n");

const ctx = { console };
vm.createContext(ctx);
new vm.Script(pieces, { filename: "extraherad-kärna.js" }).runInContext(ctx);
const { computeFlags, computeGoodFlags, rollup, pickFocus, pauseInfo, dampenFlags } = ctx.core;

/* ---------- fixtures ---------- */
const T = new Date(2026, 6, 2);                       // matchar fryst today()
const d = (offset) => new Date(T.getTime() + offset * 86400000);
const isoD = (dt) => dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");

const phase = { name: "Peak", start: d(-30), end: d(30), target: 75 };
const planFx = { phases: [phase] };
const noPlan = { phases: [] };
const week = (over = {}) => ({ vol: { swim: 0, bike: 0, run: 1, strength: 0, other: 0 },
  km: { swim: 0, bike: 0, run: 10 }, caps: { swim: null, bike: null, run: null }, ...over });

let n = 0, fail = 0;
function t(name, fn){
  n++;
  try { fn(); console.log("  ✓ " + name); }
  catch (e){ fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}

/* ---------- rollup ---------- */
console.log("rollup");
t("tomt → alla dimensioner ok, overall ok", () => {
  const r = rollup([]);
  assert.equal(r.overall, "ok");
  for (const k of ["load", "intensity", "recovery", "plan"]) assert.equal(r.dims[k], "ok");
});
t("risk i load → load=risk, overall=risk, övriga ok", () => {
  const r = rollup([{ dim: "load", lv: "risk" }]);
  assert.equal(r.dims.load, "risk"); assert.equal(r.overall, "risk"); assert.equal(r.dims.plan, "ok");
});
t("warn slår good i samma dimension", () => {
  const r = rollup([{ dim: "intensity", lv: "good" }, { dim: "intensity", lv: "warn" }]);
  assert.equal(r.dims.intensity, "warn"); assert.equal(r.overall, "warn");
});
t("enbart good → dimension good, overall good", () => {
  const r = rollup([{ dim: "plan", lv: "good" }]);
  assert.equal(r.dims.plan, "good"); assert.equal(r.overall, "good");
});
t("okänd dimension ignoreras", () => {
  const r = rollup([{ dim: "styrka", lv: "risk" }]);
  assert.equal(r.overall, "ok");
});

/* ---------- pickFocus (prioritetsstegen) ---------- */
console.log("pickFocus");
const msUrgent = { desc: "OW-pass", gren: "swim", status: "", plan: d(3), done: null };
const msFar    = { desc: "Testlopp", gren: "run", status: "", plan: d(20), done: null };
const fRisk = { key: "cap-run", lv: "risk", dim: "load" };
const fWarn = { key: "rhr", lv: "warn", dim: "recovery" };

t("akut delmål (≤10 dgr) slår risk-flagga", () => {
  const f = pickFocus(planFx, [fRisk], [msUrgent]);
  assert.equal(f.kind, "ms"); assert.equal(f.m.desc, "OW-pass"); assert.equal(f.excludeKey, "milestone-risk");
});
t("risk-flagga när inget akut delmål", () => {
  const f = pickFocus(planFx, [fRisk, fWarn], [msFar]);
  assert.equal(f.kind, "flag"); assert.equal(f.flag.key, "cap-run"); assert.equal(f.excludeKey, "cap-run");
});
t("nästa delmål (>10 dgr) slår warn-flagga", () => {
  const f = pickFocus(planFx, [fWarn], [msFar]);
  assert.equal(f.kind, "ms"); assert.equal(f.m.desc, "Testlopp");
});
t("warn-flagga när inga delmål finns", () => {
  const f = pickFocus(planFx, [fWarn], []);
  assert.equal(f.kind, "flag"); assert.equal(f.flag.key, "rhr");
});
t("ingenting → calm", () => {
  const f = pickFocus(planFx, [], []);
  assert.equal(f.kind, "calm");
});
t("avklarat delmål räknas aldrig som akut", () => {
  const f = pickFocus(planFx, [], [{ ...msUrgent, status: "done" }]);
  assert.equal(f.kind, "calm");
});

/* ---------- computeFlags ---------- */
console.log("computeFlags");
const key = (flags, k) => flags.find(f => f.key === k);
const swimAct = (daysAgo) => ({ type: "Swim", start_date_local: isoD(d(-daysAgo)), moving_time: 1800 });
const baseData = () => ({ activities: [swimAct(2)], wellness: [] });

t("volym över tak → cap-run risk", () => {
  ctx.data = baseData();
  const flags = computeFlags([week({ caps: { swim: null, bike: null, run: 20 }, km: { swim: 0, bike: 0, run: 25 } })], noPlan, null, []);
  const f = key(flags, "cap-run");
  assert.ok(f, "cap-run saknas"); assert.equal(f.lv, "risk"); assert.equal(f.dim, "load");
});
t("tak avstängt (null) → ingen cap-flagga", () => {
  ctx.data = baseData();
  const flags = computeFlags([week({ km: { swim: 0, bike: 0, run: 999 } })], noPlan, null, []);
  assert.ok(!key(flags, "cap-run"));
});
t("8 dagar sedan sim → swim-gap risk; 2 dagar → ingen", () => {
  ctx.data = { activities: [swimAct(8)], wellness: [] };
  assert.ok(key(computeFlags([week()], noPlan, null, []), "swim-gap"));
  ctx.data = baseData();
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "swim-gap"));
});
t("tom aktivitetslista → ingen swim-gap (guard)", () => {
  ctx.data = { activities: [], wellness: [] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "swim-gap"));
});
t("delmål inom 7 dgr utan done → milestone-risk warn", () => {
  ctx.data = baseData();
  const flags = computeFlags([week()], noPlan, null, [{ desc: "Bricka", status: "", plan: d(5), done: null }]);
  const f = key(flags, "milestone-risk");
  assert.ok(f); assert.equal(f.lv, "warn"); assert.equal(f.dim, "plan");
});
t("intensitet: 60 % mot mål 75 → intensity-high; 90 % → intensity-low; 80 % → ingen", () => {
  ctx.data = baseData();
  assert.ok(key(computeFlags([week()], planFx, { loPct: 60 }, []), "intensity-high"));
  assert.ok(key(computeFlags([week()], planFx, { loPct: 90 }, []), "intensity-low"));
  const inside = computeFlags([week()], planFx, { loPct: 80 }, []);
  assert.ok(!key(inside, "intensity-high") && !key(inside, "intensity-low"));
});
t("3 pass med ≥20 min Z4+ på 5 dagar → hard-freq warn", () => {
  const hard = (daysAgo) => ({ type: "Run", start_date_local: isoD(d(-daysAgo)), icu_hr_zone_times: [0, 0, 0, 1300] });
  ctx.data = { activities: [swimAct(1), hard(1), hard(2), hard(4)], wellness: [] };
  const f = key(computeFlags([week()], noPlan, null, []), "hard-freq");
  assert.ok(f); assert.equal(f.lv, "warn");
});
t("två hårda pass → ingen hard-freq", () => {
  const hard = (daysAgo) => ({ type: "Run", start_date_local: isoD(d(-daysAgo)), icu_hr_zone_times: [0, 0, 0, 1300] });
  ctx.data = { activities: [swimAct(1), hard(1), hard(3)], wellness: [] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "hard-freq"));
});
t("vilopuls +8 slag över 30-dagarsbas → rhr warn; +2 → ingen", () => {
  const w = (daysAgo, v) => ({ id: isoD(d(-daysAgo)), restingHR: v });
  const base = []; for (let i = 8; i <= 37; i++) base.push(w(i, 50));
  ctx.data = { activities: [swimAct(1)], wellness: [...base, w(1, 58), w(2, 58), w(3, 58), w(4, 58), w(5, 58)] };
  assert.ok(key(computeFlags([week()], noPlan, null, []), "rhr"));
  ctx.data = { activities: [swimAct(1)], wellness: [...base, w(1, 52), w(2, 52), w(3, 52), w(4, 52), w(5, 52)] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "rhr"));
});

/* ---------- computeGoodFlags ---------- */
console.log("computeGoodFlags");
t("intensitet i fas → intensity-ok (när dimensionen inte redan flaggats)", () => {
  ctx.data = baseData();
  const g = computeGoodFlags([week()], planFx, { loPct: 78 }, []);
  assert.ok(key(g, "intensity-ok"));
});
t("intensity-ok undertrycks när dimensionen har problemflagga", () => {
  ctx.data = baseData();
  const g = computeGoodFlags([week()], planFx, { loPct: 78 }, [{ key: "intensity-high", lv: "warn", dim: "intensity" }]);
  assert.ok(!key(g, "intensity-ok"));
});
t("5 tränade veckor i rad → streak-flagga", () => {
  ctx.data = baseData();
  const wks = Array.from({ length: 5 }, () => week());
  const g = computeGoodFlags(wks, noPlan, null, []);
  const f = key(g, "streak");
  assert.ok(f); assert.ok(f.t.includes("5"));
});
t("tom pågående vecka bryter inte streaken (hoppas över)", () => {
  ctx.data = baseData();
  const wks = [week(), week(), week(), week(), week({ vol: { swim: 0, bike: 0, run: 0, strength: 0, other: 0 } })];
  assert.ok(key(computeGoodFlags(wks, noPlan, null, []), "streak"));
});

/* ---------- v21: styrke-gap + taper-vakt ---------- */
console.log("styrke-gap (v21)");
const strengthAct = (daysAgo) => ({ type: "WeightTraining", start_date_local: isoD(d(-daysAgo)), moving_time: 2400 });
const planRaceIn = (days, cat) => ({ phases: [phase], races: [], race: { name: "Race", date: d(days), cat } });

t("12 dagar sedan styrka → strength-gap warn (dim plan)", () => {
  ctx.data = { activities: [swimAct(2), strengthAct(12)], wellness: [] };
  const f = key(computeFlags([week()], noPlan, null, []), "strength-gap");
  assert.ok(f); assert.equal(f.lv, "warn"); assert.equal(f.dim, "plan");
});
t("5 dagar sedan styrka → ingen flagga", () => {
  ctx.data = { activities: [swimAct(2), strengthAct(5)], wellness: [] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "strength-gap"));
});
t("inget styrkepass alls i datan → flagga", () => {
  ctx.data = baseData();
  assert.ok(key(computeFlags([week()], noPlan, null, []), "strength-gap"));
});
t("taper-vakt: race om 7 dgr → tyst trots 12 dagars gap", () => {
  ctx.data = { activities: [swimAct(2), strengthAct(12)], wellness: [] };
  assert.ok(!key(computeFlags([week()], planRaceIn(7, "Olympisk distans"), null, []), "strength-gap"));
});
t("race om 15 dgr → vakten släpper, flaggan fyrar", () => {
  ctx.data = { activities: [swimAct(2), strengthAct(12)], wellness: [] };
  assert.ok(key(computeFlags([week()], planRaceIn(15, "Olympisk distans"), null, []), "strength-gap"));
});

/* ---------- v21: sömn/HRV → flagglagret ---------- */
console.log("sömn/HRV (v21)");
const wSleep = (daysAgo, hours) => ({ id: isoD(d(-daysAgo)), sleepSecs: hours * 3600 });
const wHrv   = (daysAgo, v) => ({ id: isoD(d(-daysAgo)), hrv: v });

t("3 nätter à 5,5 h → sleep warn (dim recovery)", () => {
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [wSleep(3, 5.5), wSleep(2, 5.5), wSleep(1, 5.5)] };
  const f = key(computeFlags([week()], noPlan, null, []), "sleep");
  assert.ok(f); assert.equal(f.dim, "recovery");
});
t("3 nätter à 7,5 h → ingen sömnflagga", () => {
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [wSleep(3, 7.5), wSleep(2, 7.5), wSleep(1, 7.5)] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "sleep"));
});
t("HRV 40 mot baslinje ~50 → hrv warn; HRV vid baslinje → ingen", () => {
  const base = []; for (let i = 2; i <= 9; i++) base.push(wHrv(i, 50));
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [...base, wHrv(1, 40)] };
  assert.ok(key(computeFlags([week()], noPlan, null, []), "hrv"));
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [...base, wHrv(1, 50)] };
  assert.ok(!key(computeFlags([week()], noPlan, null, []), "hrv"));
});
t("intensity-low undertrycks när sömnen varnar (appen motsäger inte sig själv)", () => {
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [wSleep(3, 5.5), wSleep(2, 5.5), wSleep(1, 5.5)] };
  assert.ok(!key(computeFlags([week()], planFx, { loPct: 90 }, []), "intensity-low"));
  ctx.data = { activities: [swimAct(1), strengthAct(2)], wellness: [wSleep(3, 7.5), wSleep(2, 7.5), wSleep(1, 7.5)] };
  assert.ok(key(computeFlags([week()], planFx, { loPct: 90 }, []), "intensity-low"));
});

/* ---------- v21: pausläge ---------- */
console.log("pausläge (v21)");
const planPast = (daysAgo, cat) => ({ phases: [phase], race: null,
  races: [{ name: "Holmsjö Triathlon", date: d(-daysAgo), cat }] });

t("manuell paus lagrad → kind manual", () => {
  const p = pauseInfo(planFx, { on: true, since: isoD(T) }, T);
  assert.ok(p); assert.equal(p.kind, "manual");
});
t("race för 2 dgr sedan (olympisk) → postrace till race+7", () => {
  const p = pauseInfo(planPast(2, "Olympisk distans"), {}, T);
  assert.ok(p); assert.equal(p.kind, "postrace");
  assert.equal(isoD(p.until), isoD(d(5)));
});
t("race för 8 dgr sedan (olympisk) → fönstret stängt, ingen paus", () => {
  assert.equal(pauseInfo(planPast(8, "Olympisk distans"), {}, T), null);
});
t("race för 8 dgr sedan (70.3) → 10-dagarsfönster, fortfarande postrace", () => {
  const p = pauseInfo(planPast(8, "70.3"), {}, T);
  assert.ok(p); assert.equal(p.kind, "postrace");
});
t("avfärdad postrace (dismissed) → ingen paus", () => {
  assert.equal(pauseInfo(planPast(2, "Olympisk distans"), { dismissed: isoD(d(-2)) }, T), null);
});
t("dampenFlags: pufflaggor bort, vakter kvar", () => {
  const fx = [
    { key: "swim-gap", lv: "risk", dim: "plan" }, { key: "strength-gap", lv: "warn", dim: "plan" },
    { key: "milestone-risk", lv: "warn", dim: "plan" }, { key: "intensity-low", lv: "warn", dim: "intensity" },
    { key: "rhr", lv: "warn", dim: "recovery" }, { key: "cap-run", lv: "risk", dim: "load", matter: "Snabba volymhopp." }
  ];
  const out = dampenFlags(fx, { kind: "manual" }, {}, T);
  assert.deepEqual(out.map(f => f.key).sort(), ["cap-run", "rhr"]);
});
t("dampenFlags: passthrough utan paus", () => {
  const fx = [{ key: "swim-gap", lv: "risk", dim: "plan" }];
  assert.deepEqual(dampenFlags(fx, null, {}, T), fx);
});
t("comeback: paus avslutad för 5 dgr sedan → cap-flaggans copy nämner uppehållet", () => {
  const fx = [{ key: "cap-run", lv: "risk", dim: "load", matter: "Snabba volymhopp." }];
  const out = dampenFlags(fx, null, { ended: isoD(d(-5)) }, T);
  assert.ok(out[0].matter.includes("uppehåll"));
});
t("comeback-copyn klingar av efter 14 dagar", () => {
  const fx = [{ key: "cap-run", lv: "risk", dim: "load", matter: "Snabba volymhopp." }];
  const out = dampenFlags(fx, null, { ended: isoD(d(-20)) }, T);
  assert.ok(!out[0].matter.includes("uppehåll"));
});

/* ---------- deploy-vakt: versionsparitet index ↔ sw ---------- */
console.log("deploy-vakt");
t("BUILD-version i index.html matchar CACHE-version i sw.js", () => {
  const b = html.match(/const BUILD="v(\d+)/);
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const c = sw.match(/const CACHE = "trizone-v(\d+)"/);
  assert.ok(b && c, "hittar inte versionssträngarna");
  assert.equal(b[1], c[1], "index.html är v" + b[1] + " men sw.js cachar v" + c[1]);
});

/* ---------- summering ---------- */
console.log("\n" + (n - fail) + "/" + n + " tester gröna" + (fail ? " — " + fail + " RÖDA" : ""));
process.exit(fail ? 1 : 0);
