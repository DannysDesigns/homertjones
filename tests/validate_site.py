"""Static checks for the homertjones.com site in public/."""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / "public"
FORM_ENDPOINT = "https://formsubmit.co/"
REQUIRED_PAGES = ["index.html", "order.html", "thank-you.html", "404.html", "Host/index.html"]
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
        self.edit_problems: list[str] = []
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

        if self._edit_depth is not None and tag not in EDIT_ALLOWED_TAGS:
            self.edit_problems.append(f"data-edit=\"{self._edit_key}\" contains <{tag}>; only text, <em>, and <br> are editable")
        if "data-edit" in values:
            if self._edit_depth is not None:
                self.edit_problems.append(f"data-edit=\"{values['data-edit']}\" is nested inside data-edit=\"{self._edit_key}\"")
            self.edit_keys.append(values["data-edit"])
            if tag not in VOID_TAGS:
                self._edit_depth = len(self._stack)
                self._edit_key = values["data-edit"]
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
                self._edit_depth = None
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


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

    config = (ROOT / "assets/js/site-config.js").read_text(encoding="utf-8")
    if re.search(r"service_role|sb_secret_", config):
        errors.append("assets/js/site-config.js: contains a secret Supabase key")

    order = parsed.get("order.html")
    if order:
        forms = [attrs for tag, attrs in order.tags if tag == "form"]
        if len(forms) != 1:
            errors.append("order.html: expected exactly one form")
        else:
            form = forms[0]
            if not form.get("action", "").startswith(FORM_ENDPOINT):
                errors.append("order.html: form action must post to FormSubmit")
            if form.get("method", "").upper() != "POST":
                errors.append("order.html: form must use POST")
            if form.get("enctype") != "multipart/form-data":
                errors.append("order.html: form must use multipart/form-data for photo uploads")
        names = {attrs.get("name") for tag, attrs in order.tags if tag in {"input", "select", "textarea"}}
        for field in ("_next", "_subject", "_honey", "email", "Name", "Item", "Description", "attachment"):
            if field not in names:
                errors.append(f"order.html: missing form field {field}")
        slugs = {attrs.get("data-slug") for tag, attrs in order.tags if tag == "input" and attrs.get("name") == "Item"}
        for page_name, page in parsed.items():
            for ref in page.refs:
                match = re.match(r"(?:/)?order\.html\?item=([a-z-]+)", ref)
                if match and match.group(1) not in slugs:
                    errors.append(f"{page_name}: {ref} does not match an item option")

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
