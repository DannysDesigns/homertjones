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

- **Placeholder blurbs**: search for `PLACEHOLDER BLURB` in `public/index.html`. Replace the hero introduction and the "About Homer T. Jones" section.
- **Items**: featured items and the "And beyond" grid are in `public/index.html`. Item choices on the form are in `public/order.html`. Each homepage link such as `order.html?item=mug` preselects the form option with the matching `data-slug`.
- **Styles**: `public/assets/css/styles.css`. Colors and fonts are CSS variables at the top of the file.
- **Icons**: line-art icons are SVG symbols in `public/assets/img/icons.svg`.

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
