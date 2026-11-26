// Local server: the search API with ranked recipes, plus a small page to try it at http://127.0.0.1:8799/
import http from "node:http";
import handler from "./api/search.js";

const page = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ranked recipes</title>
<style>
:root{--bg:#f7f7f8;--fg:#1d1d20;--muted:#6b6b75;--card:#fff;--line:#e4e4e8;--accent:#6d4aff}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#ececf1;--muted:#9a9aa5;--card:#1f1f25;--line:#2e2e36;--accent:#a78bfa}}
body{margin:0;padding:16px;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:860px;margin:0 auto}
form{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
input,select,button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
input{flex:1;min-width:200px}button{background:var(--accent);color:#fff;border:0;cursor:pointer}
.r{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}
.top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.n{color:var(--muted);font-variant-numeric:tabular-nums}
.role{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.role.make,.role.hot{color:var(--accent);border-color:var(--accent)}
.io,.via,.var{color:var(--muted);font-size:14px;margin-top:4px;overflow-wrap:anywhere}.via{color:var(--fg)}
h2{font-size:18px;margin:16px 0 4px}
</style></head><body><main>
<form id="f"><input id="q" placeholder="Item, optionally with a machine (e.g. osmiridium ingot, plastic lcr)" autofocus>
<select id="m"><option>normal</option><option>expert</option></select><button>Search</button></form>
<div id="out"></div></main>
<script>
const plain = s => String(s ?? "").replace(/<[^>]*>/g, "");
const esc = s => plain(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const labels = { hot: "hot ingot (EBF)", make: "production", byproduct: "byproduct", recycle: "recycling", reshape: "other form" };
document.getElementById("f").onsubmit = async e => {
  e.preventDefault();
  const q = document.getElementById("q").value.trim(), m = document.getElementById("m").value, out = document.getElementById("out");
  if (!q) return;
  out.textContent = "Searching…";
  const d = await (await fetch("/api/search?q=" + encodeURIComponent(q) + "&mode=" + m)).json();
  if (!d.item) { out.innerHTML = "<p>No item found." + (d.alternatives?.length ? " Did you mean: " + d.alternatives.map(a => esc(a.name)).join(", ") : "") + "</p>"; return; }
  out.innerHTML = "<h2>" + esc(d.item.name) + (d.machineFilter ? " (" + esc(d.machineFilter) + ")" : "") + "</h2>" + (d.recipes || []).map((r, i) =>
    '<div class="r"><div class="top"><span class="n">' + (i + 1) + '</span><b>' + esc(r.type) + '</b><span class="role ' + r.role + '">' + labels[r.role] + '</span>' +
    '<span class="n">' + (r.eu || 0) + ' EU/t • ' + (r.dur / 20) + 's' + (r.heat ? ' • ' + r.heat + 'K' : '') + '</span></div>' +
    '<div class="io">' + esc(r.ins) + ' → ' + esc(r.outs) + '</div>' +
    (r.via ? '<div class="via">↳ ' + esc(r.via.item) + ': ' + esc(r.via.type) + ' • ' + r.via.eu + ' EU/t • ' + (r.via.dur / 20) + 's • ' + r.via.heat + 'K from ' + esc(r.via.ins) + '</div>' : '') +
    (r.variants?.length ? '<div class="var">Also: ' + r.variants.map(v => esc(v.type) + ' (' + esc(v.ins) + ')').join(" • ") + '</div>' : '') + '</div>').join("");
};
</script></body></html>`;

http.createServer((req, res) => {
    if (req.url.startsWith("/api/search")) return handler(req, res);
    if (req.url === "/" || req.url.startsWith("/?")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(page);
    }
    res.writeHead(404);
    res.end("not found");
}).listen(8799, "127.0.0.1", () => console.log("ranked search on http://127.0.0.1:8799/"));
