const assert = require("node:assert/strict");
const { test } = require("node:test");

const { _handle, handler } = require("./index.js");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setStatusCode(statusCode) { this.statusCode = statusCode; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    send(body) { this.body = body; },
  };
}

test("health endpoint is available without repository credentials", async () => {
  const response = responseRecorder();
  await _handle({ method: "GET", path: "/health", headers: {} }, response, {});

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("event-function invocation returns the HTTP response body", async () => {
  const result = await handler({ httpMethod: "GET", rawPath: "/health", headers: {} }, {});

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.equal(result.isBase64Encoded, false);
});

test("event-function callback receives the HTTP response body", async () => {
  const result = await new Promise((resolve, reject) => {
    handler({ httpMethod: "GET", rawPath: "/health", headers: {} }, {}, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    }).catch(reject);
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
});

test("base64 event bodies are decoded before JSON parsing", async () => {
  const response = responseRecorder();
  const body = Buffer.from(JSON.stringify({ message: "test" }), "utf8").toString("base64");
  await _handle({
    method: "POST",
    path: "/v1/feedback",
    headers: {},
    body,
    isBase64Encoded: true,
  }, response, {});

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "Feedback repository is not configured");
});

test("oversized declared bodies are rejected before repository access", async () => {
  const response = responseRecorder();
  await _handle({
    method: "POST",
    path: "/v1/feedback",
    headers: { "content-length": String(16 * 1024 + 1) },
    body: JSON.stringify({ message: "test" }),
  }, response, {});

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error, "Feedback is too large");
});
