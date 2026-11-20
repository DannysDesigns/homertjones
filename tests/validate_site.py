"""Static checks for the homertjones.com site in public/."""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / "public"
FORM_ENDPOINT = "https://formsubmit.co/"
REQUIRED_PAGES = ["index.html", "order.html", "thank-you.html", "404.html"]


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []
        self.ids: set[str] = set()
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.lang = None
        self.title = ""
        self._in_title = False

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

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


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
    pages = sorted(ROOT.glob("*.html"))
    parsed = {page.name: parse(page) for page in pages}

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
                    if parts.fragment not in parsed[target.name].ids:
                        errors.append(f"{name}: {ref} points to a missing id")

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
