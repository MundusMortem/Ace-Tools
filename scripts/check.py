from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

root = Path(__file__).resolve().parents[1] / "dist"
class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.links.append(value)

for page in root.rglob("*.html"):
    parser = Links()
    parser.links = []
    parser.feed(page.read_text())
    for link in parser.links:
        url = urlsplit(link)
        if url.scheme or url.netloc or not url.path:
            continue
        target = (page.parent / unquote(url.path)).resolve()
        assert target.is_relative_to(root.resolve()), f"Link outside site: {link}"
        if target.is_dir():
            target = target / "index.html"
        assert target.is_file(), f"Broken link in {page.name}: {link}"
print("All local page and asset links are valid.")
