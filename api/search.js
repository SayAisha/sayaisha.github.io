// NomiCodex search — Vercel edition. The whole index (items, recipes, uses)
// ships gzipped inside the function bundle: zero runtime fetches, so there is
// no upstream to stall. GET /api/search?q=<query>&mode=<normal|expert>&uses=1
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { search } from "../lib/search.js";
import { buildDepths } from "../lib/ranking.js";

const sources = {};

function getSource(mode) {
    if (!sources[mode]) {
        const gz = fs.readFileSync(path.join(process.cwd(), "search-data", `${mode}.json.gz`));
        const index = JSON.parse(zlib.gunzipSync(gz));

        sources[mode] = {
            items: index.i,
            aliases: index.a,
            depth: buildDepths(index),
            getRecipes: id => index.recipes[id] || [],
            getUses: id => index.uses[id] || [],
        };
    }

    return sources[mode];
}

export default async function handler(req, res) {
    const url = new URL(req.url, "https://x");
    const mode = url.searchParams.get("mode") === "expert" ? "expert" : "normal";

    const send = (data, status = 200) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify(data));
    };

    let source;

    try {
        source = getSource(mode);
    } catch (e) {
        return send({ error: "data unavailable", detail: String(e.message || e) }, 500);
    }

    const { status, body } = await search(
        { q: url.searchParams.get("q"), mode, uses: url.searchParams.get("uses") === "1" },
        source
    );

    return send(body, status);
}
