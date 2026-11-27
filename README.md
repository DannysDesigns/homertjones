# Homer T. Jones

The website for [homertjones.com](https://homertjones.com): commissioned, hand-drawn sketches on postcards, plates, and other keepsakes. It is a static site deployed to GitHub Pages.

## Local preview

```bash
python -m http.server 4173 --directory public
```

Then open `http://localhost:4173`.

## Validation

```bash
python tests/validate_site.py
```

This checks links, icons, page metadata, and the commission form. The same check runs in GitHub Actions before every deployment.

## Editing content

Most homepage words and the gallery are edited by the artist at [homertjones.com/Host](https://homertjones.com/Host/) (see below). Developer edits:

- **Homepage text defaults**: every editable line in `public/index.html` carries a `data-edit` key. The HTML text is the default; anything saved in the Host studio overrides it. Keep these elements to plain text, `<em>`, and `<br>` (the validator enforces this), and give new ones a unique key plus `data-edit-label`.
- **Items**: featured items and the "And beyond" grid are in `public/index.html`. Item choices on the form are in `public/order.html`. Each homepage link such as `order.html?item=mug` preselects the form option with the matching `data-slug`.
- **Styles**: `public/assets/css/styles.css`. Colors and fonts are CSS variables at the top of the file. The Host studio adds `public/Host/host.css`.
- **Icons**: line-art icons are SVG symbols in `public/assets/img/icons.svg`.

## Host studio (`/Host`)

`https://homertjones.com/Host/` is a private page where site hosts can:

- **Gallery**: upload photos (resized in the browser to a 2000px display copy and an 800px thumbnail; the untouched original is kept privately), drag or use the arrows to reorder, add a title and caption, download one original or all of them as a zip, and delete.
- **Main page**: change any homepage text. `*asterisks*` show words in gold italics, Enter starts a new line, and an empty box hides that line. "Restore original" returns to the wording in `index.html`.
- **Account**: change the password.

The homepage reads the gallery and text from Supabase when it loads, so changes appear without a redeploy. The Gallery section and its navigation links stay hidden until the first photo is uploaded. If Supabase is unreachable, the page falls back to the text in the HTML.

### Supabase

The project is `whueerfuwpdmnfbnsrpe`. `public/assets/js/site-config.js` holds its URL and **publishable** key, which are safe to publish. Never put a secret or `service_role` key in this repository.

`supabase/schema.sql` creates everything and is safe to re-run:

| Object | Purpose |
|--------|---------|
| `site_admins` | Allowlist of user IDs that may edit. |
| `gallery_images` | Title, caption, order, and file paths. Anyone can read; only admins can write. |
| `site_content` | Homepage text overrides keyed by `data-edit`. Anyone can read; only admins can write. |
| `reorder_gallery_images(uuid[])` | Saves a new gallery order in one call. |
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

## Commission requests (FormSubmit)

The form on `order.html` posts to [FormSubmit](https://formsubmit.co), which emails each request to `dannysdesignsri@gmail.com`, including the attached reference photo (up to 10 MB).

1. **Activate the form once.** Submit a test request from the live site. FormSubmit sends an activation email to the inbox; click **Activate Form**. Requests are not delivered until this is done.
2. **Hide the email address (recommended).** After activation, FormSubmit provides a random alias. Replace `dannysdesignsri@gmail.com` in the form `action` with that alias, for example `https://formsubmit.co/abc123...`.
3. **Change the inbox later.** Update the form `action` in `public/order.html` and repeat the activation.

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
