/*
 * АИКО · защита от копирования контента.
 * © 2026 Афанасьев Павел Петрович. Все права защищены.
 *
 * - При копировании длинного текста со страницы к нему добавляется источник и ссылка.
 *   Поля ввода и короткие фрагменты (номер заказа, трек, адрес) копируются как есть.
 * - Картинки, аватар Светланы и графики нельзя сохранить правой кнопкой или
 *   перетаскиванием.
 * Выделение текста не запрещено: это ломает доступность и работу с заказами.
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

  document.addEventListener("contextmenu", function (e) {
    if (media(e.target)) e.preventDefault();
  });

  document.addEventListener("dragstart", function (e) {
    if (media(e.target)) e.preventDefault();
  });

  var style = document.createElement("style");
  style.textContent = "img,svg,canvas,video{-webkit-user-drag:none;-webkit-touch-callout:none}";
  (document.head || document.documentElement).appendChild(style);
})();
