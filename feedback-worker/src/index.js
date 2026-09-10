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

    const title = message.split(/\r?\n/, 1)[0].slice(0, 50) || "PAIA user feedback";
    const description = [
      message,
      "",
      "---",
      "PAIA " + (payload?.versionName || "unknown") + " (" + (payload?.versionCode || "unknown") + ")",
      (payload?.manufacturer || "") + " " + (payload?.model || "") + " / Android " + (payload?.androidVersion || ""),
      "Language: " + (payload?.language || "unknown"),
      "Request: " + (payload?.requestId || request.headers.get("Idempotency-Key") || "unknown"),
    ].join("\n");

    const form = new URLSearchParams({
      access_token: env.GITEE_TOKEN,
      repo: env.GITEE_REPO,
      title,
      body: description,
    });
    const response = await fetch("https://gitee.com/api/v5/repos/" + env.GITEE_OWNER + "/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const raw = await response.text();
    if (!response.ok) return json({ error: "Gitee returned " + response.status }, 502);
    const issue = JSON.parse(raw);
    return json({ ok: true, reference: issue.number ? "Gitee #" + issue.number : null });
  },
};
