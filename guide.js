(() => {
  "use strict";

  const articles = [...document.querySelectorAll(".guide-article")];
  const links = [...document.querySelectorAll("[data-chapter]")];
  const sidebar = document.querySelector(".guide-sidebar");
  const menuButton = document.querySelector(".mobile-directory");
  const pagination = document.querySelector(".article-pagination");
  const content = document.getElementById("guide-content");
  const dialog = document.getElementById("image-dialog");
  const expandedImage = document.getElementById("expanded-image");
  const mobile = window.matchMedia("(max-width: 860px)");

  function setMenu(open) {
    sidebar.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  }

  function pageLink(element, article) {
    element.hidden = !article;
    if (!article) return;
    element.href = `#${article.id}`;
    element.querySelector("strong").textContent = article.querySelector("h1").textContent;
  }

  function showChapter(moveToTop) {
    const id = window.location.hash.slice(1);
    const selected = articles.find(article => article.id === id) || articles[0];
    articles.forEach(article => { article.hidden = article !== selected; });
    links.forEach(link => {
      const active = link.dataset.chapter === selected.id;
      if (active) {
        link.setAttribute("aria-current", "page");
        link.closest("details").open = true;
      } else {
        link.removeAttribute("aria-current");
      }
    });
    document.getElementById("chapter-location").textContent = `使用教程 / ${selected.dataset.group}`;
    document.title = `${selected.querySelector("h1").textContent} | PAIA 使用教程`;
    const index = articles.indexOf(selected);
    pageLink(document.getElementById("previous-chapter"), articles[index - 1]);
    pageLink(document.getElementById("next-chapter"), articles[index + 1]);
    pagination.hidden = false;
    setMenu(false);
    if (moveToTop) {
      content.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  document.body.classList.add("js-ready");
  menuButton.hidden = false;
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  window.addEventListener("hashchange", () => showChapter(true));
  mobile.addEventListener("change", () => setMenu(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("is-open")) {
      setMenu(false);
      menuButton.focus();
    }
  });
  links.forEach(link => link.addEventListener("click", () => {
    if (link.hash === window.location.hash || (!window.location.hash && link.dataset.chapter === articles[0].id)) {
      showChapter(true);
    }
  }));

  document.querySelectorAll(".guide-image-link").forEach(link => {
    link.addEventListener("click", event => {
      if (typeof dialog.showModal !== "function" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const thumbnail = link.querySelector("img");
      expandedImage.src = link.href;
      expandedImage.alt = thumbnail.alt;
      document.getElementById("image-caption").textContent = link.closest("section").querySelector("h2").textContent;
      dialog.showModal();
      dialog.scrollTop = 0;
    });
  });
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => { expandedImage.removeAttribute("src"); });
  showChapter(false);
})();
