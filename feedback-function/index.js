/*
 * PAIA feedback relay for Alibaba Cloud Function Compute (Node.js 18+).
 *
 * The Gitee token is read from the function's environment and must never be
 * committed, placed in app-config.json, or bundled into the Android APK.
 */

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARS = 8000;
const DEFAULT_BRANCH = "master";

function responsePayload(body, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function writeResponse(resp, payload) {
  if (!resp) return;
  if (typeof resp.setStatusCode === "function") resp.setStatusCode(payload.statusCode);
  if (typeof resp.setHeader === "function") {
    for (const [name, value] of Object.entries(payload.headers)) resp.setHeader(name, value);
  }
  if (typeof resp.send === "function") {
    resp.send(payload.body);
    return;
  }
  // This branch is useful when the handler is run with a local Node adapter.
  if (typeof resp.end === "function") resp.end(payload.body);
}

function jsonResponse(resp, body, status = 200, extraHeaders = {}) {
  const payload = responsePayload(body, status, extraHeaders);
  writeResponse(resp, payload);
  return payload;
}

function requestPath(req) {
  // FC HTTP triggers expose the path as `path`, while local adapters and
  // Node-compatible runtimes commonly expose a full `url` string.
  const raw = req?.path || req?.rawPath || req?.url || req?.requestURI ||
    req?.requestContext?.http?.path || req?.requestContext?.path || "/";
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function requestMethod(req) {
  return String(
    req?.method || req?.httpMethod || req?.requestContext?.http?.method || "GET",
  ).toUpperCase();
}

function normalizeRequest(request) {
  let value = request;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return { body: value }; }
  }
  if (!value || typeof value !== "object") return {};

  // Some FC HTTP-trigger/event combinations serialize the HTTP event once
  // more (or nest it under `event`/`request`). Unwrap only when the outer
  // value does not already look like an HTTP request, so a user payload is
  // never mistaken for transport metadata.
  for (let depth = 0; depth < 3; depth += 1) {
    const looksLikeRequest = value.method || value.httpMethod || value.rawPath ||
      value.path || value.requestURI || value.requestContext || value.headers ||
      Object.prototype.hasOwnProperty.call(value, "body");
    if (looksLikeRequest) break;
    const nested = value.event ?? value.request ?? value.httpRequest;
    if (!nested || typeof nested !== "object" && typeof nested !== "string") break;
    value = nested;
    if (Buffer.isBuffer(value)) value = value.toString("utf8");
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { value = { body: value }; }
    }
  }
  return value && typeof value === "object" ? value : {};
}

async function readBody(req) {
  if (req && Object.prototype.hasOwnProperty.call(req, "body")) {
    const body = req.body;
    if (body === null || body === undefined) return "";
    // Event-style adapters expose the encoded payload as a string. Decode it
    // before the generic string branch so the JSON parser receives JSON.
    if (req.isBase64Encoded === true) return Buffer.from(String(body), "base64").toString("utf8");
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
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

function isGiteeFileResponse(result) {
  // Gitee's contents API returns HTTP 200 with [] for a missing nested path
  // in some repository configurations. Only a JSON file object means that an
  // idempotent request already exists; an array must continue to the create
  // call below.
  const parsed = result?.parsed;
  const file = parsed && !Array.isArray(parsed)
    ? (parsed.type === "file" ? parsed : parsed.content)
    : null;
  return Boolean(file) && file.type === "file" && typeof file.path === "string";
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
  if (isGiteeFileResponse(existing)) return { ok: true, reference: path, duplicate: true };
  // Treat Gitee's empty directory response as a miss, just like a 404.
  const missing = existing.response.status === 404 ||
    (existing.response.ok && Array.isArray(existing.parsed));
  if (!missing) return { error: `Gitee returned ${existing.response.status}`, status: 502 };

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
    if (isGiteeFileResponse(retry)) return { ok: true, reference: path, duplicate: true };
    return { error: `Gitee returned ${result.response.status}`, status: 502 };
  }
  if (!isGiteeFileResponse(result)) {
    return { error: "Gitee returned an unexpected response", status: 502 };
  }
  return { ok: true, reference: path };
}

async function handle(request, resp, env) {
  request = normalizeRequest(request);
  const method = requestMethod(request);
  const path = requestPath(request);

  // The Android client does not need CORS, but allowing OPTIONS makes the
  // endpoint easy to probe from the website or an API client.
  if (method === "OPTIONS") {
    return jsonResponse(resp, {}, 204, {
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, idempotency-key",
    });
  }
  if (method === "GET" && (path === "/" || path.endsWith("/health"))) {
    return jsonResponse(resp, { ok: true });
  }
  if (method !== "POST" || !path.endsWith("/v1/feedback")) {
    return jsonResponse(resp, { error: "Not found" }, 404);
  }

  const declaredLength = Number(header(request, "content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(resp, { error: "Feedback is too large" }, 413);
  }
  let raw;
  try {
    raw = await readBody(request);
  } catch (error) {
    return jsonResponse(resp, { error: error?.code === "BODY_TOO_LARGE" ? "Feedback is too large" : "Invalid request body" }, error?.code === "BODY_TOO_LARGE" ? 413 : 400);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return jsonResponse(resp, { error: "Feedback is too large" }, 413);
  }
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch {
    return jsonResponse(resp, { error: "Invalid JSON" }, 400);
  }
  const message = String(payload?.message || "").trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return jsonResponse(resp, { error: "Invalid feedback" }, 400);
  }
  const requestId = cleanRequestId(payload?.requestId || header(request, "idempotency-key"));
  try {
    const result = await storeFeedback(env, requestId, { ...payload, message });
    return jsonResponse(resp, result, result.status || 200);
  } catch (error) {
    // Do not return provider details or environment values to the device.
    console.error("PAIA feedback relay failed", error?.message || "unknown error");
    return jsonResponse(resp, { error: "Feedback relay unavailable" }, 502);
  }
}

function isResponseObject(value) {
  return Boolean(value) && ["send", "end", "setStatusCode", "setHeader", "writeHead"]
    .some((name) => typeof value[name] === "function");
}

function contextEnvironment(context) {
  const customData = context?.credentials?.customData ?? context?.customData;
  if (customData && typeof customData === "object") return customData;
  if (typeof customData === "string") {
    try {
      const parsed = JSON.parse(customData);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* custom data is optional and may be non-JSON */ }
  }
  return {};
}

// Alibaba FC can invoke a Node.js function in either of these forms:
//   HTTP response adapter: (request, response, context)
//   Event function:        (event, context, callback)
// Support both so an HTTP trigger attached to an event function returns a
// body instead of the empty 200 response produced by response-only handlers.
exports.handler = async (request, second, third) => {
  request = normalizeRequest(request);
  if (isResponseObject(second)) {
    return handle(request, second, { ...process.env, ...contextEnvironment(third) });
  }

  const callback = typeof third === "function" ? third : null;
  const result = await handle(request, null, { ...process.env, ...contextEnvironment(second) });
  if (callback) {
    callback(null, result);
    return;
  }
  return result;
};

// Exported for a small local smoke test without starting a web server.
exports._handle = handle;
exports._isGiteeFileResponse = isGiteeFileResponse;
