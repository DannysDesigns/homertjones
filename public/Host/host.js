(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const config = window.HTJ_CONFIG;
  const loadingView = $('[data-view="loading"]');

  if (!config || !window.supabase || typeof window.supabase.createClient !== "function") {
    loadingView.textContent = "The studio couldn't load. Check your internet connection and refresh the page.";
    return;
  }

  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "htj-host-auth",
    },
  });

  const GALLERY_BUCKET = "gallery";
  const ORIGINALS_BUCKET = "gallery-originals";
  const ORIGINAL_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "image/avif",
  ]);
  const EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
  };
  const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
  const LARGE_EDGE = 2000;
  const THUMB_EDGE = 800;
  const MAT_COLOR = "#fbf8f2";

  const state = {
    items: [],
    fields: [],
    saved: new Map(),
    contentLoaded: false,
    contentLoading: null,
    uploads: 0,
    uploadQueue: Promise.resolve(),
    orderTimer: null,
    orderChain: Promise.resolve(),
    dashboardReady: false,
  };

  // ---------- Small helpers ----------

  function showView(name) {
    $$("[data-view]").forEach((view) => {
      view.hidden = view.dataset.view !== name;
    });
    $("[data-signed-in]").hidden = name !== "dashboard";
  }

  function setUserEmail(email) {
    $$("[data-user-email]").forEach((el) => {
      el.textContent = email || "";
    });
  }

  function field(form, name) {
    return form.elements.namedItem(name);
  }

  function setFormError(form, message) {
    const el = $("[data-form-error]", form);
    if (el) el.textContent = message || "";
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label || "Working…";
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  let toastTimer = null;
  function toast(message, kind = "info") {
    const el = $("[data-toast]");
    el.textContent = message;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, kind === "error" ? 8000 : 3800);
  }

  function friendly(error) {
    if (!error) return "Something went wrong. Please try again.";
    const message = String(error.message || error.error_description || error);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return "Couldn't reach the server. Check your internet connection and try again.";
    }
    if (/jwt|refresh token|not authenticated|session/i.test(message)) {
      return "Your sign-in has expired. Please sign out and sign in again.";
    }
    if (/row-level security|permission denied|violates.*policy|unauthorized/i.test(message)) {
      return "This account isn't allowed to make that change.";
    }
    if (/exceeded the maximum allowed size|payload too large/i.test(message)) {
      return "That file is too large.";
    }
    return message;
  }

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  function publicUrl(path) {
    return sb.storage.from(GALLERY_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function slug(text) {
    return String(text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function confirmDialog({ title, text, ok = "Delete" }) {
    const dialog = $("[data-confirm-dialog]");
    $("[data-confirm-title]", dialog).textContent = title;
    $("[data-confirm-text]", dialog).textContent = text;
    $("[data-confirm-ok]", dialog).textContent = ok;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }

  // ---------- Sign in, passwords, access ----------

  async function route() {
    const { data, error } = await sb.auth.getSession();
    const session = data && data.session;
    if (error || !session) {
      showSignIn();
      return;
    }

    const user = session.user;
    setUserEmail(user.email);

    if (user.user_metadata && user.user_metadata.must_change_password) {
      showView("password");
      field($('[data-password-form="first"]'), "password").focus();
      return;
    }

    const admin = await sb.rpc("is_site_admin");
    if (admin.error) {
      if (/jwt|session|refresh/i.test(admin.error.message || "")) {
        await sb.auth.signOut({ scope: "local" });
        showSignIn("Your sign-in has expired. Please sign in again.");
        return;
      }
      showView("loading");
      loadingView.textContent = `The studio couldn't load. ${friendly(admin.error)}`;
      return;
    }
    if (!admin.data) {
      showView("denied");
      return;
    }

    openDashboard();
  }

  function showSignIn(message) {
    const form = $("[data-signin-form]");
    setFormError(form, message || "");
    showView("signin");
    const email = field(form, "email");
    (email.value ? field(form, "password") : email).focus();
  }

  $("[data-signin-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = field(form, "email").value.trim().toLowerCase();
    const password = field(form, "password").value;
    if (!email || !password) {
      setFormError(form, "Please enter your email and password.");
      return;
    }
    setFormError(form, "");
    const button = $('[type="submit"]', form);
    setBusy(button, true, "Signing in…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(button, false);
    if (error) {
      setFormError(
        form,
        /invalid login credentials/i.test(error.message)
          ? "That email and password don't match. Please try again."
          : friendly(error)
      );
      field(form, "password").select();
      return;
    }
    field(form, "password").value = "";
    route();
  });

  $$("[data-password-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = field(form, "password").value;
      const confirm = field(form, "confirm").value;
      if (password.length < 10) {
        setFormError(form, "Please use at least 10 characters.");
        return;
      }
      if (password !== confirm) {
        setFormError(form, "The two passwords don't match.");
        return;
      }
      setFormError(form, "");
      const button = $('[type="submit"]', form);
      setBusy(button, true, "Saving…");
      const { error } = await sb.auth.updateUser({ password, data: { must_change_password: false } });
      setBusy(button, false);
      if (error) {
        setFormError(
          form,
          /different from the old/i.test(error.message)
            ? "Please choose a password that's different from your current one."
            : friendly(error)
        );
        return;
      }
      form.reset();
      if (form.dataset.passwordForm === "first") {
        toast("Password saved. Welcome to your studio.");
        route();
      } else {
        toast("Your password has been updated.");
      }
    });
  });

  $$("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (hasUnsavedWork() && !window.confirm("You have unsaved changes. Sign out anyway?")) return;
      await sb.auth.signOut({ scope: "local" });
      resetState();
      showSignIn();
    });
  });

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      setTimeout(() => {
        resetState();
        if ($('[data-view="signin"]').hidden) showSignIn();
      }, 0);
    }
  });

  function resetState() {
    state.items = [];
    state.fields = [];
    state.saved = new Map();
    state.contentLoaded = false;
    state.contentLoading = null;
    $("[data-gallery-grid]").replaceChildren();
    $("[data-content-form]").replaceChildren();
    $("[data-savebar]").hidden = true;
    setUserEmail("");
  }

  function hasUnsavedWork() {
    return isContentDirty() || state.uploads > 0 || state.orderTimer !== null;
  }

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // ---------- Dashboard & tabs ----------

  const tabs = $$("[data-tab]");

  function openDashboard() {
    showView("dashboard");
    if (!state.dashboardReady) {
      state.dashboardReady = true;
      initGallery();
    }
    selectTab(tabFromHash() || currentTab() || "gallery", false);
    loadGallery();
  }

  function tabFromHash() {
    const name = window.location.hash.slice(1);
    return tabs.some((tab) => tab.dataset.tab === name) ? name : null;
  }

  function currentTab() {
    const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    return active ? active.dataset.tab : null;
  }

  function selectTab(name, focus) {
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    $$("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    if (window.location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
    if (name === "content") loadContent();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab, false));
    tab.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      selectTab(next.dataset.tab, true);
    });
  });

  // ---------- Gallery ----------

  const grid = $("[data-gallery-grid]");
  const template = $("[data-item-template]");
  const downloadAllButton = $("[data-download-all]");

  function initGallery() {
    if (window.Sortable) {
      window.Sortable.create(grid, {
        animation: 180,
        delay: 150,
        delayOnTouchOnly: true,
        filter: "button",
        preventOnFilter: false,
        ghostClass: "is-ghost",
        chosenClass: "is-chosen",
        dragClass: "is-dragging",
        onEnd: (event) => {
          if (event.oldIndex === event.newIndex) return;
          const [moved] = state.items.splice(event.oldIndex, 1);
          state.items.splice(event.newIndex, 0, moved);
          renumber();
          scheduleOrderSave();
        },
      });
    }

    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const li = button.closest("[data-id]");
      const index = state.items.findIndex((item) => item.id === li.dataset.id);
      if (index < 0) return;
      const item = state.items[index];
      const action = button.dataset.action;
      if (action === "earlier") moveItem(index, index - 1, action);
      if (action === "later") moveItem(index, index + 1, action);
      if (action === "edit") openEdit(item);
      if (action === "download") downloadOne(item, button);
      if (action === "delete") deleteItem(item);
    });

    downloadAllButton.addEventListener("click", () => downloadAll(downloadAllButton));

    const input = $("[data-upload-input]");
    const drop = $("[data-upload-drop]");
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.value = "";
      if (files.length) queueUploads(files);
    });
    ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, () => drop.classList.add("is-dragging")));
    ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-dragging")));

    const editForm = $("[data-edit-form]");
    editForm.addEventListener("submit", saveEdit);
    $("[data-dialog-cancel]", editForm).addEventListener("click", () => $("[data-edit-dialog]").close());
  }

  async function loadGallery() {
    try {
      state.items = unwrap(
        await sb
          .from("gallery_images")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
      );
      renderGrid();
    } catch (error) {
      toast(`The gallery couldn't be loaded. ${friendly(error)}`, "error");
    }
  }

  function buildItem(item) {
    const li = template.content.firstElementChild.cloneNode(true);
    li.dataset.id = item.id;
    const img = $("[data-item-img]", li);
    img.src = publicUrl(item.thumb_path);
    if (item.width && item.height) {
      img.width = item.width;
      img.height = item.height;
    }
    updateItemText(li, item);
    return li;
  }

  function updateItemText(li, item) {
    const title = $("[data-item-title]", li);
    title.textContent = item.title || "Untitled";
    title.classList.toggle("is-empty", !item.title);
    const meta = $("[data-item-meta]", li);
    meta.textContent = item.caption || "No caption";
    meta.classList.toggle("is-empty", !item.caption);
    $("[data-item-img]", li).alt = item.title || "Untitled gallery image";
  }

  function renderGrid() {
    grid.replaceChildren(...state.items.map(buildItem));
    renumber();
  }

  function renumber() {
    const items = Array.from(grid.children);
    items.forEach((li, index) => {
      $("[data-item-pos]", li).textContent = String(index + 1);
      $('[data-action="earlier"]', li).disabled = index === 0;
      $('[data-action="later"]', li).disabled = index === items.length - 1;
    });
    const count = state.items.length;
    $("[data-gallery-empty]").hidden = count > 0;
    $("[data-gallery-count]").textContent = count
      ? `${count} ${count === 1 ? "image" : "images"} on the homepage`
      : "";
    downloadAllButton.disabled = count === 0;
  }

  function moveItem(from, to, action) {
    if (to < 0 || to >= state.items.length) return;
    const [moved] = state.items.splice(from, 1);
    state.items.splice(to, 0, moved);
    const node = grid.children[from];
    const reference = to < from ? grid.children[to] : grid.children[to].nextSibling;
    grid.insertBefore(node, reference);
    renumber();
    const button = $(`[data-action="${action}"]`, node);
    (button.disabled ? $('[data-action="edit"]', node) : button).focus();
    node.classList.remove("is-moved");
    void node.offsetWidth;
    node.classList.add("is-moved");
    scheduleOrderSave();
  }

  function setOrderStatus(text) {
    $("[data-order-status]").textContent = text;
  }

  function scheduleOrderSave() {
    setOrderStatus("Saving the new order…");
    clearTimeout(state.orderTimer);
    state.orderTimer = setTimeout(() => {
      state.orderTimer = null;
      saveOrder();
    }, 500);
  }

  function saveOrder() {
    const ids = state.items.map((item) => item.id);
    state.orderChain = state.orderChain.then(async () => {
      const { error } = await sb.rpc("reorder_gallery_images", { ordered_ids: ids });
      if (error) {
        setOrderStatus("");
        toast(`The new order couldn't be saved. ${friendly(error)}`, "error");
        return;
      }
      state.items.forEach((item, index) => {
        item.sort_order = index + 1;
      });
      setOrderStatus("Order saved. The homepage shows the same order.");
    });
    return state.orderChain;
  }

  // ----- Uploading -----

  function queueUploads(files) {
    const list = $("[data-upload-list]");
    const jobs = files.map((file) => {
      const row = document.createElement("li");
      row.className = "host-upload";
      row.dataset.state = "waiting";
      const thumb = document.createElement("span");
      thumb.className = "host-upload__thumb";
      if (/^image\/(jpeg|png|gif|webp|avif)$/i.test(file.type)) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = URL.createObjectURL(file);
        img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
        thumb.append(img);
      }
      const name = document.createElement("span");
      name.className = "host-upload__name";
      name.textContent = file.name;
      const status = document.createElement("span");
      status.className = "host-upload__status";
      status.textContent = "Waiting…";
      row.append(thumb, name, status);
      list.append(row);
      return { file, row, status };
    });

    state.uploads += 1;
    state.uploadQueue = state.uploadQueue.then(() => runUploads(jobs)).finally(() => {
      state.uploads -= 1;
    });
  }

  async function runUploads(jobs) {
    const lowest = state.items.reduce((min, item) => Math.min(min, item.sort_order), 1);
    let insertAt = 0;
    let added = 0;

    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const report = (text, stateName = "working") => {
        job.row.dataset.state = stateName;
        job.status.textContent = text;
      };
      try {
        const item = await uploadOne(job.file, lowest - (jobs.length - i), report);
        state.items.splice(insertAt, 0, item);
        grid.insertBefore(buildItem(item), grid.children[insertAt] || null);
        insertAt += 1;
        added += 1;
        renumber();
        report("Added", "done");
        setTimeout(() => job.row.remove(), 2500);
      } catch (error) {
        report(friendly(error), "error");
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "text-btn";
        dismiss.textContent = "Dismiss";
        dismiss.addEventListener("click", () => job.row.remove());
        job.row.append(dismiss);
      }
    }

    if (added) {
      await saveOrder();
      toast(`${added} ${added === 1 ? "photo" : "photos"} added to your gallery.`);
    }
  }

  function normalizedType(file) {
    const type = (file.type || "").toLowerCase().replace("image/jpg", "image/jpeg");
    if (type) return type;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const byExt = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif", avif: "image/avif" };
    return byExt[ext] || "";
  }

  function isHeic(file) {
    return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  }

  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(
          new Error(
            isHeic(file)
              ? "This browser can't open HEIC photos. Try Safari, or save the photo as a JPG first."
              : "This file couldn't be opened as a picture."
          )
        );
      };
      img.src = url;
    });
  }

  function drawScaled(source, sourceWidth, sourceHeight, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = MAT_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function toJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be prepared for the web."))),
        "image/jpeg",
        quality
      );
    });
  }

  async function uploadOne(file, sortOrder, report) {
    if (file.size > MAX_ORIGINAL_BYTES) {
      throw new Error("This photo is larger than 50 MB. Please choose a smaller version.");
    }
    report("Preparing…");
    const decoded = await decodeImage(file);
    let large;
    let thumb;
    let width;
    let height;
    try {
      const { img } = decoded;
      if (!img.naturalWidth || !img.naturalHeight) throw new Error("This file couldn't be opened as a picture.");
      const largeCanvas = drawScaled(img, img.naturalWidth, img.naturalHeight, LARGE_EDGE);
      width = largeCanvas.width;
      height = largeCanvas.height;
      large = await toJpeg(largeCanvas, 0.88);
      const thumbCanvas = drawScaled(largeCanvas, width, height, THUMB_EDGE);
      thumb = await toJpeg(thumbCanvas, 0.84);
      largeCanvas.width = largeCanvas.height = thumbCanvas.width = thumbCanvas.height = 0;
    } finally {
      decoded.release();
    }

    const id = uuid();
    const type = normalizedType(file);
    const keepOriginal = ORIGINAL_TYPES.has(type);
    const originalType = keepOriginal ? type : "image/jpeg";
    const paths = {
      original: `${id}/original.${EXTENSIONS[originalType]}`,
      large: `${id}/large.jpg`,
      thumb: `${id}/thumb.jpg`,
    };

    report("Uploading…");
    const uploads = [
      [ORIGINALS_BUCKET, paths.original, keepOriginal ? file : large, originalType],
      [GALLERY_BUCKET, paths.large, large, "image/jpeg"],
      [GALLERY_BUCKET, paths.thumb, thumb, "image/jpeg"],
    ];
    const results = await Promise.allSettled(
      uploads.map(([bucket, path, body, contentType]) =>
        sb.storage
          .from(bucket)
          .upload(path, body, { contentType, cacheControl: "31536000", upsert: false })
          .then(unwrap)
      )
    );
    const failed = results.find((result) => result.status === "rejected");
    const stored = uploads.filter((_, index) => results[index].status === "fulfilled");

    try {
      if (failed) throw failed.reason;
      report("Saving…");
      return unwrap(
        await sb
          .from("gallery_images")
          .insert({
            id,
            title: "",
            caption: "",
            image_path: paths.large,
            thumb_path: paths.thumb,
            original_path: paths.original,
            original_name: file.name.slice(0, 255),
            original_type: originalType,
            original_size: keepOriginal ? file.size : large.size,
            width,
            height,
            sort_order: sortOrder,
          })
          .select()
          .single()
      );
    } catch (error) {
      await removeStored(stored.map(([bucket, path]) => [bucket, path]));
      throw error;
    }
  }

  async function removeStored(entries) {
    const byBucket = new Map();
    entries.forEach(([bucket, path]) => {
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(path);
    });
    await Promise.allSettled(
      Array.from(byBucket, ([bucket, paths]) => sb.storage.from(bucket).remove(paths))
    );
  }

  // ----- Editing details -----

  let editing = null;

  function openEdit(item) {
    editing = item;
    const dialog = $("[data-edit-dialog]");
    const form = $("[data-edit-form]");
    field(form, "title").value = item.title || "";
    field(form, "caption").value = item.caption || "";
    setFormError(form, "");
    const preview = $("[data-edit-preview]", dialog);
    preview.src = publicUrl(item.thumb_path);
    preview.alt = item.title || "Selected gallery image";
    dialog.showModal();
    field(form, "title").focus();
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    const title = field(form, "title").value.trim();
    const caption = field(form, "caption").value.trim();
    const button = $('[type="submit"]', form);
    setBusy(button, true, "Saving…");
    try {
      const updated = unwrap(
        await sb.from("gallery_images").update({ title, caption }).eq("id", editing.id).select().single()
      );
      Object.assign(editing, updated);
      const li = grid.querySelector(`[data-id="${editing.id}"]`);
      if (li) updateItemText(li, editing);
      $("[data-edit-dialog]").close();
      toast("Image details saved.");
    } catch (error) {
      setFormError(form, friendly(error));
    } finally {
      setBusy(button, false);
    }
  }

  // ----- Deleting -----

  async function deleteItem(item) {
    const name = item.title ? `“${item.title}”` : "This image";
    const confirmed = await confirmDialog({
      title: "Delete this image?",
      text: `${name} will be removed from the website and its files deleted. This can't be undone.`,
      ok: "Delete image",
    });
    if (!confirmed) return;
    try {
      const deleted = unwrap(await sb.from("gallery_images").delete().eq("id", item.id).select("id"));
      if (!deleted || !deleted.length) throw new Error("The image couldn't be deleted.");
      await removeStored([
        [GALLERY_BUCKET, item.image_path],
        [GALLERY_BUCKET, item.thumb_path],
        [ORIGINALS_BUCKET, item.original_path],
      ]);
      state.items = state.items.filter((entry) => entry.id !== item.id);
      const li = grid.querySelector(`[data-id="${item.id}"]`);
      if (li) li.remove();
      renumber();
      toast("Image deleted.");
    } catch (error) {
      toast(`The image couldn't be deleted. ${friendly(error)}`, "error");
    }
  }

  // ----- Downloading -----

  function extensionOf(path) {
    const match = /\.([a-z0-9]+)$/i.exec(path || "");
    return match ? match[1].toLowerCase() : "jpg";
  }

  function downloadName(item, index) {
    const base = slug(item.title) || slug((item.original_name || "").replace(/\.[^.]+$/, "")) || "homer-t-jones";
    const prefix = typeof index === "number" ? `${String(index + 1).padStart(2, "0")}-` : "";
    return `${prefix}${base}.${extensionOf(item.original_path)}`;
  }

  async function fetchOriginal(item) {
    const { data, error } = await sb.storage.from(ORIGINALS_BUCKET).download(item.original_path);
    if (!error && data) return { blob: data, name: null };
    const response = await fetch(publicUrl(item.image_path));
    if (!response.ok) throw error || new Error("The file couldn't be downloaded.");
    return { blob: await response.blob(), name: "jpg" };
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function downloadOne(item, button) {
    button.disabled = true;
    try {
      const { blob, name } = await fetchOriginal(item);
      const filename = downloadName(item);
      saveBlob(blob, name ? filename.replace(/\.[^.]+$/, `.${name}`) : filename);
    } catch (error) {
      toast(`The download didn't work. ${friendly(error)}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function downloadAll(button) {
    const items = state.items.slice();
    if (!items.length) return;
    const label = button.textContent;
    button.disabled = true;
    try {
      const files = [];
      for (let i = 0; i < items.length; i += 1) {
        button.textContent = `Preparing ${i + 1} of ${items.length}…`;
        const { blob, name } = await fetchOriginal(items[i]);
        const filename = downloadName(items[i], i);
        files.push({
          name: name ? filename.replace(/\.[^.]+$/, `.${name}`) : filename,
          data: new Uint8Array(await blob.arrayBuffer()),
          date: new Date(items[i].created_at),
        });
      }
      button.textContent = "Creating zip…";
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(makeZip(files), `homer-t-jones-gallery-${stamp}.zip`);
      toast(`Downloaded ${files.length} ${files.length === 1 ? "image" : "images"}.`);
    } catch (error) {
      toast(`The download didn't finish. ${friendly(error)}`, "error");
    } finally {
      button.textContent = label;
      button.disabled = state.items.length === 0;
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = Number.isNaN(date.getTime()) ? new Date() : date;
    const year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // Minimal "stored" (uncompressed) zip; photos are already compressed.
  function makeZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const crc = crc32(file.data);
      const size = file.data.length;
      const { time, date } = dosDateTime(file.date);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local, name, file.data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true);
      entry.setUint16(30, 0, true);
      entry.setUint16(32, 0, true);
      entry.setUint16(34, 0, true);
      entry.setUint16(36, 0, true);
      entry.setUint32(38, 0, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);

      offset += 30 + name.length + size;
    });

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  // ---------- Main page text ----------

  const contentForm = $("[data-content-form]");
  const savebar = $("[data-savebar]");

  function toEditable(el) {
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, " ");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      if (tag === "br") return "\n";
      const inner = Array.from(node.childNodes).map(walk).join("");
      return tag === "em" || tag === "i" ? `*${inner.trim()}*` : inner;
    };
    return Array.from(el.childNodes)
      .map(walk)
      .join("")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim();
  }

  function normalizeValue(value) {
    return value.replace(/\r\n?/g, "\n").trim();
  }

  function loadContent() {
    if (state.contentLoaded) return Promise.resolve();
    if (state.contentLoading) return state.contentLoading;
    const loading = $("[data-content-loading]");
    loading.hidden = false;
    loading.textContent = "Loading your homepage text…";

    state.contentLoading = Promise.all([
      fetch("/index.html", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("The homepage couldn't be read.");
        return response.text();
      }),
      sb.from("site_content").select("key,value").then(unwrap),
    ])
      .then(([html, rows]) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        state.fields = $$("[data-edit]", doc).map((el) => {
          const group = el.closest("[data-edit-group]");
          return {
            key: el.dataset.edit,
            label: el.dataset.editLabel || el.dataset.edit,
            group: group ? group.dataset.editGroup : "Other",
            defaultValue: toEditable(el),
          };
        });
        state.saved = new Map(rows.map((row) => [row.key, row.value]));
        renderContentForm();
        state.contentLoaded = true;
        loading.hidden = true;
      })
      .catch((error) => {
        loading.textContent = `Your homepage text couldn't be loaded. ${friendly(error)}`;
      })
      .finally(() => {
        state.contentLoading = null;
      });

    return state.contentLoading;
  }

  function savedValue(f) {
    return state.saved.has(f.key) ? state.saved.get(f.key) : f.defaultValue;
  }

  function fitRows(textarea) {
    const lines = textarea.value.split("\n");
    const wrapped = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 78)), 0);
    textarea.rows = Math.min(12, Math.max(1, wrapped));
  }

  function renderContentForm() {
    const groups = new Map();
    state.fields.forEach((f) => {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    });

    const fragment = document.createDocumentFragment();
    groups.forEach((fields, groupName) => {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "host-group";
      const legend = document.createElement("legend");
      legend.textContent = groupName;
      fieldset.append(legend);

      fields.forEach((f) => {
        const id = `content-${f.key.replace(/[^a-z0-9]+/g, "-")}`;
        const wrap = document.createElement("div");
        wrap.className = "field host-field";
        wrap.dataset.key = f.key;

        const head = document.createElement("div");
        head.className = "host-field__head";
        const label = document.createElement("label");
        label.className = "label";
        label.htmlFor = id;
        label.textContent = f.label;
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "text-btn";
        reset.textContent = "Restore original";
        reset.hidden = true;
        head.append(label, reset);

        const control = document.createElement("textarea");
        control.className = "control";
        control.id = id;
        control.name = f.key;
        control.maxLength = 4000;
        control.spellcheck = true;
        control.value = savedValue(f);
        fitRows(control);

        const note = document.createElement("p");
        note.className = "hint host-field__note";
        note.id = `${id}-note`;
        control.setAttribute("aria-describedby", note.id);

        const original = document.createElement("p");
        original.className = "host-field__original";
        original.hidden = true;
        const originalLabel = document.createElement("span");
        originalLabel.textContent = "Original: ";
        const originalText = document.createElement("span");
        originalText.textContent = f.defaultValue;
        original.append(originalLabel, originalText);

        control.addEventListener("input", () => {
          fitRows(control);
          refreshField(f);
          refreshSavebar();
        });
        reset.addEventListener("click", () => {
          control.value = f.defaultValue;
          fitRows(control);
          refreshField(f);
          refreshSavebar();
          control.focus();
        });

        wrap.append(head, control, note, original);
        fieldset.append(wrap);
        f.control = control;
        f.wrap = wrap;
        f.reset = reset;
        f.note = note;
        f.original = original;
        refreshField(f);
      });

      fragment.append(fieldset);
    });

    contentForm.replaceChildren(fragment);
    refreshSavebar();
  }

  function refreshField(f) {
    const value = normalizeValue(f.control.value);
    const dirty = value !== savedValue(f);
    const changed = value !== f.defaultValue;
    f.wrap.classList.toggle("is-dirty", dirty);
    f.wrap.classList.toggle("is-changed", changed);
    f.reset.hidden = !changed;
    f.original.hidden = !changed;
    f.note.textContent = value === "" ? "Empty: this line is hidden on the homepage." : dirty ? "Not saved yet." : "";
  }

  function isContentDirty() {
    return state.fields.some((f) => f.control && normalizeValue(f.control.value) !== savedValue(f));
  }

  function refreshSavebar(message) {
    const dirtyCount = state.fields.filter((f) => f.control && normalizeValue(f.control.value) !== savedValue(f)).length;
    if (message) {
      $("[data-save-status]").textContent = message;
      savebar.hidden = false;
      savebar.classList.add("is-saved");
      return;
    }
    savebar.classList.remove("is-saved");
    savebar.hidden = dirtyCount === 0;
    $("[data-save-status]").textContent = `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`;
    $("[data-content-save]").disabled = dirtyCount === 0;
    $("[data-content-discard]").disabled = dirtyCount === 0;
  }

  async function saveContent() {
    const upserts = [];
    const deletes = [];
    state.fields.forEach((f) => {
      const value = normalizeValue(f.control.value);
      const stored = state.saved.has(f.key) ? state.saved.get(f.key) : null;
      if (value === f.defaultValue) {
        if (stored !== null) deletes.push(f.key);
      } else if (value !== stored) {
        upserts.push({ key: f.key, value });
      }
    });
    if (!upserts.length && !deletes.length) {
      refreshSavebar();
      return;
    }

    const button = $("[data-content-save]");
    setBusy(button, true, "Saving…");
    try {
      if (upserts.length) unwrap(await sb.from("site_content").upsert(upserts, { onConflict: "key" }));
      if (deletes.length) unwrap(await sb.from("site_content").delete().in("key", deletes));
      upserts.forEach((row) => state.saved.set(row.key, row.value));
      deletes.forEach((key) => state.saved.delete(key));
      state.fields.forEach((f) => {
        f.control.value = savedValue(f);
        fitRows(f.control);
        refreshField(f);
      });
      setBusy(button, false);
      toast("Saved. Your homepage is updated.");
      refreshSavebar("Saved. Your homepage is updated.");
      setTimeout(() => {
        if (!isContentDirty()) refreshSavebar();
      }, 2500);
    } catch (error) {
      setBusy(button, false);
      refreshSavebar();
      toast(`Your changes weren't saved. ${friendly(error)}`, "error");
    }
  }

  $("[data-content-save]").addEventListener("click", saveContent);
  $("[data-content-discard]").addEventListener("click", () => {
    state.fields.forEach((f) => {
      f.control.value = savedValue(f);
      fitRows(f.control);
      refreshField(f);
    });
    refreshSavebar();
  });
  contentForm.addEventListener("submit", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && currentTab() === "content" && !$('[data-view="dashboard"]').hidden) {
      event.preventDefault();
      if (isContentDirty()) saveContent();
    }
  });

  // ---------- Start ----------

  route().catch((error) => {
    showView("loading");
    loadingView.textContent = `The studio couldn't load. ${friendly(error)}`;
  });
})();
