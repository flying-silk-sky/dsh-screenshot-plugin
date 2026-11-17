// Scratch harness: drives the plugin's HTTP routes without the DSH composition.
import { apply } from "../lib/index.js";

const routes = new Map();
const disposers = [];
const ctx = {
  webServer: {
    register(route) {
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  },
  connection: { requestRejection: () => undefined },
  effect(factory) {
    const dispose = factory();
    disposers.push(dispose);
    return dispose;
  },
};

apply(ctx);
console.log("routes:", [...routes.keys()]);

function call(path, { method = "POST", body = "", headers = {} } = {}) {
  const handler = routes.get(path);
  if (handler === undefined) throw new Error(`no route ${path}`);
  const payload = Buffer.from(body, "utf8");
  const request = {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield payload;
    },
    resume() {},
  };
  return new Promise((resolve) => {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(this.chunks).toString("utf8"),
        });
      },
    };
    handler(request, response);
  });
}

const started = Date.now();
const health = await call("/dsh-screenshot/health", { method: "GET" });
console.log("health", health.status, health.body);

for (const mode of ["show", "hide"]) {
  const at = Date.now();
  const response = await call("/dsh-screenshot/capture", {
    body: JSON.stringify({ mode, title: "DeepSeek Harness" }),
  });
  const parsed = JSON.parse(response.body);
  console.log(
    mode,
    "status=" + response.status,
    "ms=" + (Date.now() - at),
    "ok=" + parsed.ok,
    "hidden=" + parsed.hidden,
    "reason=" + parsed.reason,
    "size=" + parsed.width + "x" + parsed.height,
    "image=" + (typeof parsed.image === "string" ? parsed.image.slice(0, 30) + "… (" + parsed.image.length + " chars)" : parsed.image),
    parsed.error ? "error=" + parsed.error : "",
  );
  if (typeof parsed.image === "string" && parsed.image.startsWith("data:image/png;base64,")) {
    const bytes = Buffer.from(parsed.image.slice("data:image/png;base64,".length), "base64");
    const signature = bytes.subarray(0, 8).toString("hex");
    console.log("  png signature", signature, "bytes", bytes.length, signature === "89504e470d0a1a0a" ? "VALID" : "INVALID");
  }
}

console.log("total", Date.now() - started, "ms");
for (const dispose of disposers) if (typeof dispose === "function") dispose();
