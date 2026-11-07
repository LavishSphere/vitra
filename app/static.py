"""Serve the prebuilt web app (web/dist) from the API's own origin.

- GET / and any path without a file extension -> index.html (single-page app
  fallback), so client-side routes survive a reload.
- A path that names a file inside web/dist -> that file. A missing file with an
  extension (e.g. /assets/x.js) -> 404, never index.html served as script.
- /api and /api/* never fall through to the web app: unknown API paths are 404 JSON.
- Paths are resolved and must stay inside web/dist (no ../ traversal).
- The page loads without a token. The token reaches the page in the URL
  fragment (#t=...), which browsers never send to the server.
- HTML responses carry a Content-Security-Policy that only allows this origin,
  so the page can't load or call anything off the machine.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' http://127.0.0.1:*",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)
HTML_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def web_available(dist: Path) -> bool:
    return (dist / "index.html").is_file()


def install_static(app: FastAPI, dist: Path) -> None:
    """Register the catch-all web route. Call after every /api router is included."""
    root = dist.resolve()

    def not_found(detail: str) -> Response:
        return JSONResponse({"detail": detail}, status_code=404)

    def html(path: Path) -> Response:
        return FileResponse(path, media_type="text/html; charset=utf-8", headers=HTML_HEADERS)

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def web(path: str, request: Request) -> Response:
        if path == "api" or path.startswith("api/"):
            return not_found("no such API route")
        if not web_available(root):
            return not_found("web app not built: run `npm run build` in web/ while online")
        if path:
            target = (root / path).resolve()
            if not target.is_relative_to(root):
                return not_found("not found")
            if target.is_file():
                if target.suffix == ".html":
                    return html(target)
                return FileResponse(target, headers={"X-Content-Type-Options": "nosniff"})
            if "." in Path(path).name:
                return not_found("not found")
        return html(root / "index.html")
