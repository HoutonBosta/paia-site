const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, idempotency-key",
        },
      });
    }
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
    ).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const date = receivedAt.slice(0, 10);
    const path = "feedback/" + date + "/" + requestId + ".json";
    const branch = env.GITEE_BRANCH || "main";
    const repository = env.GITEE_FEEDBACK_REPO || env.GITEE_REPO;
    if (!env.GITEE_OWNER || !repository) return json({ error: "Feedback repository is not configured" }, 503);

    // A mobile client may retry after a lost response. Check the immutable
    // request path first so a retry returns the original reference instead of
    // creating a second Gitee commit.
    const existing = await fetch(
      "https://gitee.com/api/v5/repos/" + env.GITEE_OWNER + "/" + repository + "/contents/" + path +
        "?access_token=" + encodeURIComponent(env.GITEE_TOKEN) + "&ref=" + encodeURIComponent(branch),
    );
    if (existing.ok) return json({ ok: true, reference: path, duplicate: true });
    if (existing.status !== 404) return json({ error: "Gitee returned " + existing.status }, 502);
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
      branch,
    });
    const response = await fetch(
      "https://gitee.com/api/v5/repos/" + env.GITEE_OWNER + "/" + repository + "/contents/" + path,
      {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      const retry = await fetch(
        "https://gitee.com/api/v5/repos/" + env.GITEE_OWNER + "/" + repository + "/contents/" + path +
          "?access_token=" + encodeURIComponent(env.GITEE_TOKEN) + "&ref=" + encodeURIComponent(branch),
      );
      if (retry.ok) return json({ ok: true, reference: path, duplicate: true });
      return json({ error: "Gitee returned " + response.status }, 502);
    }
    return json({ ok: true, reference: path });
  },
};
