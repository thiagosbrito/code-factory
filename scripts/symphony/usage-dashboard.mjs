import { createServer } from "node:http";
import { auditUsage, parseArgs } from "./usage.mjs";

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Symphony usage</title>
<style>body{font:15px system-ui;max-width:1400px;margin:36px auto;padding:0 18px;background:#10151d;color:#e9eef5}h1{font-size:30px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.metric{background:#1a2330;border:1px solid #334154;border-radius:12px;padding:20px}.metric strong{display:block;font-size:29px;font-variant-numeric:tabular-nums;margin:10px 0}.metric:first-child strong{color:#75e3bf}.metric small{display:block}.badge{color:#75e3bf}@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}p,small{color:#aeb9c7}.box{background:#1a2330;border:1px solid #334154;border-radius:12px;padding:16px;margin:14px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #334154}th{color:#aeb9c7;font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}@media(max-width:700px){.scroll{overflow:auto}table{min-width:760px}}</style>
<h1>Symphony usage</h1><p>Local, read-only Codex session audit. Processed input includes cached input; fresh input excludes the cached subset. Output includes reasoning tokens.</p><div id="summary" class="box">Loading…</div><div class="stats"><div class="metric">Fresh input<strong id="fresh">—</strong><small>Input excluding cached tokens</small></div><div class="metric">Cache reuse<strong id="reuse">—</strong><small id="cached">—</small></div><div class="metric">Output<strong id="output">—</strong><small>Includes reasoning</small></div><div class="metric">Observed model calls<strong id="calls">—</strong><small>Distinct usage updates</small></div></div><h2>Progress and context by ticket</h2><div class="box scroll"><table><thead><tr><th>Ticket</th><th>Checkpoint</th><th class="num">Sessions</th><th class="num">Calls</th><th class="num">Input processed</th><th class="num">Fresh input</th><th class="num">Cached input</th><th class="num">Output</th><th class="num">Latest request context</th><th class="num">Peak request context</th></tr></thead><tbody id="rows"></tbody></table></div><p><small>Refreshes every 15 seconds. Checkpoint phases appear for workers using the new workflow. Latest request context is the last request’s input plus output, not a live context window. Recent sessions only; token counts do not measure dollars or remaining Plus allowance.</small></p>
<script>const fmt=n=>Number(n||0).toLocaleString();async function load(){try{const d=await(await fetch('/api')).json();document.querySelector('#summary').textContent=d.tickets.length+' tickets · '+fmt(d.scannedFiles)+' recent session files scanned · Updated '+new Date().toLocaleTimeString();const sum=k=>d.tickets.reduce((n,t)=>n+t[k],0);document.querySelector('#fresh').textContent=fmt(sum('freshInputTokens'));document.querySelector('#reuse').textContent=sum('inputTokens')?(100*sum('cachedInputTokens')/sum('inputTokens')).toFixed(1)+'%':'—';document.querySelector('#cached').textContent=fmt(sum('cachedInputTokens'))+' cached / '+fmt(sum('inputTokens'))+' processed input';document.querySelector('#output').textContent=fmt(sum('outputTokens'));document.querySelector('#calls').textContent=fmt(sum('calls'));document.querySelector('#rows').innerHTML=d.tickets.map(t=>'<tr><td>'+t.ticket+'</td><td>'+ (t.phase||'—')+'</td><td class="num">'+fmt(t.sessions)+'</td><td class="num">'+fmt(t.calls)+'</td><td class="num">'+fmt(t.inputTokens)+'</td><td class="num">'+fmt(t.freshInputTokens)+'</td><td class="num">'+fmt(t.cachedInputTokens)+'</td><td class="num">'+fmt(t.outputTokens)+'</td><td class="num">'+fmt(t.currentContextTokens)+'</td><td class="num">'+fmt(t.peakContextTokens)+'</td></tr>').join('')||'<tr><td colspan="10">No matching workspace sessions found.</td></tr>'}catch{document.querySelector('#summary').textContent='Unable to read session data.'}}load();setInterval(load,15000)</script>`;

const options = parseArgs(process.argv.slice(2));
let cachedAt = 0,
  cachedData,
  pending;
const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page);
    return;
  }
  if (req.url === "/api") {
    try {
      if (Date.now() - cachedAt > 15_000) {
        pending ??= auditUsage(options)
          .then((data) => {
            cachedData = data;
            cachedAt = Date.now();
          })
          .finally(() => {
            pending = null;
          });
        await pending;
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(cachedData));
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});
server.listen(options.port, "127.0.0.1", () =>
  console.log(`Symphony usage dashboard: http://127.0.0.1:${options.port}`),
);
