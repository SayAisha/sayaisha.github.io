// Local test harness for api/search.js — run from nomicodex-deploy/
import handler from "./api/search.js";

const basic = new Set(["pulverization", "extractor", "arc furnace", "packager", "compressor", "fluid solidifier"]);

async function call(q, mode = "normal", uses = false) {
    return new Promise((resolve) => {
        const req = { url: `https://x/api/search?q=${encodeURIComponent(q)}&mode=${mode}${uses ? "&uses=1" : ""}`, headers: {} };
        const res = {
            statusCode: 200,
            setHeader() {},
            end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); }
        };
        handler(req, res);
    });
}

let fails = 0;
function check(name, cond, extra = "") {
    if (cond) console.log(`  ok   ${name}`);
    else { fails++; console.log(`  FAIL ${name} ${extra}`); }
}

const cases = [
    // --- number-word search ---
    ["micro miner tier 1", "Steel Plated Micro Miner [Tier One]"],
    ["micro miner 1", "Steel Plated Micro Miner [Tier One]"],
    ["micro miner 4", "Signalum Plated Micro Miner [Tier Four]"],
    ["micro miner tier six", "Enderium Plated Micro Miner [Tier Six]"],
    ["tier one micro miner", "Steel Plated Micro Miner [Tier One]"],
    ["tungsten micro miner 3", "Tungsten Carbide Plated Micro Miner [Tier Three]"],
    // --- no-space queries ---
    ["microminer tier 1", "Steel Plated Micro Miner [Tier One]"],
    ["microminer 4", "Signalum Plated Micro Miner [Tier Four]"],
    ["microminer tier six", "Enderium Plated Micro Miner [Tier Six]"],
    ["steelplatedmicrominer tier 1", "Steel Plated Micro Miner [Tier One]"],
    // --- tier 7+ name bridge (not named "Micro Miner" in the game data) ---
    ["micro miner tier 7", "Draconium Plated Micro Dragon Hunter [Tier Seven]"],
    ["microminer 8", "Crystal Matrix Plated Micro Leviathan Slayer [Tier Eight]"],
    ["micro miner 9", "Eternium Plated Micro Sun Eater [Tier Nine]"],
    ["microminer tier ten", "Neutronium Plated Micro Universe Harvester [Tier Ten]"],
    ["micro miner tier nine", "Eternium Plated Micro Sun Eater [Tier Nine]"],
];
for (const [q, expect] of cases) {
    const r = await call(q);
    check(`"${q}" -> ${expect}`, r.body.item && r.body.item.name === expect,
        `got ${r.body.item ? r.body.item.name : JSON.stringify(r.body).slice(0, 120)}`);
}

// bare "microminer" must behave exactly like the spaced "micro miner"
{
    const a = await call("micro miner");
    const b = await call("microminer");
    check(`"microminer" == "micro miner" behavior`,
        a.body.item?.name === b.body.item?.name && /Micro Miner/.test(b.body.item?.name || ""),
        `spaced: ${a.body.item?.name} vs squashed: ${b.body.item?.name}`);
}

// expert-mode bridges: half tiers + stabilized
{
    const r = await call("micro miner 4.5", "expert");
    check(`expert "micro miner 4.5" -> Mob Slayer`,
        r.body.item?.name === "Lumium Plated Micro Mob Slayer [Tier Four and Half]",
        `got ${r.body.item?.name}`);
    const r2 = await call("stabilized micro miner 7", "expert");
    check(`expert "stabilized micro miner 7" -> Stabilized Dragon Hunter`,
        r2.body.item?.name === "Stabilized Draconium Plated Micro Dragon Hunter [Tier Seven]",
        `got ${r2.body.item?.name}`);
    const r3 = await call("micro miner 8.5", "expert");
    check(`expert "micro miner 8.5" -> Excavator`,
        r3.body.item?.name === "Trinium Plated Micro Excavator [Tier Eight and Half]",
        `got ${r3.body.item?.name}`);
}
// normal mode must NOT bridge to expert-only items
{
    const r = await call("micro miner 4.5", "normal");
    check(`normal "micro miner 4.5" doesn't become Mob Slayer`,
        r.body.item?.name !== "Lumium Plated Micro Mob Slayer [Tier Four and Half]",
        `got ${r.body.item?.name}`);
}

