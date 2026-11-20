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
