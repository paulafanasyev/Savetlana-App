/*
 * АИКО · защита от копирования контента.
 * © 2026 Афанасьев Павел Петрович. Все права защищены.
 *
 * - При копировании длинного текста со страницы к нему добавляется источник и ссылка.
 *   Поля ввода и короткие фрагменты (номер заказа, трек, адрес) копируются как есть.
 * - Картинки, аватар Светланы и графики нельзя сохранить правой кнопкой или
 *   перетаскиванием.
 * - Исключение: картинка внутри ссылки (карточка товара, объявления, магазина).
 *   Там меню и долгое нажатие нужны покупателю, чтобы открыть товар в новой вкладке
 *   или скопировать ссылку, поэтому их не трогаем.
 * Выделение текста не запрещено: это ломает доступность и работу с заказами.
 *
 * Плюс для материалов чек-поинта (/checkpoint/): слайды 1280×720 подгоняются так,
 * чтобы текст всегда помещался (на любом шрифте и в телефоне), и телефон не
 * раздувает шрифт («font boosting»).
 */
(function () {
  if (window.__aikoCopyGuard) return;
  window.__aikoCopyGuard = true;

  var NOTICE = "АИКО © 2026 Афанасьев Павел Петрович. Копирование без разрешения запрещено.";
  var MIN_LEN = 120;

  function editable(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
  }

  document.addEventListener("copy", function (e) {
    try {
      if (editable(document.activeElement)) return;
      var sel = window.getSelection ? String(window.getSelection()) : "";
      if (sel.length < MIN_LEN || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", sel + "\n\n— Источник: " + location.href + "\n" + NOTICE);
    } catch (err) {
      /* не мешаем обычному копированию */
    }
  });

  function media(t) {
    return t && t.closest ? t.closest("img, picture, svg, canvas, video") : null;
  }

  /** Картинка внутри ссылки: меню ссылки оставляем («Открыть в новой вкладке», «Копировать ссылку»). */
  function insideLink(t) {
    return !!(t && t.closest && t.closest("a[href]"));
  }

  document.addEventListener("contextmenu", function (e) {
    if (media(e.target) && !insideLink(e.target)) e.preventDefault();
  });

  document.addEventListener("dragstart", function (e) {
    if (media(e.target) && !insideLink(e.target)) e.preventDefault();
  });

  var style = document.createElement("style");
  style.textContent =
    "img,svg,canvas,video{-webkit-user-drag:none;-webkit-touch-callout:none}" +
    "a[href] img,a[href] svg{-webkit-touch-callout:default}";
  (document.head || document.documentElement).appendChild(style);

  /* ---------- Подгонка слайдов чек-поинта ---------- */
  if (!/^\/checkpoint\//.test(location.pathname)) return;

  var fitCss = document.createElement("style");
  fitCss.textContent = "html{-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;text-size-adjust:100%}";
  (document.head || document.documentElement).appendChild(fitCss);

  function isAbs(el) {
    var p = getComputedStyle(el).position;
    return p === "absolute" || p === "fixed";
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  /** Текст вылез за слайд или наехал на прижатые к низу подписи (источники, реплика Светланы). */
  function overflowing(s, flow, abs) {
    if (s.scrollHeight > s.clientHeight + 2 || s.scrollWidth > s.clientWidth + 2) return true;
    var sr = s.getBoundingClientRect();
    if (!sr.height) return false;
    var pad = parseFloat(getComputedStyle(s).paddingBottom) || 0;
    var k = sr.height / (s.offsetHeight || sr.height);
    var floor = sr.bottom - pad * k * 0.5;
    for (var i = 0; i < flow.length; i++) {
      var r = flow[i].getBoundingClientRect();
      if (r.bottom > floor + 1) return true;
      for (var j = 0; j < abs.length; j++) {
        var a = abs[j].getBoundingClientRect();
        var gap = 6 * k;
        if (overlaps(r, { left: a.left, right: a.right, top: a.top - gap, bottom: a.bottom })) return true;
      }
    }
    return false;
  }

  function fitSlide(s) {
    var flow = [], abs = [];
    for (var i = 0; i < s.children.length; i++) {
      var c = s.children[i];
      c.style.zoom = "";
      (isAbs(c) ? abs : flow).push(c);
    }
    var f = 1, n = 0;
    while (n < 16 && overflowing(s, flow, abs)) {
      n++;
      f = Math.round((f - 0.025) * 1000) / 1000;
      for (var m = 0; m < flow.length; m++) flow[m].style.zoom = String(f);
    }
    s.setAttribute("data-fit", String(f));
  }

  var timer = 0;
  function fitAll() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var slides = document.querySelectorAll("section.slide");
      for (var i = 0; i < slides.length; i++) {
        try { fitSlide(slides[i]); } catch (e) { /* слайд остаётся как есть */ }
      }
    }, 60);
  }

  function start() {
    fitAll();
    if (window.MutationObserver && document.body) {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var nodes = list[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var nd = nodes[j];
            if (nd.nodeType === 1 && (nd.matches("section.slide") || nd.querySelector("section.slide"))) {
              fitAll();
              return;
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.addEventListener("load", fitAll);
  window.addEventListener("resize", fitAll);
  window.addEventListener("beforeprint", function () {
    var slides = document.querySelectorAll("section.slide");
    for (var i = 0; i < slides.length; i++) {
      try { fitSlide(slides[i]); } catch (e) { /* ignore */ }
    }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
})();
