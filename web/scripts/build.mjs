// Static site build. Small on purpose: esbuild bundles the TypeScript, marked
// renders /docs, and everything else is string templates. No runtime
// dependencies ship to the browser.
//
//   node scripts/build.mjs           build into dist/
//   node scripts/build.mjs --serve   build, serve on :8000, rebuild on change
//
// Environment:
//   RELEASES_BASE_URL  public URL of the release bucket prefix, e.g.
//                      https://<bucket>.s3.<region>.amazonaws.com/releases
//   SITE_COMMIT        commit hash shown in the footer (defaults to git HEAD)

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { marked } from "marked";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const DOCS = path.join(ROOT, "docs");
const DIST = path.join(WEB, "dist");

const PAGES = [
  { out: "index.html", src: "pages/index.html", title: "Octez Cloud", nav: "home" },
  { out: "configure/index.html", src: "pages/configure.html", title: "Configure", nav: "configure", script: "configurator" },
  { out: "verify/index.html", src: "pages/verify.html", title: "Verify attestation", nav: "verify" },
];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const sri = (buf) => `sha384-${createHash("sha384").update(buf).digest("base64")}`;
const shortHash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

function commit() {
  if (process.env.SITE_COMMIT) return process.env.SITE_COMMIT.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "uncommitted";
  }
}

function writeOut(rel, content) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function layout({ title, nav, body, assets, script, rev }) {
  const navItem = (id, href, label) =>
    `<a href="${href}"${nav === id ? ' aria-current="page"' : ""}>${label}</a>`;
  const scriptTag = script
    ? `<script type="module" src="${assets[script].url}" integrity="${assets[script].sri}" crossorigin="anonymous"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title === "Octez Cloud" ? title : `${title} · Octez Cloud`)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assets.style.url}" integrity="${assets.style.sri}" crossorigin="anonymous">
${scriptTag}
</head>
<body>
<header class="site">
  <a class="brand" href="/">Octez Cloud</a>
  <nav>
    ${navItem("configure", "/configure/", "Configure")}
    ${navItem("verify", "/verify/", "Verify")}
    ${navItem("docs", "/docs/", "Docs")}
  </nav>
</header>
<main>
${body}
</main>
<footer class="site">
  <span>Open source, MIT licensed. Holds no credentials, keys or funds.</span>
  <span>Site build <code>${esc(rev)}</code></span>
</footer>
</body>
</html>
`;
}

function renderDoc(md) {
  const html = marked.parse(md, { async: false, gfm: true });
  // Rewrite links between docs: "keys.md" or "./keys.md#x" -> "/docs/keys/#x"
  return html.replace(/href="(?:\.\/)?([a-z0-9-]+)\.md(#[^"]*)?"/g, (_, slug, frag = "") => `href="/docs/${slug}/${frag}"`);
}

async function build() {
  const started = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });

  // Static files copied as-is (favicon, robots.txt, ...); style.css is fingerprinted below.
  for (const f of fs.readdirSync(path.join(WEB, "static"))) {
    if (f === "style.css") continue;
    fs.copyFileSync(path.join(WEB, "static", f), path.join(DIST, f));
  }

  const assets = {};

  const css = fs.readFileSync(path.join(WEB, "static/style.css"));
  const cssName = `assets/style-${shortHash(css)}.css`;
  writeOut(cssName, css);
  assets.style = { url: `/${cssName}`, sri: sri(css) };

  const result = await esbuild.build({
    entryPoints: { configurator: path.join(WEB, "src/configurator.ts") },
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    outdir: path.join(DIST, "assets"),
    entryNames: "[name]-[hash]",
    metafile: true,
    write: true,
    define: { __RELEASES_BASE_URL__: JSON.stringify(process.env.RELEASES_BASE_URL ?? "") },
    logLevel: "warning",
  });
  for (const [out, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const name = path.basename(meta.entryPoint, ".ts");
    const buf = fs.readFileSync(path.resolve(WEB, out));
    assets[name] = { url: `/${path.relative(DIST, path.resolve(WEB, out))}`, sri: sri(buf) };
  }

  const rev = commit();

  for (const p of PAGES) {
    const body = fs.readFileSync(path.join(WEB, p.src), "utf8");
    writeOut(p.out, layout({ ...p, body, assets, rev }));
  }

  // Docs: order and titles come from docs/nav.json.
  const nav = JSON.parse(fs.readFileSync(path.join(DOCS, "nav.json"), "utf8"));
  const sidebar = (current) =>
    `<nav class="docnav" aria-label="Documentation"><ul>${nav
      .map((d) => `<li><a href="/docs/${d.slug}/"${d.slug === current ? ' aria-current="page"' : ""}>${esc(d.title)}</a></li>`)
      .join("")}</ul></nav>`;

  for (const d of nav) {
    const md = fs.readFileSync(path.join(DOCS, `${d.slug}.md`), "utf8");
    const body = `<div class="docs">${sidebar(d.slug)}<article class="prose">${renderDoc(md)}</article></div>`;
    writeOut(`docs/${d.slug}/index.html`, layout({ title: d.title, nav: "docs", body, assets, rev }));
  }
  const indexBody = `<div class="docs">${sidebar("")}<article class="prose"><h1>Documentation</h1><ul>${nav
    .map((d) => `<li><a href="/docs/${d.slug}/">${esc(d.title)}</a>: ${esc(d.summary ?? "")}</li>`)
    .join("")}</ul></article></div>`;
  writeOut("docs/index.html", layout({ title: "Documentation", nav: "docs", body: indexBody, assets, rev }));

  // Machine-readable outputs for users' AI assistants and scripts:
  // the release manifest, and the agent skills under /skills/<name>/SKILL.md.
  fs.copyFileSync(path.join(WEB, "releases.json"), path.join(DIST, "releases.json"));
  fs.cpSync(path.join(ROOT, "skills"), path.join(DIST, "skills"), { recursive: true });

  writeOut(
    "404.html",
    layout({ title: "Not found", nav: "", body: '<h1>Not found</h1><p><a href="/">Back to the start</a></p>', assets, rev }),
  );

  console.log(`built dist/ in ${Date.now() - started} ms (rev ${rev})`);
}

function serve(port = 8000) {
  const types = { ".md": "text/markdown; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".json": "application/json" };
  createServer((req, res) => {
    // Same rewrite rule as the CloudFront function: "/x/" -> "/x/index.html", "/x" -> "/x/index.html".
    let uri = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (uri.endsWith("/")) uri += "index.html";
    else if (!path.posix.basename(uri).includes(".")) uri += "/index.html";
    const file = path.join(DIST, path.normalize(uri));
    if (!file.startsWith(DIST) || !fs.existsSync(file)) {
      res.writeHead(404, { "content-type": types[".html"] });
      return res.end(fs.readFileSync(path.join(DIST, "404.html")));
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  }).listen(port, "127.0.0.1", () => console.log(`serving http://127.0.0.1:${port}/`));
}

await build();

if (process.argv.includes("--serve")) {
  serve();
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 100);
  };
  for (const dir of [path.join(WEB, "src"), path.join(WEB, "pages"), path.join(WEB, "static"), DOCS, path.join(ROOT, "skills")]) {
    fs.watch(dir, { recursive: true }, rebuild);
  }
  fs.watch(path.join(WEB, "releases.json"), rebuild);
}
