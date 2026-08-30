/**
 * Tap DAO — Apple Watch Frontend Server
 * Serves the watch-style UI on port 4000
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 4000;
const HTML_FILE = path.join(__dirname, "index.html");

const server = http.createServer((req, res) => {
  // Serve index.html for all routes
  fs.readFile(HTML_FILE, "utf8", (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error loading watch UI");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("   ⌚ TAP DAO — Apple Watch UI");
  console.log("═══════════════════════════════════════════════");
  console.log(`   Local:   http://localhost:${PORT}`);

  // Show LAN IP
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`   Network: http://${net.address}:${PORT}`);
      }
    }
  }

  console.log("═══════════════════════════════════════════════");
  console.log("   Backend must be running on port 3001");
  console.log("═══════════════════════════════════════════════");
});
