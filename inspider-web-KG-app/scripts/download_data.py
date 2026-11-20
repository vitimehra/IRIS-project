"""Download DATA_TARBALL_URL, with optional GitHub auth for private repos.

GitHub Release URLs redirect to a signed CDN. Forwarding Authorization there
returns 404, so auth is kept only for github.com / api.github.com.
Private release assets are fetched via the Releases API, not the browser URL.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

UA = "inspider-railway-bootstrap"
OUT = "/tmp/inspider-data.tar.gz"
API_VERSION = "2022-11-28"
RELEASE_DOWNLOAD = re.compile(
    r"^https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)"
    r"/releases/download/(?P<tag>[^/]+)/(?P<name>[^/]+)/?$"
)


class StripAuthOnHop(urllib.request.HTTPRedirectHandler):
    """Keep Bearer tokens on GitHub; drop them on CDN / S3 redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        host = (urlparse(new.full_url).hostname or "").lower()
        if host in {"github.com", "www.github.com", "api.github.com"}:
            return new
        for hdr in ("Authorization", "authorization"):
            new.headers.pop(hdr, None)
            if hasattr(new, "unredirected_hdrs"):
                new.unredirected_hdrs.pop(hdr, None)
        return new


def _headers(token: str, accept: str) -> dict[str, str]:
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "X-GitHub-Api-Version": API_VERSION,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(StripAuthOnHop)


def _read(url: str, headers: dict[str, str], dest=None) -> bytes | None:
    req = urllib.request.Request(url, headers=headers)
    with _opener().open(req, timeout=600) as resp:
        if dest is None:
            return resp.read()
        with open(dest, "wb") as fh:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
        return None


def _resolve_release_asset(url: str, token: str) -> str:
    """Turn /releases/download/TAG/FILE into the API asset URL GitHub expects."""
    m = RELEASE_DOWNLOAD.match(url)
    if not m or not token:
        return url
    owner, repo, tag, name = m.group("owner", "repo", "tag", "name")
    meta_url = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}"
    print(f"Resolving release {tag} via GitHub API...")
    raw = _read(meta_url, _headers(token, "application/vnd.github+json"))
    data = json.loads(raw)
    assets = data.get("assets") or []
    asset = next((a for a in assets if a.get("name") == name), None)
    if asset is None:
        names = ", ".join(a.get("name", "?") for a in assets) or "(none)"
        raise FileNotFoundError(
            f"Release {tag!r} has no asset named {name!r}. Assets on the release: {names}"
        )
    print(f"Asset {name} id={asset['id']} size={asset.get('size'):,} bytes")
    return asset["url"]


def main() -> int:
    url = (os.environ.get("DATA_TARBALL_URL") or "").strip()
    if not url:
        print("DATA_TARBALL_URL is empty.", file=sys.stderr)
        return 1
    token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    if token:
        print("Downloading DATA_TARBALL_URL with GitHub token...")
    else:
        print("Downloading DATA_TARBALL_URL (no token; private GitHub URLs will 404)...")
    parsed = urlparse(url)
    print(f"GET {parsed.scheme}://{parsed.netloc}{parsed.path}")

    try:
        url = _resolve_release_asset(url, token)
        _read(url, _headers(token, "application/octet-stream"), dest=OUT)
    except urllib.error.HTTPError as e:
        print(f"Download failed: HTTP {e.code} {e.reason}", file=sys.stderr)
        if e.code in {401, 403, 404}:
            print(
                "For a private repo the token needs Contents: Read on that repository. "
                "Fine-grained PATs must include this repo; classic PATs need the repo scope. "
                "Do not use a token that only has public_repo. "
                "Release downloads also 404 if Authorization is forwarded to GitHub's CDN "
                "(fixed in this script) or if the release/asset name does not match.",
                file=sys.stderr,
            )
        return 1
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        return 1

    size = os.path.getsize(OUT)
    if size < 1024:
        print(f"Downloaded only {size} bytes — that is not the data archive.", file=sys.stderr)
        return 1
    print(f"Downloaded {size:,} bytes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
