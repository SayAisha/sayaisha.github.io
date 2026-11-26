// Recipe ranking: puts the recipe a player most likely means first.
//
// 1. Distance from raw: every item gets a depth = how many production steps it is
//    from raw resources (items nothing in the pack makes). Recycling machines and
//    reshaping recipes (block -> ingot, nugget -> ingot) don't count as production.
//    A recipe is "forward" when its ingredients are closer to raw than the item.
// 2. Rules on top: hot ingots point at their EBF step, the item must be the main
//    output, lower tier wins ties, and unknown ingredients count as neutral.
// 3. Duplicates collapse: LCR / Chemical Reactor copies, fuel variants, and all the
//    recycling or reshaping recipes of one machine show as one line each.

const RECYCLERS = new Set([
    "arc furnace", "pulverization", "extractor", "fluid solidifier",
    "packager", "compressor", "forge hammer", "macerator",
]);

const CHEMICAL_TYPES = new Set(["chemical reactor", "large chemical reactor"]);

const FORM_REGEX = /^(?:Block of|Tiny Pile of|Small Pile of|Molten)\s+|\s+(?:Ingot|Nugget|Plate|Dust|Block|Gem)$/g;
const HOT_INGOT_REGEX = /^Hot (.+ Ingot)$/;
const VOLTAGES = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152];

const ROLE_ORDER = { hot: 0, cool: 0, make: 1, byproduct: 2, recycle: 3, reshape: 4 };

// when copies merge, the multiblock that shows every output is the main line
const MACHINE_PREFERENCE = { distillery: 1, "chemical reactor": 1 };

const plain = s => String(s ?? "").replace(/<[^>]*>/g, "");

// "2x Steel Wire (1), Oxygen (56L)" -> ["Steel Wire", "Oxygen"]
function parseNames(list) {
    return plain(list)
        .split(/,\s*(?![^()]*\))/)
        .map(part => part.replace(/\s*\([^)]*\)\s*$/, "").replace(/^\d+x /, "").trim())
        .filter(Boolean);
}

const materialOf = name => String(name).replace(FORM_REGEX, "").trim();
const tierOf = eu => Math.max(0, VOLTAGES.findIndex(v => (eu || 0) <= v));

// the same material in another form; its plain dust is the real production input
function isReshape(out, ins) {
    const material = materialOf(out),
        dust = `${material} Dust`;

    return ins.length > 0 && ins.every(n => materialOf(n) === material && (n !== dust || out === dust));
}

function isGraphRecipe(recipe, out, ins) {
    return !RECYCLERS.has(recipe.type.toLowerCase()) && !isReshape(out, ins);
}

export function buildDepths(index) {
    const nameOf = new Map(index.i.map(item => [item[0], item[1]]));
    const edges = [];

    for (const [id, list] of Object.entries(index.recipes)) {
        const out = nameOf.get(id);

        for (const recipe of list) {
            const ins = parseNames(recipe.ins);
            if (ins.length && isGraphRecipe(recipe, out, ins)) edges.push({ out, ins });
        }
    }

    const producible = new Set(edges.map(edge => edge.out));
    const depth = new Map();

    for (const item of index.i) {
        if (!producible.has(item[1])) depth.set(item[1], 0);
    }

    // relax until nothing gets shallower (Bellman-Ford over the recipe hypergraph)
    for (let changed = true; changed; ) {
        changed = false;

        for (const { out, ins } of edges) {
            let max = 0;

            for (const name of ins) {
                const d = depth.get(name);

                if (d === undefined) {
                    max = Infinity;
                    break;
                }

                max = Math.max(max, d);
            }

            if (max !== Infinity && (depth.get(out) ?? Infinity) > max + 1) {
                depth.set(out, max + 1);
                changed = true;
            }
        }
    }

    return depth;
}

