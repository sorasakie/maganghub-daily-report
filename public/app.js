(function () {
  "use strict";

  var SECTIONS = ["uraian", "pembelajaran", "kendala"];
  var SECTION_TITLES = {
    uraian: "Uraian Aktivitas",
    pembelajaran: "Pembelajaran yang Diperoleh",
    kendala: "Kendala yang Dialami"
  };

  var form = document.getElementById("report-form");
  var keywordsEl = document.getElementById("keywords");
  var generateBtn = document.getElementById("generate-btn");
  var regenAllBtn = document.getElementById("regen-all-btn");
  var formError = document.getElementById("form-error");
  var emptyState = document.getElementById("empty-state");
  var results = document.getElementById("results");
  var hasResults = false;
  var busy = false;

  // theme toggle: light is the default, dark is an explicit choice
  var themeToggle = document.getElementById("theme-toggle");
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function syncThemeButton() {
    themeToggle.setAttribute("aria-pressed", currentTheme() === "dark" ? "true" : "false");
  }
  themeToggle.addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    syncThemeButton();
  });
  syncThemeButton();

  function tone() {
    var checked = form.querySelector('input[name="tone"]:checked');
    return checked ? checked.value : "formal";
  }

  function keywords() {
    return keywordsEl.value.trim();
  }

  function length() {
    var checked = form.querySelector('input[name="length"]:checked');
    return checked ? checked.value : "default";
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.classList.add("show");
  }
  function clearFormError() {
    formError.classList.remove("show");
    formError.textContent = "";
  }

  function setButtonBusy(btn, label) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + label;
  }
  function setButtonIdle(btn, label) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">' + label + "</span>";
  }

  function cardEl(key) {
    return results.querySelector('.card[data-key="' + key + '"]');
  }

  function render(data) {
    SECTIONS.forEach(function (key) {
      if (typeof data[key] === "string") {
        cardEl(key).querySelector("[data-field]").textContent = data[key];
      }
    });
    if (!hasResults) {
      hasResults = true;
      emptyState.style.display = "none";
      results.classList.add("show", "animate");
      regenAllBtn.hidden = false;
      // clear entrance state so later updates do not reanimate
      setTimeout(function () { results.classList.remove("animate"); }, 700);
    }
  }

  function chat(body) {
    return fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.error) {
          throw new Error(data.error || "Permintaan gagal. Coba lagi.");
        }
        return data;
      });
    });
  }

  function currentBody(regenerate) {
    var body = { keywords: keywords(), tone: tone(), length: length() };
    if (regenerate) body.regenerate = regenerate;
    return body;
  }

  // build all three sections
  function generateAll() {
    if (busy) return;
    if (!keywords()) {
      showFormError("Tulis kata kunci kegiatan dulu.");
      keywordsEl.focus();
      return;
    }
    clearFormError();
    busy = true;
    setButtonBusy(generateBtn, "Menyusun…");
    chat(currentBody(null)).then(function (data) {
      render(data);
    }).catch(function (err) {
      showFormError(err.message || "Terjadi kesalahan. Coba lagi.");
    }).then(function () {
      busy = false;
      setButtonIdle(generateBtn, hasResults ? "Buat laporan" : "Buat laporan");
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    generateAll();
  });

  regenAllBtn.addEventListener("click", generateAll);

  // handle copy and regenerate for each card
  results.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var card = btn.closest(".card");
    var key = card.getAttribute("data-key");
    if (btn.getAttribute("data-action") === "copy") {
      copyCard(card, btn);
    } else {
      regenCard(card, key);
    }
  });

  function copyCard(card, btn) {
    var text = card.querySelector("[data-field]").textContent;
    if (!text) return;
    var done = function () {
      var label = btn.querySelector(".btn-label");
      btn.classList.add("copied");
      label.textContent = "Tersalin";
      setTimeout(function () {
        btn.classList.remove("copied");
        label.textContent = "Salin";
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text); done();
      });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (err) {}
    document.body.removeChild(ta);
  }

  function regenCard(card, key) {
    if (card.classList.contains("busy")) return;
    if (!keywords()) {
      showFormError("Tulis kata kunci kegiatan dulu.");
      keywordsEl.focus();
      return;
    }
    clearFormError();
    card.querySelector("[data-error]").classList.remove("show");
    card.classList.add("busy");

    var hint = "tulis ulang dengan sudut berbeda";
    // include the section title so the backend rewrites only that one
    chat(currentBody(SECTION_TITLES[key] + " — " + hint))
      .then(function (data) {
        if (typeof data[key] === "string" && data[key]) {
          card.querySelector("[data-field]").textContent = data[key];
        }
      })
      .catch(function (err) {
        var box = card.querySelector("[data-error]");
        box.textContent = err.message || "Gagal menulis ulang. Coba lagi.";
        box.classList.add("show");
      })
      .then(function () {
        card.classList.remove("busy");
      });
  }
})();