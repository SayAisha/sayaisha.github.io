// Cleans search-data/<mode>.json.gz (drops machines the pack doesn't have) and writes the
// files the Cloudflare worker reads from GitHub Pages:
//   api/worker/index-<mode>.json   items + aliases
//   api/worker/depth-<mode>.json   each item's distance from raw resources (for ranking)
//   api/t/<mode>/r|u/<shard>.txt   recipes and uses, sharded by item id
// rebuild-search-data.mjs calls writeWorkerData after each rebuild; run this file on its
// own to refresh the worker files from the current search data.
import fs from "node:fs";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

import { removeMachines, shardOf, RECIPE_SHARDS, USE_SHARDS } from "./lib/data.js";
import { buildDepths } from "./lib/ranking.js";

const MODES = ["normal", "expert"];

function shard(map, count) {
    const shards = {};

    for (const [id, list] of Object.entries(map)) {
        (shards[shardOf(id, count)] ??= {})[id] = list;
    }

    return shards;
}

function writeShards(dir, shards) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const [name, map] of Object.entries(shards)) {
        const body = JSON.stringify(map);

        fs.writeFileSync(`${dir}/${name}.txt`, body);
        fs.writeFileSync(`${dir}/${name}.json`, body);
    }

    return Object.keys(shards).length;
}

export function writeWorkerData(mode, index) {
    removeMachines(index);

    fs.writeFileSync(`search-data/${mode}.json.gz`, zlib.gzipSync(JSON.stringify(index), { level: 9 }));

    const recipeFiles = writeShards(`api/t/${mode}/r`, shard(index.recipes, RECIPE_SHARDS)),
        useFiles = writeShards(`api/t/${mode}/u`, shard(index.uses, USE_SHARDS));

    fs.writeFileSync(`api/worker/index-${mode}.json`, JSON.stringify({ i: index.i, a: index.a }));
    fs.writeFileSync(`api/worker/depth-${mode}.json`, JSON.stringify(Object.fromEntries(buildDepths(index))));

    return { recipeFiles, useFiles };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    for (const mode of MODES) {
        const index = JSON.parse(zlib.gunzipSync(fs.readFileSync(`search-data/${mode}.json.gz`)));
        const { recipeFiles, useFiles } = writeWorkerData(mode, index);

        console.log(`${mode}: ${index.i.length} items, ${recipeFiles} recipe shards, ${useFiles} use shards`);
    }
}