function classify(recipe, itemName, depth, madeFromItem) {
    const ins = parseNames(recipe.ins),
        outs = parseNames(recipe.outs);

    const hot = ins.map(n => n.match(HOT_INGOT_REGEX)).find(Boolean);

    if (hot && hot[1] === itemName) return { role: "cool", ins, hotName: hot[0], distance: 0 };
    if (isReshape(itemName, ins)) return { role: "reshape", ins, distance: Infinity };
    const own = depth.get(itemName);

    // made from the item and further from raw than it: turning a product back into the item
    const dust = `${materialOf(itemName)} Dust`;
    const loopsBack = n => n !== dust && madeFromItem.has(n) && own !== undefined && (depth.get(n) ?? -1) >= own;

    if (RECYCLERS.has(recipe.type.toLowerCase()) || ins.some(loopsBack)) {
        return { role: "recycle", ins, distance: Infinity };
    }

    const inputDepths = ins.map(n => depth.get(n));
    const known = inputDepths.filter(d => d !== undefined);

    // unknown ingredients count as neutral: one step below the item
    const neutral = own === undefined ? 0 : Math.max(0, own - 1);
    const distance = known.length ? Math.max(...known, ...(known.length < ins.length ? [neutral] : [])) : neutral;

    // every output of a distillation is a product, so its order doesn't mean byproduct
    const main = outs[0] === itemName || machineKey(recipe.type) === "distillation";

    return { role: main ? "make" : "byproduct", ins, distance };
}

const DISTILLATION_TYPES = new Set(["distillery", "distillation tower"]);

function machineKey(type) {
    const lower = type.toLowerCase();

    if (CHEMICAL_TYPES.has(lower)) return "chemical";
    if (DISTILLATION_TYPES.has(lower)) return "distillation";

    return lower;
}

// fuel-style variants (same machine, output, first ingredient and ingredient count)
// collapse into one line; versions with extra ingredients (gas, catalysts) stay separate
// a Distillery recipe is one output of the matching Distillation Tower recipe, and
// recycling or reshaping in one machine collapses into a single line
function variantKey(recipe, ins, role) {
    const machine = machineKey(recipe.type);

    if (role === "recycle" || role === "reshape") return `${role}|${machine}`;
    if (machine === "distillation") return `${machine}|${ins[0] ?? ""}`;
    return `${machine}|${plain(recipe.outs)}|${ins.length}|${ins[0] ?? ""}`;
}

export function rankRecipes(recipes, itemName, depth, madeFromItem, findHotRecipe) {
    const rows = recipes.map(recipe => ({ recipe, ...classify(recipe, itemName, depth, madeFromItem) }));

    rows.sort(
        (a, b) =>
            ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
            a.distance - b.distance ||
            (MACHINE_PREFERENCE[a.recipe.type.toLowerCase()] ?? 0) - (MACHINE_PREFERENCE[b.recipe.type.toLowerCase()] ?? 0) ||
            tierOf(a.recipe.eu) - tierOf(b.recipe.eu) ||
            (a.recipe.eu || 0) * (a.recipe.dur || 0) - (b.recipe.eu || 0) * (b.recipe.dur || 0)
    );

    const out = [];
    const byKey = new Map();

    for (const row of rows) {
        const exact = `${machineKey(row.recipe.type)}|${plain(row.recipe.ins)}|${plain(row.recipe.outs)}`,
            loose = variantKey(row.recipe, row.ins, row.role);

        const existing = byKey.get(exact) ?? byKey.get(loose);

        if (existing) {
            existing.variants.push({ type: row.recipe.type, ins: plain(row.recipe.ins) });
            continue;
        }

        const entry = { ...row.recipe, role: row.role, variants: [] };

        // a hot ingot is really made in the EBF: list its blast recipes first, then the cooling step
        if (row.role === "cool") out.push(...findHotRecipe(row.hotName));

        byKey.set(exact, entry);
        byKey.set(loose, entry);
        out.push(entry);
    }

    return out;
}

export const _test = { parseNames, materialOf, isReshape, classify };
