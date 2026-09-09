(function () {
  "use strict";

  const fallback = {
    versionName: "1.4",
    versionCode: 5,
    minAndroid: "Android 7.0+",
    releaseDate: "2026-09-09",
    releaseNotes: "本地优先的会议与课堂助手。APK 发布后，这里会显示本版本的详细更新说明。",
    apkUrl: "",
    apkSize: 0,
    sha256: "",
    appGalleryUrl: "",
    repositoryUrl: "https://gitee.com/Houton_Bosta/paia-site"
  };

  const $ = (id) => document.getElementById(id);
  const formatBytes = (value) => {
    const bytes = Number(value) || 0;
    if (!bytes) return "待发布";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  const formatDate = (value) => {
    if (!value) return "--";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  };
  const setLink = (element, url) => {
    if (!element) return;
    if (url && url.startsWith("#")) {
      element.href = url;
      element.removeAttribute("aria-disabled");
      element.removeAttribute("target");
      element.removeAttribute("rel");
      return;
    }
    if (url) {
      element.href = url;
      element.removeAttribute("aria-disabled");
      element.target = "_blank";
      element.rel = "noreferrer";
    } else {
      element.href = "#";
      element.setAttribute("aria-disabled", "true");
      element.removeAttribute("target");
    }
  };

  const render = (release) => {
    const data = { ...fallback, ...(release || {}) };
    $("version-name").textContent = `PAIA ${data.versionName}`;
    $("version-code").textContent = `versionCode ${data.versionCode}`;
    $("release-date").textContent = formatDate(data.releaseDate);
    $("release-notes").textContent = data.releaseNotes || "暂无更新说明";
    $("min-android").textContent = data.minAndroid || "Android 7.0+";
    $("apk-size").textContent = formatBytes(data.apkSize);
    $("sha256").textContent = data.sha256 || "发布后显示校验值";
    $("hero-status").textContent = data.apkUrl ? `当前版本 ${data.versionName} · ${formatBytes(data.apkSize)}` : "当前版本正在准备发布";
    $("download-status").textContent = data.apkUrl ? "下载前建议核对 SHA-256；安装时由 Android 系统确认。" : "发布 APK 后，这里的按钮会自动启用。";
    setLink($("download-link"), data.apkUrl);
    setLink($("hero-download"), data.apkUrl || "#release");
    setLink($("app-gallery-link"), data.appGalleryUrl);
    if (data.sha256) $("copy-hash").disabled = false;
    $("copy-hash").dataset.hash = data.sha256 || "";
    if (data.repositoryUrl) {
      $("source-link").href = data.repositoryUrl;
      $("footer-source").href = data.repositoryUrl;
    }
  };

  $("copy-hash").addEventListener("click", async () => {
    const hash = $("copy-hash").dataset.hash;
    if (!hash || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(hash);
      $("copy-hash").textContent = "已复制 SHA-256";
      window.setTimeout(() => { $("copy-hash").textContent = "复制 SHA-256"; }, 1600);
    } catch (_) {
      $("copy-hash").textContent = "复制失败，请手动选择";
    }
  });

  $("current-year").textContent = String(new Date().getFullYear());
  render(fallback);
  fetch(`release.json?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("release manifest unavailable")))
    .then(render)
    .catch(() => {
      $("hero-status").textContent = "暂时无法读取在线版本清单，页面仍可浏览";
    });
})();
