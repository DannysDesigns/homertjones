(() => {
  "use strict";

  window.__htjReady = true;

  const header = document.querySelector("[data-header]");
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");

  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("nav-open", open);
    };
    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 941px)").addEventListener("change", (mq) => {
      if (mq.matches) setOpen(false);
    });
  }

  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach((el) => observer.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  initLiveContent();

  function initLiveContent() {
    const root = document.documentElement;
    const config = window.HTJ_CONFIG;
    const editables = document.querySelectorAll("[data-edit]");
    const gallery = document.querySelector("[data-gallery]");
    const done = () => root.classList.remove("content-loading");

    if (!config || !window.fetch || (!editables.length && !gallery)) {
      done();
      return;
    }

    const api = (path) => {
      const url = new URL(`${config.supabaseUrl}/rest/v1/${path}`);
      url.searchParams.set("apikey", config.supabaseKey);
      return fetch(url, { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json();
      });
    };

    if (editables.length) {
      api("site_content?select=key,value")
        .then((rows) => applyContent(editables, rows))
        .catch(() => {})
        .finally(done);
    } else {
      done();
    }

    if (gallery) {
      api("gallery_images?select=id,title,caption,image_path,thumb_path,width,height&order=sort_order.asc,created_at.desc")
        .then((rows) => renderGallery(gallery, rows, config))
        .catch(() => {});
    }
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // Editable text supports *italic accents* and line breaks, nothing else.
  function formatRich(text) {
    return escapeHtml(text)
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/\r?\n/g, "<br>");
  }

  function applyContent(editables, rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    editables.forEach((el) => {
      const key = el.dataset.edit;
      if (!values.has(key)) return;
      const value = String(values.get(key) || "");
      const target = el.matches("summary") ? el.parentElement : el;
      el.innerHTML = formatRich(value);
      target.hidden = value.trim() === "";
    });
  }

  function renderGallery(section, rows, config) {
    if (!Array.isArray(rows) || !rows.length) return;

    const INITIAL = 12;
    const grid = section.querySelector("[data-gallery-grid]");
    const moreWrap = section.querySelector("[data-gallery-more]");
    const moreBtn = section.querySelector("[data-gallery-toggle]");
    const publicUrl = (path) =>
      `${config.supabaseUrl}/storage/v1/object/public/gallery/${String(path).split("/").map(encodeURIComponent).join("/")}`;
    const altFor = (item) => item.title || "A hand-drawn commission by Homer T. Jones";

    const fragment = document.createDocumentFragment();
    rows.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "gallery-item";
      li.style.setProperty("--i", String(index % INITIAL));
      if (index >= INITIAL) li.hidden = true;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-item__button";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `View ${item.title || "image"} larger`);

      const mat = document.createElement("span");
      mat.className = "gallery-item__mat";
      const img = document.createElement("img");
      img.src = publicUrl(item.thumb_path);
      img.alt = altFor(item);
      img.loading = "lazy";
      img.decoding = "async";
      if (item.width && item.height) {
        img.width = item.width;
        img.height = item.height;
      }
      mat.append(img);
      button.append(mat);

      if (item.title) {
        const title = document.createElement("span");
        title.className = "gallery-item__title";
        title.textContent = item.title;
        button.append(title);
      }

      li.append(button);
      fragment.append(li);
    });
    grid.replaceChildren(fragment);

    if (rows.length > INITIAL) {
      const label = () => {
        const expanded = moreBtn.getAttribute("aria-expanded") === "true";
        moreBtn.textContent = expanded ? "Show fewer" : `View all ${rows.length}`;
      };
      moreBtn.addEventListener("click", () => {
        const expand = moreBtn.getAttribute("aria-expanded") !== "true";
        moreBtn.setAttribute("aria-expanded", String(expand));
        grid.querySelectorAll(".gallery-item").forEach((li, i) => {
          if (i >= INITIAL) li.hidden = !expand;
        });
        label();
        if (!expand) section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      label();
      moreWrap.hidden = false;
    }

    section.hidden = false;
    document.querySelectorAll("[data-gallery-link]").forEach((el) => {
      el.hidden = false;
    });
    if (window.location.hash === "#gallery") section.scrollIntoView();

    const dialog = section.querySelector("[data-lightbox]");
    if (!dialog || typeof dialog.showModal !== "function") {
      grid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-index]");
        if (button) window.open(publicUrl(rows[Number(button.dataset.index)].image_path), "_blank", "noopener");
      });
      return;
    }

    const big = dialog.querySelector("[data-lightbox-img]");
    const count = dialog.querySelector("[data-lightbox-count]");
    const title = dialog.querySelector("[data-lightbox-title]");
    const caption = dialog.querySelector("[data-lightbox-caption]");
    const prev = dialog.querySelector("[data-lightbox-prev]");
    const next = dialog.querySelector("[data-lightbox-next]");
    let current = 0;
    let loadToken = 0;

    const preload = (index) => {
      const item = rows[(index + rows.length) % rows.length];
      new Image().src = publicUrl(item.image_path);
    };

    const show = (index) => {
      current = (index + rows.length) % rows.length;
      const item = rows[current];
      const token = ++loadToken;
      big.src = publicUrl(item.thumb_path);
      big.alt = altFor(item);
      big.classList.add("is-loading");
      const full = new Image();
      full.onload = () => {
        if (token !== loadToken) return;
        big.src = full.src;
        big.classList.remove("is-loading");
      };
      full.src = publicUrl(item.image_path);
      count.textContent = `${current + 1} / ${rows.length}`;
      title.textContent = item.title || "";
      title.hidden = !item.title;
      caption.textContent = item.caption || "";
      caption.hidden = !item.caption;
      if (rows.length > 1) {
        preload(current + 1);
        preload(current - 1);
      }
    };

    prev.hidden = next.hidden = count.hidden = rows.length < 2;
    prev.addEventListener("click", () => show(current - 1));
    next.addEventListener("click", () => show(current + 1));
    dialog.querySelector("[data-lightbox-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.matches(".lightbox__frame, .lightbox__figure, .lightbox__stage")) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") show(current - 1);
      if (event.key === "ArrowRight") show(current + 1);
    });

    let startX = null;
    dialog.addEventListener("pointerdown", (event) => {
      startX = event.pointerType === "mouse" ? null : event.clientX;
    });
    dialog.addEventListener("pointerup", (event) => {
      if (startX === null || rows.length < 2) return;
      const dx = event.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) show(dx > 0 ? current - 1 : current + 1);
    });

    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-index]");
      if (!button) return;
      show(Number(button.dataset.index));
      dialog.showModal();
    });
  }

  const form = document.querySelector("[data-order-form]");
  if (form) initOrderForm(form);

  function initOrderForm(form) {
    const MAX_BYTES = 10 * 1024 * 1024;
    const items = form.querySelectorAll('input[name="Item"]');

    const requested = (new URLSearchParams(window.location.search).get("item") || "").toLowerCase();
    if (requested) {
      const match = Array.from(items).find((input) => input.dataset.slug === requested);
      if (match) match.checked = true;
    }

    const otherWrap = form.querySelector("[data-other-item]");
    const otherInput = otherWrap && otherWrap.querySelector("input");
    const syncOther = () => {
      if (!otherWrap) return;
      const selected = form.querySelector('input[name="Item"]:checked');
      const show = Boolean(selected && selected.dataset.slug === "other");
      otherWrap.hidden = !show;
      otherInput.required = show;
      otherInput.disabled = !show;
    };
    items.forEach((input) => input.addEventListener("change", syncOther));
    syncOther();

    const dateInput = form.querySelector('input[type="date"]');
    if (dateInput) {
      const today = new Date();
      today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
      dateInput.min = today.toISOString().slice(0, 10);
    }

    const next = form.querySelector('input[name="_next"]');
    if (next && /^https?:$/.test(window.location.protocol)) {
      next.value = new URL("thank-you.html", window.location.href).href;
    }

    const fileInput = form.querySelector('input[type="file"]');
    const dropzone = form.querySelector("[data-dropzone]");
    const chosen = form.querySelector("[data-file-chosen]");
    const chosenName = form.querySelector("[data-file-name]");
    const preview = form.querySelector("[data-file-preview]");
    const removeBtn = form.querySelector("[data-file-remove]");
    const fileError = form.querySelector("[data-file-error]");
    let previewUrl = null;

    const formatSize = (bytes) =>
      bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

    const renderFile = () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.setCustomValidity("");
      fileError.textContent = "";
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (!file) {
        chosen.hidden = true;
        return;
      }
      if (file.size > MAX_BYTES) {
        const message = "That file is larger than 10 MB. Please choose a smaller photo.";
        fileInput.setCustomValidity(message);
        fileError.textContent = message;
      }
      chosenName.textContent = `${file.name} · ${formatSize(file.size)}`;
      const canPreview = /^image\/(jpeg|png|gif|webp)$/.test(file.type);
      if (canPreview) {
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
      }
      preview.hidden = !canPreview;
      chosen.hidden = false;
    };

    if (fileInput && dropzone) {
      fileInput.addEventListener("change", renderFile);
      ["dragenter", "dragover"].forEach((type) =>
        dropzone.addEventListener(type, () => dropzone.classList.add("is-dragging"))
      );
      ["dragleave", "drop"].forEach((type) =>
        dropzone.addEventListener(type, () => dropzone.classList.remove("is-dragging"))
      );
      removeBtn.addEventListener("click", () => {
        fileInput.value = "";
        renderFile();
        fileInput.focus();
      });
      renderFile();
    }

    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit.querySelector("[data-label]");
    const defaultLabel = submitLabel.textContent;

    form.addEventListener("submit", () => {
      submit.disabled = true;
      submitLabel.textContent = "Sending your request…";
    });

    window.addEventListener("pageshow", () => {
      submit.disabled = false;
      submitLabel.textContent = defaultLabel;
    });
  }
})();
