(() => {
  "use strict";

  window.__htjReady = true;

  const EMAIL = "homert.jonescards@gmail.com";
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

  // Discourage saving artwork: no right-click menu or dragging on protected images.
  const blockSave = (event) => {
    if (event.target instanceof Element && event.target.closest("[data-protect]")) event.preventDefault();
  };
  document.addEventListener("contextmenu", blockSave);
  document.addEventListener("dragstart", blockSave);

  const contactForm = document.querySelector("[data-contact-form]");
  if (contactForm) initContactForm(contactForm);

  initLiveContent();

  function initLiveContent() {
    const root = document.documentElement;
    const config = window.HTJ_CONFIG;
    const editables = document.querySelectorAll("[data-edit]");
    const gallery = document.querySelector("[data-gallery]");
    const footerGalleries = document.querySelector("[data-footer-galleries]");
    const done = () => root.classList.remove("content-loading");

    if (!config || !window.fetch) {
      done();
      if (gallery) showGalleryEmpty(gallery);
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

    let collections = Promise.resolve([]);
    if (gallery || footerGalleries) {
      collections = api(
        "gallery_collections?select=id,slug,title,description,theme,gallery_collection_images(count)&order=sort_order.asc,created_at.asc"
      )
        .then((rows) =>
          (Array.isArray(rows) ? rows : []).filter((row) => {
            const embed = row.gallery_collection_images;
            return Array.isArray(embed) && embed[0] && embed[0].count > 0;
          })
        )
        .catch(() => []);
    }

    if (footerGalleries) {
      collections.then((rows) => renderFooterGalleries(footerGalleries, rows));
    }

    if (gallery) {
      const images = api(
        "gallery_images?select=id,title,caption,image_path,thumb_path,width,height,gallery_collection_images(collection_id)&order=sort_order.asc,created_at.desc"
      );
      Promise.all([images, collections])
        .then(([rows, saved]) => initGallery(gallery, Array.isArray(rows) ? rows : [], saved, config))
        .catch(() => showGalleryEmpty(gallery));
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

  const galleryHref = (slug) => `/Gallery/?g=${encodeURIComponent(slug)}`;

  function renderFooterGalleries(wrap, rows) {
    const list = wrap.querySelector("[data-footer-gallery-list]");
    if (!list || !rows.length) return;
    list.replaceChildren(
      ...rows.map((row) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = galleryHref(row.slug);
        a.textContent = row.title;
        li.append(a);
        return li;
      })
    );
    wrap.hidden = false;
  }

  function showGalleryEmpty(section) {
    const empty = section.querySelector("[data-gallery-empty]");
    if (empty) empty.hidden = false;
  }

  function initGallery(section, images, collections, config) {
    if (!images.length) {
      showGalleryEmpty(section);
      return;
    }

    const INITIAL = 12;
    const main = document.querySelector("main");
    const baseTitle = document.title;
    const grid = section.querySelector("[data-gallery-grid]");
    const moreWrap = section.querySelector("[data-gallery-more]");
    const moreBtn = section.querySelector("[data-gallery-toggle]");
    const chipsNav = section.querySelector("[data-gallery-chips]");
    const chipList = section.querySelector("[data-gallery-chip-list]");
    const head = section.querySelector("[data-collection-head]");
    const headTitle = section.querySelector("[data-collection-title]");
    const headText = section.querySelector("[data-collection-description]");
    const publicUrl = (path) =>
      `${config.supabaseUrl}/storage/v1/object/public/gallery/${String(path).split("/").map(encodeURIComponent).join("/")}`;
    const altFor = (item) => item.title || "A hand-drawn sketch by Homer T. Jones";
    const inCollection = (item, id) =>
      Array.isArray(item.gallery_collection_images) && item.gallery_collection_images.some((m) => m.collection_id === id);

    const saved = collections.filter((c) => images.some((item) => inCollection(item, c.id)));
    let rows = images;

    const slugFromUrl = () => new URLSearchParams(window.location.search).get("g") || "";

    const chip = (label, href, active, theme) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "chip";
      a.href = href;
      if (active) a.setAttribute("aria-current", "page");
      if (theme) {
        a.dataset.theme = theme;
        const swatch = document.createElement("span");
        swatch.className = "chip__swatch";
        swatch.setAttribute("aria-hidden", "true");
        a.append(swatch);
      }
      a.append(document.createTextNode(label));
      li.append(a);
      return li;
    };

    const renderGrid = () => {
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
        img.draggable = false;
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

      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.textContent = `View all ${rows.length}`;
      moreWrap.hidden = rows.length <= INITIAL;
    };

    moreBtn.addEventListener("click", () => {
      const expand = moreBtn.getAttribute("aria-expanded") !== "true";
      moreBtn.setAttribute("aria-expanded", String(expand));
      grid.querySelectorAll(".gallery-item").forEach((li, i) => {
        if (i >= INITIAL) li.hidden = !expand;
      });
      moreBtn.textContent = expand ? "Show fewer" : `View all ${rows.length}`;
      if (!expand) grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const render = () => {
      let slug = slugFromUrl();
      let current = saved.find((c) => c.slug === slug) || null;
      if (slug && !current) {
        history.replaceState(null, "", "/Gallery/");
        slug = "";
      }

      if (saved.length) {
        chipList.replaceChildren(
          chip("All work", "/Gallery/", !current),
          ...saved.map((c) => chip(c.title, galleryHref(c.slug), current === c, c.theme))
        );
        chipsNav.hidden = false;
      }

      if (current) {
        main.dataset.theme = current.theme;
        headTitle.textContent = current.title;
        headText.innerHTML = formatRich(current.description || "");
        headText.hidden = !current.description;
        head.hidden = false;
        document.title = `${current.title} · ${baseTitle}`;
        rows = images.filter((item) => inCollection(item, current.id));
      } else {
        delete main.dataset.theme;
        head.hidden = true;
        document.title = baseTitle;
        rows = images;
      }
      renderGrid();
    };

    chipList.addEventListener("click", (event) => {
      const link = event.target.closest("a.chip");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      if (link.getAttribute("aria-current")) return;
      history.pushState(null, "", link.getAttribute("href"));
      render();
    });
    window.addEventListener("popstate", render);
    render();

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
    const ask = dialog.querySelector("[data-lightbox-ask]");
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
      if (ask) {
        const piece = item.title ? `a piece like \u201c${item.title}\u201d from the gallery` : "a piece like one in the gallery";
        ask.href = `/Contact/?piece=${encodeURIComponent(piece)}`;
      }
      prev.hidden = next.hidden = count.hidden = rows.length < 2;
      if (rows.length > 1) {
        preload(current + 1);
        preload(current - 1);
      }
    };

    prev.addEventListener("click", () => show(current - 1));
    next.addEventListener("click", () => show(current + 1));
    dialog.querySelector("[data-lightbox-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      const target = event.target;
      if (target === dialog || target.matches(".lightbox__frame, .lightbox__figure")) {
        dialog.close();
        return;
      }
      // The image ignores pointer events, so clicks on it land on the stage.
      if (target.matches(".lightbox__stage")) {
        const box = big.getBoundingClientRect();
        const onImage =
          event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        if (!onImage) dialog.close();
      }
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

  function initContactForm(form) {
    const body = document.querySelector("[data-contact-body]");
    const sent = document.querySelector("[data-form-sent]");
    const again = document.querySelector("[data-form-again]");
    const status = form.querySelector("[data-form-status]");
    const submit = form.querySelector('[type="submit"]');
    const label = submit.querySelector("[data-label]");
    const defaultLabel = label.textContent;
    const message = form.elements.namedItem("message");

    const piece = (new URLSearchParams(window.location.search).get("piece") || "").trim().slice(0, 160);
    if (piece && message && !message.value) {
      message.value = `Hello! I\u2019d love to ask about ${piece}.\n\n`;
    }

    const showError = (detail) => {
      const link = document.createElement("a");
      link.href = `mailto:${EMAIL}`;
      link.textContent = EMAIL;
      status.replaceChildren(
        `Sorry, your message couldn\u2019t be sent${detail ? ` (${detail})` : ""}. Please try again, or email `,
        link,
        " directly."
      );
      status.classList.add("form-status--error");
      status.hidden = false;
    };

    if (!window.fetch || !window.FormData || !body || !sent) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      label.textContent = "Sending\u2026";
      status.hidden = true;
      try {
        const response = await fetch(form.action, {
          method: "POST",
          body: new FormData(form),
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          form.reset();
          body.hidden = true;
          sent.hidden = false;
          sent.focus();
          return;
        }
        let detail = "";
        try {
          const data = await response.json();
          detail = (Array.isArray(data.errors) ? data.errors : [])
            .map((error) => error && error.message)
            .filter(Boolean)
            .join(" ");
        } catch {
          detail = "";
        }
        showError(detail);
      } catch {
        showError("");
      } finally {
        submit.disabled = false;
        label.textContent = defaultLabel;
      }
    });

    if (again) {
      again.addEventListener("click", () => {
        sent.hidden = true;
        body.hidden = false;
        status.hidden = true;
        const name = form.elements.namedItem("name");
        if (name) name.focus();
      });
    }
  }
})();
