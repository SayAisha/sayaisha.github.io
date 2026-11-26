// Shared data helpers for the search index: removing machines the pack doesn't have,
// and the shard layout the Cloudflare worker reads from GitHub Pages.

// machines the recipe dump carries but the pack doesn't actually have
export const REMOVED_TYPES = new Set(["sag mill"]);

export const RECIPE_SHARDS = 256;
export const USE_SHARDS = 2048;

export const isRemovedType = type => REMOVED_TYPES.has(String(type || "").toLowerCase());

export function withoutRemoved(recipes) {
    return recipes.filter(recipe => !isRemovedType(recipe.type));
}

export function usesWithoutRemoved(uses) {
    return uses.filter(use => !isRemovedType(use.t));
}

// index = { i: items, a: aliases, recipes: { id: [...] }, uses: { id: [...] } }
export function removeMachines(index) {
    for (const [id, list] of Object.entries(index.recipes)) index.recipes[id] = withoutRemoved(list);
    for (const [id, list] of Object.entries(index.uses)) index.uses[id] = usesWithoutRemoved(list);

    for (const item of index.i) {
        if (Array.isArray(item[6])) item[6] = item[6].filter(type => !isRemovedType(type));
        item[4] = index.recipes[item[0]]?.length ?? 0;
        item[5] = index.uses[item[0]]?.length ?? 0;
    }

    return index;
}

export function shardOf(id, count) {
    const pad = String(count - 1).length;
    return String([...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % count).padStart(pad, "0");
}
