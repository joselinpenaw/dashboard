// Bundles the multi-file app into a single self-contained dist/dashboard.html.
const fs = require("fs");
let html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("assets/css/style.css", "utf8");
const order = ["config", "store", "ui", "gmail", "auth", "db", "esign", "views", "app"];
const js = order.map((f) => fs.readFileSync("assets/js/" + f + ".js", "utf8")).join("\n");
html = html.replace(/<link rel="stylesheet"[^>]*>/, "<style>\n" + css + "\n</style>");
html = html.replace(/<link rel="preconnect"[^>]*>\n?/, "");
html = html.replace(/\s*<script src="assets\/js\/config.js"><\/script>[\s\S]*?<script src="assets\/js\/app.js"><\/script>/, "\n  <script>\n" + js + "\n  </script>");
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/dashboard.html", html);
console.log("Bundle:", fs.statSync("dist/dashboard.html").size, "bytes");
