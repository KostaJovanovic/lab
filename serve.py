#!/usr/bin/env python3
"""Local dev server that mirrors the production Cloudflare routing.

`python -m http.server` only serves files literally, so /about would 404 and
/about.html would NOT redirect - the opposite of how lab.valjdakosta.com behaves
(default html_handling = "auto-trailing-slash"). This tiny server replicates it:

  /about.html  -> 308 redirect to /about        (and /index.html -> /)
  /about       -> serves about.html (200)
  /            -> serves index.html (200)
  /assets/...  -> served literally (real files with an extension)
  /anything-else (no matching file) -> index.html (200), the SPA fallback
     (wrangler.jsonc not_found_handling = "single-page-application")

Run: python serve.py [port]   (defaults to 3000, binds 0.0.0.0 for phone access)
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
ROOT = os.path.dirname(os.path.abspath(__file__))


class CleanURLHandler(SimpleHTTPRequestHandler):
    def _route(self):
        """Map the request path to a file to serve, or return None to redirect."""
        path = self.path.split('?', 1)[0].split('#', 1)[0]

        # /x.html -> redirect to the clean /x  (and /index.html -> /)
        if path.endswith('.html'):
            clean = path[:-5]
            if clean.endswith('/index'):
                clean = clean[:-5]  # ".../index" -> ".../"
            if clean == '':
                clean = '/'
            self.send_response(308)
            self.send_header('Location', clean)
            self.end_headers()
            return None

        if path == '/':
            return '/index.html'

        rel = path.lstrip('/')
        full = os.path.join(ROOT, rel)
        if os.path.isfile(full):
            return path                       # real asset (css/js/img/txt/...)
        if os.path.isfile(full + '.html'):
            return '/' + rel + '.html'        # clean page route: /about -> about.html
        return '/index.html'                  # SPA fallback

    def do_GET(self):
        target = self._route()
        if target is None:
            return  # already sent the redirect
        self.path = target
        return super().do_GET()

    def do_HEAD(self):
        target = self._route()
        if target is None:
            return
        self.path = target
        return super().do_HEAD()


if __name__ == '__main__':
    os.chdir(ROOT)
    httpd = HTTPServer(('0.0.0.0', PORT), CleanURLHandler)
    print('Serving %s on http://0.0.0.0:%d  (clean URLs, mirrors Cloudflare)' % (ROOT, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