// "tier 10" must NOT match "[Tier One]" (whole-word digits)
{
    const r = await call("micro miner tier 10");
    const name = r.body.item ? r.body.item.name : "";
    check(`"micro miner tier 10" finds no [Tier One]`, !name.includes("Tier One]"), `got ${name}`);
}

// --- regressions ---
for (const q of ["steel ingot", "pbi", "iridium ore ebf", "fusion reactor", "high octane gasoline", "polyethylene"]) {
    const r = await call(q);
    check(`regression "${q}"`, !!r.body.item, JSON.stringify(r.body).slice(0, 100));
}
{
    const r = await call("polyethylene");
    check(`polyethylene -> plastic alias`, /plastic/i.test(r.body.item?.name || ""), `got ${r.body.item?.name}`);
    const r2 = await call("micro miner tier 1", "expert");
    check(`expert mode micro miner tier 1`, r2.body.item?.name?.includes("Tier One"), `got ${r2.body.item?.name}`);
}

// --- ranking: production first, basic processing last and collapsed per machine ---
{
    const r = await call("steel ingot");
    const recipes = r.body.recipes || [];
    const firstBasic = recipes.findIndex(x => basic.has(x.type.toLowerCase())),
        lastMake = recipes.map(x => x.role).lastIndexOf("make");
    check(`steel ingot lists production before basic processing`,
        firstBasic > lastMake && recipes[0].role === "make",
        recipes.map(x => `${x.type}:${x.role}`).join(", ").slice(0, 200));
    const arc = recipes.filter(x => x.type === "Arc Furnace");
    check(`steel ingot arc furnace recycling collapses into one line`,
        arc.length === 1 && arc[0].role === "recycle" && arc[0].variants.length > 10, `got ${arc.length} lines`);
}
{
    const r = await call("titanium ingot");
    const recipes = r.body.recipes || [];
    check(`titanium ingot lists the hot ingot's blast furnace recipes first`,
        recipes[0]?.role === "hot" && recipes[0]?.type === "Blast Furnace" && recipes[0]?.itemName === "Hot Titanium Ingot",
        recipes.slice(0, 3).map(x => `${x.type}:${x.role}`).join(", "));
    const cool = recipes.findIndex(x => x.role === "cool");
    check(`titanium ingot cooling step follows the blast recipes`,
        cool > 0 && recipes.slice(0, cool).every(x => x.role === "hot"), `cool at ${cool}`);
}
{
    const r = await call("sulfuric acid");
    check(`sulfuric acid ranks the sulfur + water LCR first`,
        r.body.recipes?.[0]?.type === "Large Chemical Reactor" && /^Sulfur Dust/.test(r.body.recipes[0].ins),
        `${r.body.recipes?.[0]?.type}: ${r.body.recipes?.[0]?.ins}`);
}
{
    const r = await call("signalum dust", "normal", true);
    const all = [...(r.body.recipes || []).map(x => x.type), ...(r.body.uses || []).map(x => x.t)];
    check(`sag mill recipes are removed`, all.every(t => String(t).toLowerCase() !== "sag mill"), [...new Set(all)].join(", "));
}
{
    // tier labels derive from the recipe voltage, not the pack's broken
    // voltageTier field (diorite rock breaker: 60 EU/t = MV, not LV)
    const r = await call("diorite");
    const rb = (r.body.recipes || []).find(x => x.type === "Rock Breaker");
    check(`diorite rock breaker (60 EU/t) labeled MV`, rb && rb.tier === "MV", `got ${rb && rb.tier}`);
    const r2 = await call("sodium bisulfate");
    const lcr = (r2.body.recipes || []).find(x => x.type === "Large Chemical Reactor");
    check(`sodium bisulfate LCR (30 EU/t) still LV`, lcr && lcr.tier === "LV", `got ${lcr && lcr.tier}`);
    const r3 = await call("steel ingot");
    const ebf = (r3.body.recipes || []).find(x => x.type === "Blast Furnace");
    check(`steel ingot EBF (120 EU/t) labeled MV`, ebf && ebf.tier === "MV", `got ${ebf && ebf.tier} (eu=${ebf && ebf.eu})`);
}
{
    // variant completeness: sodium bisulfate must carry ALL recipes incl.
    // the salt-variant LCR/CR lines the old data build deduplicated away
    const r = await call("sodium bisulfate");
    const ins = (r.body.recipes || []).map(x => x.ins);
    const salt = (r.body.recipes || []).filter(x => x.ins.startsWith("Salt (2)"));
    check(`sodium bisulfate keeps the Salt + HCl recipe with its Chemical Reactor copy merged in`,
        salt.length === 1 && salt[0].variants.some(v => v.type === "Chemical Reactor"), ins.join(" | ").slice(0, 150));
    check(`sodium bisulfate shows 2 production lines then 2 merged reshaping lines`,
        (r.body.recipes || []).map(x => x.role).join(",") === "make,make,reshape,reshape",
        (r.body.recipes || []).map(x => x.role).join(","));
}
{
    // an ore dust whose primary step is the macerator must still resolve
    const r = await call("iron ore dust");
    check(`iron ore dust resolves`, !!r.body.item, JSON.stringify(r.body).slice(0, 100));
}
{
    const r = await call("steel ingot", "normal", true);
    const types = (r.body.uses || []).map(x => x.t);
    check(`steel ingot uses include basic processing again`,
        types.some(t => basic.has(String(t).toLowerCase())),
        [...new Set(types)].slice(0, 8).join(", "));
}
{
    // explicit machine requests filter to basic processing machines
    const rA = await call("steel ingot arc");
    const tA = (rA.body.recipes || []).map(x => x.type);
    check(`arc filter returns arc furnace`,
        rA.body.machineFilter === "arc furnace" && tA.some(t => t.toLowerCase() === "arc furnace"),
        `filter=${rA.body.machineFilter} types=${tA.slice(0, 3).join(", ")}`);
    const rP = await call("melon packager");
    const tP = (rP.body.recipes || []).map(x => x.type);
    check(`packager filter returns packager`,
        rP.body.machineFilter === "packager" && tP.some(t => t.toLowerCase() === "packager"),
        `filter=${rP.body.machineFilter}`);
    const rC = await call("steel ingot compressor");
    const tC = (rC.body.recipes || []).map(x => x.type);
    check(`compressor filter returns compressor`,
        rC.body.machineFilter === "compressor" && tC.some(t => t.toLowerCase() === "compressor"),
        `filter=${rC.body.machineFilter}`);
}
{
    // explicit machine request filters to the macerator
    const r = await call("iron ore dust macerator");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`macerator filter returns pulverization`,
        r.body.machineFilter === "pulverization" && types.some(t => t.toLowerCase() === "pulverization"),
        `filter=${r.body.machineFilter} types=${types.join(", ")}`);
}
{
    const r = await call("rubber bars extractor");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`extractor filter returns extractor`,
        r.body.machineFilter === "extractor" && types.some(t => t.toLowerCase() === "extractor"),
        `filter=${r.body.machineFilter} types=${types.join(", ")}`);
}


