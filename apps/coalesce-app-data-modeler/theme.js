// Follows the Coalesce theme. Inside Coalesce (a same-origin iframe) it copies the page's
// <html data-theme> ("light" | "dark") and keeps it in sync when the user switches. Opened on its
// own, it uses the Coalesce UI's saved choice (localStorage "coalesce-theme", same origin under
// coa serve), where "system" or no choice follows the OS. Loaded in <head> so there is no flash.
(function () {
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  let host = null;
  try {
    if (window.parent !== window) host = window.parent.document.documentElement;
  } catch {} // cross-origin parent: not Coalesce

  function resolve() {
    if (host?.hasAttribute("data-theme")) return host.getAttribute("data-theme") === "dark" ? "dark" : "light";
    let saved = null;
    try {
      saved = localStorage.getItem("coalesce-theme");
    } catch {}
    if (saved === "light" || saved === "dark") return saved;
    return media.matches ? "dark" : "light";
  }
  const apply = () => (root.dataset.theme = resolve());
  apply();
  if (host) new MutationObserver(apply).observe(host, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", apply);
  addEventListener("storage", (e) => e.key === "coalesce-theme" && apply());
})();
