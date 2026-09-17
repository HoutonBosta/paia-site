(function () {
  "use strict";

  if (window.location.hash === "#author") {
    window.location.replace(new URL("author.html", window.location.href).href);
    return;
  }

  const fallback = {
    versionName: "1.6.7-test",
    versionCode: 14,
    minAndroid: "Android 7.0+",
    releaseDate: "2026-09-17",
    releaseNotes: "修复实时转写临时结果未显示的问题：识别中的文字在原气泡内持续更新，最终结果替换草稿；折叠预览与复制包含最新转写；补充暂停、续录及迟到回调保护，避免旧录音的完成事件干扰新录音。实时转写仍默认关闭。沿用原签名，可覆盖升级保留本机数据，请勿先卸载。此 APK 使用 Android Debug 签名，仅用于公开测试。",
    apkUrl: "https://gitee.com/Houton_Bosta/paia-site/releases/download/v1.6.7-test/PAIA-1.6.7-test.apk",
    apkSize: 23464504,
    sha256: "e87cfa03002c11a049014f940bdcd8862e07ddf0c3a90bed45356de0b24a7c46",
    releasePageUrl: "https://gitee.com/Houton_Bosta/paia-site/releases/tag/v1.6.7-test",
    repositoryUrl: "https://github.com/HoutonBosta/paia-site"
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
