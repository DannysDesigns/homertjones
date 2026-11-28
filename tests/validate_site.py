"""Static checks for the homertjones.com site in public/."""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / "public"
FORM_ENDPOINT = "https://formspree.io/f/mzerqggy"
REQUIRED_PAGES = [
    "index.html",
    "404.html",
    "Gallery/index.html",
    "About/index.html",
    "Contact/index.html",
    "Host/index.html",
]
RETIRED_PAGES = ["order.html", "thank-you.html"]
PRIVATE_PAGES = {"404.html", "Host/index.html"}
BR = "\x00"
EDIT_KEY = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,79}$")
EDIT_ALLOWED_TAGS = {"em", "br"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []
        self.ids: set[str] = set()
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.lang = None
        self.title = ""
        self._in_title = False
        self.edit_keys: list[str] = []
        self.edit_values: dict[str, str] = {}
        self.edit_problems: list[str] = []
        self._edit_text = ""
        self._stack: list[str] = []
        self._edit_depth: int | None = None
        self._edit_key = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        self.tags.append((tag, values))
        if tag == "html":
            self.lang = values.get("lang")
        if tag == "title":
            self._in_title = True
        if "id" in values:
            self.ids.add(values["id"])
        for key in ("href", "src"):
            if key in values:
                self.refs.append(values[key])

        if self._edit_depth is not None:
            if tag not in EDIT_ALLOWED_TAGS:
                self.edit_problems.append(f"data-edit=\"{self._edit_key}\" contains <{tag}>; only text, <em>, and <br> are editable")
            self._edit_text += BR if tag == "br" else "*" if tag == "em" else ""
        if "data-edit" in values:
            if self._edit_depth is not None:
                self.edit_problems.append(f"data-edit=\"{values['data-edit']}\" is nested inside data-edit=\"{self._edit_key}\"")
            self.edit_keys.append(values["data-edit"])
            if tag not in VOID_TAGS:
                self._edit_depth = len(self._stack)
                self._edit_key = values["data-edit"]
                self._edit_text = ""
        if tag not in VOID_TAGS:
            self._stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in VOID_TAGS or tag not in self._stack:
            return
        while self._stack:
            open_tag = self._stack.pop()
            if self._edit_depth is not None and len(self._stack) <= self._edit_depth:
                self.edit_values[self._edit_key] = normalize_edit(self._edit_text)
                self._edit_depth = None
            elif self._edit_depth is not None and open_tag == "em":
                self._edit_text += "*"
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._edit_depth is not None:
            self._edit_text += data


def normalize_edit(text: str) -> str:
    lines = re.sub(r"\s+", " ", text).split(BR)
    return "\n".join(line.strip() for line in lines).strip()


def page_path(name: str) -> str:
    """Public URL path for a page file, e.g. About/index.html -> /About/."""
    return "/" + name[: -len("index.html")] if name.endswith("index.html") else "/" + name


VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


def parse(path: Path) -> PageParser:
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser


def resolve(page: Path, ref: str) -> Path:
    path = urlsplit(ref).path
    if path.startswith("/"):
        target = ROOT / path.lstrip("/")
    else:
        target = (page.parent / path).resolve()
    if path.endswith("/") or path == "":
        target = target / "index.html"
    return target


def main() -> int:
    errors: list[str] = []
    pages = sorted(ROOT.rglob("*.html"))
    parsed = {page.relative_to(ROOT).as_posix(): parse(page) for page in pages}

    for required in REQUIRED_PAGES:
        if required not in parsed:
            errors.append(f"missing page: {required}")

    sprite = (ROOT / "assets/img/icons.svg").read_text(encoding="utf-8")
    sprite_ids = set(re.findall(r'<symbol id="([^"]+)"', sprite))

    for name, page in parsed.items():
        path = ROOT / name
        if page.lang != "en":
            errors.append(f"{name}: <html> must declare lang=\"en\"")
        if not page.title.strip():
            errors.append(f"{name}: missing <title>")
        if not any(tag == "meta" and attrs.get("name") == "description" and attrs.get("content") for tag, attrs in page.tags):
            errors.append(f"{name}: missing meta description")

        for ref in page.refs:
            parts = urlsplit(ref)
            if parts.scheme in {"http", "https", "mailto", "tel"} or ref.startswith("#") and not ref[1:]:
                continue
            if ref.startswith("#"):
                if ref[1:] not in page.ids:
                    errors.append(f"{name}: anchor {ref} has no matching id")
                continue
            target = resolve(path, ref)
            if not target.exists():
                errors.append(f"{name}: broken reference {ref}")
                continue
            if parts.fragment:
                if target.name == "icons.svg":
                    if parts.fragment not in sprite_ids:
                        errors.append(f"{name}: missing icon #{parts.fragment}")
                elif target.suffix == ".html":
                    target_key = target.resolve().relative_to(ROOT.resolve()).as_posix()
                    if parts.fragment not in parsed[target_key].ids:
                        errors.append(f"{name}: {ref} points to a missing id")

        seen: set[str] = set()
        for key in page.edit_keys:
            if not EDIT_KEY.match(key):
                errors.append(f"{name}: data-edit key {key!r} is not a valid content key")
            if key in seen:
                errors.append(f"{name}: data-edit key {key!r} is used more than once")
            seen.add(key)
        errors.extend(f"{name}: {problem}" for problem in page.edit_problems)

    home = parsed.get("index.html")
    if home and not home.edit_keys:
        errors.append("index.html: no data-edit fields found for the Host editor")

    for retired in RETIRED_PAGES:
        if retired in parsed:
            errors.append(f"{retired}: retired page should be removed (requests go by email now)")

    config = (ROOT / "assets/js/site-config.js").read_text(encoding="utf-8")
    if re.search(r"service_role|sb_secret_", config):
        errors.append("assets/js/site-config.js: contains a secret Supabase key")

    for source in [*ROOT.rglob("*.html"), *ROOT.rglob("*.js")]:
        if "formsubmit.co" in source.read_text(encoding="utf-8"):
            errors.append(f"{source.relative_to(ROOT).as_posix()}: still references the old FormSubmit service")

    # Keys used on more than one page (like the footer) are edited once, so their defaults must match.
    defaults: dict[str, tuple[str, str]] = {}
    for name, page in parsed.items():
        for key, value in page.edit_values.items():
            if key in defaults and defaults[key][1] != value:
                errors.append(f"{name}: data-edit key {key!r} differs from its text on {defaults[key][0]}")
            defaults.setdefault(key, (name, value))

    host_js = (ROOT / "Host/host.js").read_text(encoding="utf-8")
    block = re.search(r"const CONTENT_PAGES = \[(.*?)\];", host_js, re.S)
    if not block:
        errors.append("Host/host.js: CONTENT_PAGES list not found")
    else:
        listed = re.findall(r'path: "([^"]+)"', block.group(1))
        for path in listed:
            if not resolve(ROOT / "index.html", path).exists():
                errors.append(f"Host/host.js: CONTENT_PAGES lists {path}, which does not exist")
        for name, page in parsed.items():
            if page.edit_keys and name not in PRIVATE_PAGES and page_path(name) not in listed:
                errors.append(f"{name}: has editable text but {page_path(name)} is missing from CONTENT_PAGES in Host/host.js")

    contact = parsed.get("Contact/index.html")
    if contact:
        forms = [attrs for tag, attrs in contact.tags if tag == "form"]
        if len(forms) != 1:
            errors.append("Contact/index.html: expected exactly one form")
        else:
            form = forms[0]
            if form.get("action") != FORM_ENDPOINT:
                errors.append(f"Contact/index.html: form action must be {FORM_ENDPOINT}")
            if form.get("method", "").upper() != "POST":
                errors.append("Contact/index.html: form must use POST")
        names = {attrs.get("name") for tag, attrs in contact.tags if tag in {"input", "select", "textarea"}}
        for field in ("name", "email", "message", "_subject", "_gotcha"):
            if field not in names:
                errors.append(f"Contact/index.html: missing form field {field}")

    gallery = parsed.get("Gallery/index.html")
    if gallery:
        grids = [attrs for tag, attrs in gallery.tags if "data-gallery-grid" in attrs]
        if not grids or any("data-protect" not in attrs for attrs in grids):
            errors.append("Gallery/index.html: the gallery grid must be marked data-protect")

    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    for loc in re.findall(r"<loc>https://homertjones\.com(/[^<]*)</loc>", sitemap):
        if not resolve(ROOT / "index.html", loc).exists():
            errors.append(f"sitemap.xml: {loc} does not exist")

    cname = (ROOT / "CNAME").read_text(encoding="utf-8").strip()
    if cname != "homertjones.com":
        errors.append(f"CNAME should be homertjones.com, found {cname!r}")

    if errors:
        print("Site validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"Site validation passed for {len(parsed)} pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
