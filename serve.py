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
import json
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# Canned response for the stats Worker (worker/index.js), which only exists on
# the Cloudflare deploy. server.bat has no Worker/D1, so without this /api/* would
# fall through to the SPA handler and hand back index.html - breaking the visitor
# badge and the /stats page locally. Numbers here are fake, just enough to render.
MOCK_STATS = {
    'files': 12345,
    'visitors': 678,
    'extensions': [
        {'ext': 'jpg', 'supported': True, 'count': 4210},
        {'ext': 'png', 'supported': True, 'count': 3180},
        {'ext': 'mp3', 'supported': True, 'count': 1990},
        {'ext': 'pdf', 'supported': True, 'count': 1450},
        {'ext': 'mp4', 'supported': True, 'count': 1220},
        {'ext': 'wav', 'supported': True, 'count': 870},
        {'ext': 'heic', 'supported': True, 'count': 540},
        {'ext': 'zip', 'supported': True, 'count': 410},
        {'ext': 'sldprt', 'supported': True, 'count': 300},
        {'ext': 'dwg', 'supported': True, 'count': 240},
        {'ext': 'xyz', 'supported': False, 'count': 130},
        {'ext': 'qwerty', 'supported': False, 'count': 70},
    ],
    # ts = unix seconds; wave + cause ('.ext' asteroid, or 'nuke') drive the new
    # meta line on /stats. Last two rows are deliberately legacy (no wave/cause/ts)
    # to keep exercising the graceful no-meta fallback.
    'scores': [
        {'name': 'ACEXX', 'score': 13370, 'wave': 18, 'cause': '.pdf', 'ts': 1781308800},
        {'name': 'NOVA9', 'score': 9800, 'wave': 14, 'cause': 'nuke', 'ts': 1781222400},
        {'name': 'ZAPPY', 'score': 7220, 'wave': 11, 'cause': '.heic', 'ts': 1781136000},
        {'name': 'KOSTA', 'score': 5040, 'wave': 9, 'cause': '.zip', 'ts': 1780963200},
        {'name': 'PILOT', 'score': 3110, 'wave': 7, 'cause': '.mp4', 'ts': 1780704000},
        {'name': 'COMET', 'score': 2890, 'wave': 6, 'cause': 'nuke', 'ts': 1780531200},
        {'name': 'ORBIT', 'score': 2450, 'wave': 5, 'cause': '.dwg', 'ts': 1780358400},
        {'name': 'LASER', 'score': 1980, 'wave': 4, 'cause': '.jpg', 'ts': 1780099200},
        {'name': 'DRIFT', 'score': 1540, 'wave': 4, 'cause': '.png', 'ts': 1779840000},
        {'name': 'ROCKS', 'score': 1200, 'wave': 3, 'cause': '.mp3', 'ts': 1779580800},
        {'name': 'BLAST', 'score': 940},
        {'name': 'WARP7', 'score': 610},
    ],
}

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

    def _serve_api(self, path):
        """Mock /api/* locally; return True if handled."""
        if not path.startswith('/api/'):
            return False
        if path == '/api/stats':
            payload = MOCK_STATS
        elif path == '/api/visit':
            payload = {'files': MOCK_STATS['files'], 'visitors': MOCK_STATS['visitors'], 'counted': False}
        elif path == '/api/leaderboard':
            payload = {'top': MOCK_STATS['scores'][:5]}
        elif path == '/api/score':
            payload = {'ok': True, 'top': MOCK_STATS['scores'][:5]}
        else:
            payload = {'ok': True}
        body = json.dumps(payload).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if self._serve_api(path):
            return
        target = self._route()
        if target is None:
            return  # already sent the redirect
        self.path = target
        return super().do_GET()

    def do_POST(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        # Drain any request body so keep-alive connections stay clean.
        length = int(self.headers.get('Content-Length') or 0)
        if length:
            try:
                self.rfile.read(length)
            except Exception:
                pass
        if self._serve_api(path):
            return
        self.send_error(404)

    def do_HEAD(self):
        target = self._route()
        if target is None:
            return
        self.path = target
        return super().do_HEAD()


if __name__ == '__main__':
    os.chdir(ROOT)
    # ThreadingHTTPServer (not HTTPServer): the service worker fires background
    # revalidation fetches (stale-while-revalidate) concurrently with the page's
    # own requests. A single-threaded server serialises those and can deadlock -
    # the SW's navigation fetch never resolves, so the page "loads" forever with
    # nothing in the console. One thread per request avoids it.
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), CleanURLHandler)
    print('Serving %s on http://0.0.0.0:%d  (clean URLs, mirrors Cloudflare)' % (ROOT, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
