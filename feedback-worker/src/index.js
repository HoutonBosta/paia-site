const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/feedback") {
      return json({ error: "Not found" }, 404);
    }
    if (!env.GITEE_TOKEN) return json({ error: "Server is not configured" }, 503);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 16384) return json({ error: "Feedback is too large" }, 413);
    const payload = await request.json().catch(() => null);
    const message = String(payload?.message || "").trim();
    if (!message || message.length > 8000) return json({ error: "Invalid feedback" }, 400);

    const requestId = String(
      payload?.requestId || request.headers.get("Idempotency-Key") || crypto.randomUUID(),
    ).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const receivedAt = new Date().toISOString();
    const date = receivedAt.slice(0, 10);
    const path = "feedback/" + date + "/" + requestId + ".json";
    const storedFeedback = JSON.stringify({
      requestId,
      receivedAt,
      message,
      app: {
        versionName: payload?.versionName || "unknown",
        versionCode: payload?.versionCode || "unknown",
        language: payload?.language || "unknown",
      },
      device: {
        manufacturer: payload?.manufacturer || "",
        model: payload?.model || "",
        androidVersion: payload?.androidVersion || "",
      },
    }, null, 2);

    const form = new URLSearchParams({
      access_token: env.GITEE_TOKEN,
      content: btoa(unescape(encodeURIComponent(storedFeedback))),
      message: "Store PAIA feedback " + requestId,
      branch: env.GITEE_BRANCH || "main",
    });
    const repository = env.GITEE_FEEDBACK_REPO || env.GITEE_REPO;
    if (!env.GITEE_OWNER || !repository) return json({ error: "Feedback repository is not configured" }, 503);
    const response = await fetch(
      "https://gitee.com/api/v5/repos/" + env.GITEE_OWNER + "/" + repository + "/contents/" + path,
      {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      },
    );
    const raw = await response.text();
    if (!response.ok) return json({ error: "Gitee returned " + response.status }, 502);
    return json({ ok: true, reference: path });
  },
};
