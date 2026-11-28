# Homer T. Jones

The website for [homertjones.com](https://homertjones.com): hand-drawn sketches on postcards, plates, and other keepsakes. It is a static site deployed to GitHub Pages. There is no shop or checkout; visitors email the artist or send a message from the Contact page.

| Page | File | What it holds |
|------|------|---------------|
| `/` | `public/index.html` | Welcome, buttons to the other pages, and the subjects strip. |
| `/Gallery/` | `public/Gallery/index.html` | All pictures, plus seasonal and holiday saved galleries at `/Gallery/?g=<slug>`. |
| `/About/` | `public/About/index.html` | Meet the Artist, what she makes, the process, and FAQ. |
| `/Contact/` | `public/Contact/index.html` | Email address and the message form. `?piece=...` prefills the message. |
| `/Host/` | `public/Host/` | Private studio (see below). |

`public/404.html` sends old or lowercase addresses (`/about`, `/gallery`, `/order.html`, `/gallery/<slug>`, and so on) to the right page.

## Local preview

```bash
python -m http.server 4173 --directory public
```

Then open `http://localhost:4173`.

## Validation

```bash
python tests/validate_site.py
```

This checks links, icons, page metadata, the contact form, editable text keys (including that shared footer text matches on every page and every editable page is listed in `CONTENT_PAGES` in `public/Host/host.js`), and the sitemap. The same check runs in GitHub Actions before every deployment.

## Editing content

The words on every page and the gallery are edited by the artist at [homertjones.com/Host](https://homertjones.com/Host/) (see below). Developer edits:

- **Text defaults**: every editable line carries a `data-edit` key and a `data-edit-label`. The HTML text is the default; anything saved in the Host studio overrides it. Keep these elements to plain text, `<em>`, and `<br>` (the validator enforces this). Keys must be unique within a page. A key used on several pages (the footer's `footer.about` and `footer.tagline`) must have the same text everywhere; the studio edits it once under "Every page". A new page with editable text must be added to `CONTENT_PAGES` in `public/Host/host.js`.
- **Styles**: `public/assets/css/styles.css`. The warm terracotta and sage palette and the fonts are CSS variables at the top of the file. Saved-gallery colour themes (`clay`, `sage`, `harvest`, `cranberry`, `pine`, `blush`) are the `[data-theme]` rules. The Host studio adds `public/Host/host.css`.
- **Icons**: line-art icons are SVG symbols in `public/assets/img/icons.svg`.

## Host studio (`/Host`)

`https://homertjones.com/Host/` is a private page where site hosts can:

- **Pictures**: upload photos, drag or use the arrows to reorder, add a title and caption, choose which saved galleries a picture is in, download one original or all of them as a zip, and delete. Each upload is resized in the browser to a 2000px display copy and an 800px thumbnail, and both get a faint diagonal "© Homer T. Jones / HOMERTJONES.COM" watermark. The untouched original is kept privately, so downloads are unmarked.
- **Saved galleries**: seasonal and holiday collections with a name, description, colour theme, and web address (`/Gallery/?g=<slug>`). Choose their pictures, reorder them, hide them, or delete them (the pictures stay in the main gallery). A saved gallery appears on the Gallery page and in the footer only while it is shown and has at least one picture.
- **Page text**: change the words on any page. Pick a page, then edit. `*asterisks*` show words in terracotta italics, Enter starts a new line, and an empty box hides that line. "Restore original" returns to the wording in the HTML.
- **Account**: change the password.

Pages read the gallery and text from Supabase when they load, so changes appear without a redeploy. If Supabase is unreachable, pages fall back to the text in the HTML and the Gallery shows its "coming soon" message.

Gallery images block right-click saving and dragging (`data-protect`); together with the watermark this discourages copying, though no website can fully prevent screenshots.

### Supabase

The project is `whueerfuwpdmnfbnsrpe`. `public/assets/js/site-config.js` holds its URL and **publishable** key, which are safe to publish. Never put a secret or `service_role` key in this repository.

`supabase/schema.sql` creates everything and is safe to re-run:

| Object | Purpose |
|--------|---------|
| `site_admins` | Allowlist of user IDs that may edit. |
| `gallery_images` | Title, caption, order, and file paths. Anyone can read; only admins can write. |
| `gallery_collections` | Saved galleries (slug, title, description, theme, shown/hidden, order). Visitors see only shown ones. |
| `gallery_collection_images` | Which pictures are in which saved gallery. |
| `site_content` | Text overrides keyed by `data-edit`. Anyone can read; only admins can write. |
| `reorder_gallery_images(uuid[])` | Saves a new gallery order in one call. |
| `reorder_gallery_collections(uuid[])` | Saves a new saved-gallery order. |
| `set_collection_images(uuid, uuid[])`, `set_image_collections(uuid, uuid[])` | Replace a saved gallery's pictures, or a picture's saved galleries. |
| Storage `gallery` | Public display copies and thumbnails. |
| Storage `gallery-originals` | Private full-resolution uploads. |

Apply it with the Supabase CLI (`supabase link --project-ref whueerfuwpdmnfbnsrpe`, then `supabase db query --linked -f supabase/schema.sql`) or paste it into the dashboard's SQL editor.

### Hosts and passwords

Hosts sign in with an email and password. Supabase's built-in email is not set up, so there is no "forgot password" email; an administrator resets passwords instead.

- **Add a host**: in the dashboard, go to **Authentication > Users > Add user**, choose **Create new user**, enter the email and a temporary password, and tick **Auto Confirm User**. Then run in the SQL editor:

  ```sql
  insert into public.site_admins (user_id, note)
  select id, email from auth.users where email = 'new.host@example.com';
  ```

- **Reset a password**: in **Authentication > Users**, open the user's menu and choose to set a new password, then share it with them. To make them choose their own on the next sign-in, also run:

  ```sql
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": true}'
  where email = 'host@example.com';
  ```

- **Remove a host**: `delete from public.site_admins where user_id = (select id from auth.users where email = 'host@example.com');` (and optionally delete the user).
- **Recommended**: turn off **Allow new users to sign up** in **Authentication > Sign In / Providers**. Strangers who sign up still cannot edit anything, but there is no reason to let them create accounts.

### Keeping Supabase awake

Free Supabase projects pause after a week without traffic. `.github/workflows/keepalive.yml` makes a small public read every three days. GitHub turns off scheduled workflows after 60 days without commits; if that happens, re-enable it from the repository's **Actions** tab. A paused project can be restored from the Supabase dashboard.

## Contact form (Formspree)

There is no shop. Visitors email `homert.jonescards@gmail.com`, or use the form on `/Contact/`, which posts to [Formspree](https://formspree.io) form `mzerqggy`. Messages are delivered to the email address that owns that Formspree form.

- **Confirm the form once.** The first message sent from the live site triggers a Formspree confirmation email; confirm it so later messages are delivered.
- The form sends with JavaScript and shows a thank-you note in place; without JavaScript it falls back to Formspree's own page. `_gotcha` is a spam honeypot.
- **Change the inbox** in the Formspree dashboard, or point the form `action` in `public/Contact/index.html` (and `FORM_ENDPOINT` in `tests/validate_site.py`) at a different form.

## Hosting and domain

GitHub Actions publishes `public/` to GitHub Pages on every push to `main`. The custom domain is `homertjones.com`.

DNS records at the domain registrar:

| Type  | Name  | Value                     |
|-------|-------|---------------------------|
| A     | `@`   | `185.199.108.153`         |
| A     | `@`   | `185.199.109.153`         |
| A     | `@`   | `185.199.110.153`         |
| A     | `@`   | `185.199.111.153`         |
| AAAA  | `@`   | `2606:50c0:8000::153`     |
| AAAA  | `@`   | `2606:50c0:8001::153`     |
| AAAA  | `@`   | `2606:50c0:8002::153`     |
| AAAA  | `@`   | `2606:50c0:8003::153`     |
| CNAME | `www` | `dannysdesigns.github.io` |

After DNS resolves, turn on **Enforce HTTPS** in the repository's **Settings > Pages**.