// ---- typo tolerance, word order, acronyms ----
{
    const typo = await call("steel casng");
    check("typo 'steel casng' -> a steel casing item", /casing/i.test(typo.body.item?.name || "") && /steel/i.test(typo.body.item?.name || ""), JSON.stringify(typo.body.item?.name));
    const typo2 = await call("machine casng");
    check("typo 'machine casng' -> machine casing", /machine casing/i.test(typo2.body.item?.name || ""), JSON.stringify(typo2.body.item?.name));
    const shuffle = await call("casing machine steel");
    check("shuffled 'casing machine steel' -> steel machine casing", /steel machine casing/i.test(shuffle.body.item?.name || ""), JSON.stringify(shuffle.body.item?.name));
    const pcb = await call("pcb");
    const pcbNames = [pcb.body.item?.name, ...(pcb.body.alternatives || []).map(a => a.name)].filter(Boolean);
    check("acronym 'pcb' surfaces Plastic Circuit Board", pcbNames.some(n => /plastic circuit board/i.test(n)), JSON.stringify(pcbNames.slice(0, 3)));
    const dym = await call("zzzqqq casng");
    check("zero-hit gives did-you-mean alternatives", (dym.body.alternatives || []).length > 0 && /casing/i.test(dym.body.alternatives[0].name || ""), JSON.stringify((dym.body.alternatives || []).slice(0, 2)));
}

console.log(fails ? `\n${fails} FAILURES` : "\nall passed");
process.exit(fails ? 1 : 0);
