import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "lib", "client.js");
const origin = "http://127.0.0.1:3080";

function framedHash(domain, parts) {
  const hash = createHash("sha1").update(domain).update("\0");
  for (const part of parts) hash.update(`${Buffer.byteLength(part)}:`).update(part);
  return hash.digest("hex").slice(0, 12);
}

const info = await stat(clientPath);
const rev = framedHash("plugin-artifact", [String(info.mtimeMs), String(info.ctimeMs), String(info.size)]);
console.log("client.js mtimeMs=%s ctimeMs=%s size=%s", info.mtimeMs, info.ctimeMs, info.size);
console.log("computed rev=%s", rev);

async function probe(label, url) {
  try {
    const response = await fetch(url, { headers: { accept: "*/*" } });
    const body = await response.text();
    console.log(
      `${label.padEnd(22)} status=${response.status} type=${response.headers.get("content-type")} len=${body.length} head=${JSON.stringify(body.slice(0, 70))}`,
    );
    return { status: response.status, body };
  } catch (error) {
    console.log(`${label.padEnd(22)} ERROR ${error?.message ?? error}`);
    return { status: 0, body: "" };
  }
}

await probe("bundle exact rev", `${origin}/plugins/dsh-screenshot-plugin/client.js?rev=${rev}`);
await probe("bundle no rev", `${origin}/plugins/dsh-screenshot-plugin/client.js`);
await probe("bundle unknown id", `${origin}/plugins/nope/client.js?rev=${rev}`);
const combo = await probe("bundle combo", `${origin}/plugins/??dsh-screenshot-plugin/client.js&rev=${rev}`);
if (combo.status === 200) {
  console.log(
    "  served body: bytes=%s react-dom=%s createPortal=%s guard=%s",
    Buffer.byteLength(combo.body),
    combo.body.includes('require("react-dom")'),
    combo.body.includes("createPortal"),
    combo.body.includes("getDerivedStateFromError"),
  );
}
await probe("health route", `${origin}/dsh-screenshot/health`);
await probe("capture route (GET)", `${origin}/dsh-screenshot/capture`);
