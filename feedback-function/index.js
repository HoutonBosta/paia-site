/*
 * PAIA feedback relay for Alibaba Cloud Function Compute (Node.js 18+).
 *
 * The Gitee token is read from the function's environment and must never be
 * committed, placed in app-config.json, or bundled into the Android APK.
 */

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARS = 8000;
const DEFAULT_BRANCH = "master";

function jsonResponse(resp, body, status = 200) {
  const payload = JSON.stringify(body);
  if (typeof resp.setStatusCode === "function") resp.setStatusCode(status);
  if (typeof resp.setHeader === "function") {
    resp.setHeader("content-type", "application/json; charset=utf-8");
    resp.setHeader("cache-control", "no-store");
    resp.setHeader("access-control-allow-origin", "*");
  }
  if (typeof resp.send === "function") {
    resp.send(payload);
    return;
  }
  // This branch is useful when the handler is run with a local Node adapter.
  if (typeof resp.end === "function") resp.end(payload);
}

function requestPath(req) {
  // FC HTTP triggers expose the path as `path`, while local adapters and
  // Node-compatible runtimes commonly expose a full `url` string.
  const raw = req?.path || req?.url || "/";
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

async function readBody(req) {
  if (req && Object.prototype.hasOwnProperty.call(req, "body")) {
    const body = req.body;
    if (body === null || body === undefined) return "";
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
    // Some FC adapters expose a base64-encoded HTTP event body.
    if (req.isBase64Encoded === true) return Buffer.from(String(body), "base64").toString("utf8");
    return JSON.stringify(body);
  }
  if (!req || typeof req.on !== "function") return "";
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { code: "BODY_TOO_LARGE" }));
        if (typeof req.destroy === "function") req.destroy();
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function header(req, name) {
  const headers = req?.headers || {};
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry ? entry[1] : "";
}

function cleanRequestId(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return cleaned || crypto.randomUUID();
}

function giteeSettings(env) {
  const owner = String(env.GITEE_OWNER || "").trim();
  const repository = String(env.GITEE_FEEDBACK_REPO || env.GITEE_REPO || "").trim();
  const branch = String(env.GITEE_BRANCH || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  const token = String(env.GITEE_TOKEN || "").trim();
  return { owner, repository, branch, token };
}

function feedbackPath(requestId, receivedAt) {
  return `feedback/${receivedAt.slice(0, 10)}/${requestId}.json`;
}

async function giteeRequest({ owner, repository, token, path, method = "GET", query = {}, body }) {
  const params = new URLSearchParams({ access_token: token, ...query });
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${path}?${params}`;
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep the raw response for diagnostics */ }
  return { response, text, parsed };
}

async function storeFeedback(env, requestId, payload) {
  const settings = giteeSettings(env);
  if (!settings.token || !settings.owner || !settings.repository) {
    return { error: "Feedback repository is not configured", status: 503 };
  }

  const receivedAt = new Date().toISOString();
  const path = feedbackPath(requestId, receivedAt);
  // A retry after a lost response should be idempotent. Return the original
  // reference when this request id already exists instead of creating a new
  // commit or reporting a misleading failure.
  const existing = await giteeRequest({
    ...settings,
    path: `contents/${path}`,
    query: { ref: settings.branch },
  });
  if (existing.response.ok) return { ok: true, reference: path, duplicate: true };
  if (existing.response.status !== 404) return { error: `Gitee returned ${existing.response.status}`, status: 502 };

  const storedFeedback = JSON.stringify({
    requestId,
    receivedAt,
    message: payload.message,
    app: {
      versionName: payload.versionName || "unknown",
      versionCode: payload.versionCode || "unknown",
      language: payload.language || "unknown",
    },
    device: {
      manufacturer: payload.manufacturer || "",
      model: payload.model || "",
      androidVersion: payload.androidVersion || "",
    },
  }, null, 2);
  const form = new URLSearchParams({
    access_token: settings.token,
    content: Buffer.from(storedFeedback, "utf8").toString("base64"),
    message: `Store PAIA feedback ${requestId}`,
    branch: settings.branch,
  });
  const result = await giteeRequest({
    ...settings,
    path: `contents/${path}`,
    method: "POST",
    body: form,
  });
  if (!result.response.ok) {
    // Another request may have won the race between the idempotency GET and
    // this POST. A final GET distinguishes that case from a real failure.
    const retry = await giteeRequest({
      ...settings,
      path: `contents/${path}`,
      query: { ref: settings.branch },
    });
    if (retry.response.ok) return { ok: true, reference: path, duplicate: true };
    return { error: `Gitee returned ${result.response.status}`, status: 502 };
  }
  return { ok: true, reference: path };
}

async function handle(request, resp, env) {
  const method = String(request?.method || "GET").toUpperCase();
  const path = requestPath(request);

  // The Android client does not need CORS, but allowing OPTIONS makes the
  // endpoint easy to probe from the website or an API client.
  if (method === "OPTIONS") {
    if (typeof resp.setStatusCode === "function") resp.setStatusCode(204);
    if (typeof resp.setHeader === "function") {
      resp.setHeader("access-control-allow-origin", "*");
      resp.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      resp.setHeader("access-control-allow-headers", "content-type, idempotency-key");
    }
    if (typeof resp.send === "function") resp.send("");
    return;
  }
  if (method === "GET" && (path === "/" || path.endsWith("/health"))) {
    jsonResponse(resp, { ok: true });
    return;
  }
  if (method !== "POST" || !path.endsWith("/v1/feedback")) {
    jsonResponse(resp, { error: "Not found" }, 404);
    return;
  }

  const declaredLength = Number(header(request, "content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    jsonResponse(resp, { error: "Feedback is too large" }, 413);
    return;
  }
  let raw;
  try {
    raw = await readBody(request);
  } catch (error) {
    jsonResponse(resp, { error: error?.code === "BODY_TOO_LARGE" ? "Feedback is too large" : "Invalid request body" }, error?.code === "BODY_TOO_LARGE" ? 413 : 400);
    return;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    jsonResponse(resp, { error: "Feedback is too large" }, 413);
    return;
  }
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch {
    jsonResponse(resp, { error: "Invalid JSON" }, 400);
    return;
  }
  const message = String(payload?.message || "").trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    jsonResponse(resp, { error: "Invalid feedback" }, 400);
    return;
  }
  const requestId = cleanRequestId(payload?.requestId || header(request, "idempotency-key"));
  try {
    const result = await storeFeedback(env, requestId, { ...payload, message });
    jsonResponse(resp, result, result.status || 200);
  } catch (error) {
    // Do not return provider details or environment values to the device.
    console.error("PAIA feedback relay failed", error?.message || "unknown error");
    jsonResponse(resp, { error: "Feedback relay unavailable" }, 502);
  }
}

// Alibaba FC's Node.js HTTP trigger passes (request, response, context).
exports.handler = (request, response, context) => {
  const customData = context?.credentials?.customData;
  const contextEnv = customData && typeof customData === "object" ? customData : {};
  return handle(request, response, { ...process.env, ...contextEnv });
};

// Exported for a small local smoke test without starting a web server.
exports._handle = handle;
