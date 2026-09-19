const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const allowed = new Set(["/tests/fixture.html", "/tests/fixture.js", "/content.js", "/seek-logic.js", "/overlay.css"]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const route = pathname === "/" ? "/tests/fixture.html" : pathname;
  if (!allowed.has(route)) { response.writeHead(404).end("Not found"); return; }
  fs.readFile(path.join(root, route), (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(route)], "Cache-Control": "no-store" });
    response.end(content);
  });
});
server.on("error", error => {
  if (error.code === "EADDRINUSE") server.listen(0, "127.0.0.1");
  else throw error;
});
server.listen(Number(process.env.PORT) || 4173, "127.0.0.1", () => {
  console.log(`Fixture: http://127.0.0.1:${server.address().port}/tests/fixture.html`);
});