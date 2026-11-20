import fs from "node:fs";
const root = "prototypes/cv-mod-import/";
let html = fs.readFileSync(root + "index.html", "utf8");
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="[^"]+"\s*\/?>/,
  "<style>" + fs.readFileSync(root + "ui.css", "utf8") + "</style>",
);
html = html.replace(
  /<script\s+defer\s+src="[^"]+"\s*>\s*<\/script>/,
  "<script defer>" + fs.readFileSync(root + "ui.js", "utf8") + "</script>",
);
// Inline defer has no effect; run the real UI script after its DOM exists.
const script = html.match(/<script defer>([\s\S]*?)<\/script>/)?.[0];
if (!script) throw new Error("UI script not found");
html = html
  .replace(script, "")
  .replace(
    /(<script id="preview-config" type="application\/json">)[\s\S]*?(<\/script>)/,
    '$1{"demo":true}$2',
  )
  .replace("</body>", script.replace("<script defer>", "<script>") + "</body>");
fs.mkdirSync(".work/cv-mod-prototype-start", { recursive: true });
fs.writeFileSync(".work/cv-mod-prototype-start/preview.html", html);
console.log(
  ".work/cv-mod-prototype-start/preview.html (explicit demo, no network/model)",
);
