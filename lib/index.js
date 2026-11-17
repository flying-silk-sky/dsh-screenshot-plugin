/**
 * dsh-screenshot-plugin — host half.
 *
 * Exposes one HTTP route on the DSH web server that takes a screenshot of the
 * Windows desktop. The optional `hide` mode hides the window that shows this
 * DSH page first (matched through the page title), so the frozen screenshot
 * shows what was behind the interface instead of the interface itself.
 *
 * The whole capture runs in Windows PowerShell: `lib/capture.ps1` uses
 * user32/gdi32 through System.Drawing, prints a single JSON line on stdout and
 * writes the PNG into a private temp directory that is deleted right after the
 * bytes have been read.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "ui-screenshot";

export const inject = ["webServer", "connection"];

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "capture.ps1");
const CAPTURE_PATH = "/dsh-screenshot/capture";
const HEALTH_PATH = "/dsh-screenshot/health";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_TITLE_LENGTH = 300;
const CAPTURE_TIMEOUT_MS = 30_000;
const MODES = new Set(["hide", "show"]);

/** Serializes captures: two overlapping hide/show cycles would fight each other. */
let inFlight = null;

export function apply(ctx) {
  const captureHandler = async (req, res) => {
    if (fenced(ctx, req, res)) return;
    if (req.method !== "POST") {
      sendMethodNotAllowed(res, "POST");
      return;
    }
    const body = await readBody(req);
    if (body === null) {
      sendJson(res, 413, { ok: false, error: "request body too large" });
      return;
    }
    let request;
    try {
      request = body.length === 0 ? {} : JSON.parse(body);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON body" });
      return;
    }
    const mode = typeof request.mode === "string" ? request.mode : "show";
    if (!MODES.has(mode)) {
      sendJson(res, 400, { ok: false, error: `unsupported mode: ${mode}` });
      return;
    }
    if (process.platform !== "win32") {
      sendJson(res, 501, { ok: false, error: "screenshot capture requires Windows" });
      return;
    }
    if (inFlight !== null) {
      sendJson(res, 409, { ok: false, error: "a capture is already running" });
      return;
    }
    const title = typeof request.title === "string" ? request.title.slice(0, MAX_TITLE_LENGTH) : "";
    inFlight = runCapture(mode, title);
    try {
      const shot = await inFlight;
      sendJson(res, 200, {
        ok: true,
        mode,
        image: `data:image/png;base64,${shot.png.toString("base64")}`,
        width: shot.width,
        height: shot.height,
        origin: { x: shot.x, y: shot.y },
        hidden: shot.hidden,
        reason: shot.reason,
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: describe(error) });
    } finally {
      inFlight = null;
    }
  };

  const healthHandler = async (req, res) => {
    if (fenced(ctx, req, res)) return;
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendMethodNotAllowed(res, "GET, HEAD");
      return;
    }
    sendJson(res, 200, {
      ok: true,
      platform: process.platform,
      powershell: process.platform === "win32" ? resolveExecutables() : [],
      script: existsSync(SCRIPT_PATH),
      busy: inFlight !== null,
    });
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: "exact", path: CAPTURE_PATH, handler: captureHandler }),
    "dsh-screenshot: capture route",
  );
  ctx.effect(
    () => ctx.webServer.register({ kind: "exact", path: HEALTH_PATH, handler: healthHandler }),
    "dsh-screenshot: health route",
  );
}

/**
 * Runs the capture script once and returns the parsed result plus the PNG
 * bytes. The temp directory is always removed, even on failure.
 */
async function runCapture(mode, title) {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`capture script is missing: ${SCRIPT_PATH}`);
  }
  const workDir = await mkdtemp(join(tmpdir(), "dsh-screenshot-"));
  try {
    const outPath = join(workDir, "capture.png");
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT_PATH,
      "-OutB64",
      Buffer.from(outPath, "utf8").toString("base64"),
      "-Mode",
      mode,
      // PowerShell drops empty native arguments, so an empty title travels as
      // the base64 of a single space and is trimmed back to "" by the script.
      "-TitleB64",
      Buffer.from(title, "utf8").toString("base64") || "IA==",
    ];
    let reported = null;
    for (const executable of resolveExecutables()) {
      const result = await execPowerShell(executable, args);
      const parsed = parseResultLine(result.stdout);
      if (parsed !== null && parsed.ok === true) {
        const png = await readFile(outPath);
        return {
          png,
          width: Number(parsed.width) || 0,
          height: Number(parsed.height) || 0,
          x: Number(parsed.x) || 0,
          y: Number(parsed.y) || 0,
          hidden: parsed.hidden === true,
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
        };
      }
      if (parsed !== null && parsed.ok === false) {
        // The script ran and told us why the capture failed: another shell
        // will fail the same way, so stop here.
        throw new Error(typeof parsed.error === "string" ? parsed.error : "capture failed");
      }
      reported = describeShellFailure(executable, result);
    }
    throw new Error(reported ?? "PowerShell is not available");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Windows PowerShell 7 first, then the inbox Windows PowerShell 5.1. */
function resolveExecutables() {
  const candidates = [process.env.DSH_SCREENSHOT_PWSH, "pwsh.exe", "powershell.exe"];
  const seen = new Set();
  const executables = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    executables.push(candidate);
  }
  return executables;
}

function execPowerShell(executable, args) {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: CAPTURE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          error: error ?? null,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });
}

/** The script prints exactly one JSON line; tolerate stray output before it. */
function parseResultLine(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.length === 0 || !line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && "ok" in parsed) return parsed;
    } catch {
      // keep looking: a warning may have been printed as JSON-looking text
    }
  }
  return null;
}

function describeShellFailure(executable, result) {
  if (result.error !== null) {
    const code = result.error.code;
    if (code === "ENOENT") return `${executable} is not installed`;
    if (code === "ETIMEDOUT" || result.error.killed) return `${executable} timed out after ${CAPTURE_TIMEOUT_MS} ms`;
    const detail = result.stderr.trim() || result.error.message;
    return `${executable} failed: ${detail}`;
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  return `${executable} produced no result${detail.length > 0 ? `: ${detail}` : ""}`;
}

function describe(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function connectionOf(ctx) {
  return Reflect.get(ctx, "connection");
}

/**
 * Rejects requests that do not come from the DSH page itself. Mirrors the
 * fence every other host route in the composition uses.
 */
function fenced(ctx, req, res) {
  const rejection = connectionOf(ctx)?.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader("allow", allow);
  res.setHeader("content-length", 0);
  res.end();
}

/** Reads the request body, or returns null when it exceeds the size cap. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}
