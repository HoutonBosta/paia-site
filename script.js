(function () {
  "use strict";

  const fallback = {
    versionName: "1.4",
    versionCode: 5,
    minAndroid: "Android 7.0+",
    releaseDate: "2026-09-09",
    releaseNotes: "公开测试版：请从 Gitee Release 下载 APK，并在安装前核对 SHA-256。",
    apkUrl: "https://gitee.com/Houton_Bosta/paia-site/releases/download/v1.4-test/PAIA-1.4-test.apk",
    apkSize: 22721220,
    sha256: "bb5a43bf2b950a346ca2667d50d9aa654bade334b90a4e3d0adc57a05d5826ee",
    releasePageUrl: "https://gitee.com/Houton_Bosta/paia-site/releases/tag/v1.4-test",
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
    $("hero-status").textContent = data.apkUrl ? `公开测试版 ${data.versionName} · ${formatBytes(data.apkSize)}` : "当前版本正在准备发布";
    $("download-status").textContent = data.apkUrl ? "这是公开测试版；下载前建议核对 SHA-256。" : "发布 APK 后，这里的按钮会自动启用。";
    setLink($("download-link"), data.apkUrl);
    setLink($("hero-download"), data.apkUrl || "#release");
    setLink($("release-page-link"), data.releasePageUrl || data.repositoryUrl);
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
