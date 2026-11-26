// NomiCodex search — Cloudflare worker fallback. Same search and ranking as the Vercel
// function (lib/search.js), but its data comes from GitHub Pages: the item index and
// depth map once per isolate, and recipe / use shards per item.
// Deploy: npm run build:worker, then upload dist/worker.js as "nomicodex-search".
import { search } from "../lib/search.js";
import { shardOf, RECIPE_SHARDS, USE_SHARDS } from "../lib/data.js";

const DATA_URL = "https://sayaisha.github.io/NomiCodex/api/";
const SHARD_TTL = 300;

const sources = {};

async function fetchJson(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: SHARD_TTL } });
            if (res.ok) return await res.json();
        } catch {}
    }

    return null;
}

function shardReader(mode, kind, count) {
    return async id => {
        const shard = await fetchJson(`${DATA_URL}t/${mode}/${kind}/${shardOf(id, count)}.txt`);
        return shard?.[id] ?? [];
    };
}

async function getSource(mode) {
    if (!sources[mode]) {
        const [index, depth] = await Promise.all([
            fetchJson(`${DATA_URL}worker/index-${mode}.json`),
            fetchJson(`${DATA_URL}worker/depth-${mode}.json`),
        ]);

        if (!index) throw new Error("Failed to load index");

        sources[mode] = {
            items: index.i,
            aliases: index.a,
            depth: new Map(Object.entries(depth ?? {})),
            getRecipes: shardReader(mode, "r", RECIPE_SHARDS),
            getUses: shardReader(mode, "u", USE_SHARDS),
        };
    }

    return sources[mode];
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
}

async function handleSearch(url) {
    const mode = url.searchParams.get("mode") === "expert" ? "expert" : "normal";

    let source;

    try {
        source = await getSource(mode);
    } catch (e) {
        return json({ error: "data unavailable", detail: String(e.message || e) }, 500);
    }

    const { status, body } = await search(
        { q: url.searchParams.get("q"), mode, uses: url.searchParams.get("uses") === "1" },
        source
    );

    return json(body, status);
}

export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/search") return handleSearch(url);
        if (url.pathname === "/health") return json({ ok: true, cached_modes: Object.keys(sources) });

        return json({ error: "not found" }, 404);
    },
};
