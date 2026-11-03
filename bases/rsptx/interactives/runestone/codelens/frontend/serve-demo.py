"""Serve the CodeLens demo with caching turned off, so edits show on reload.

Serves bases/rsptx/interactives, because the demo's import map loads
CodeMirror from its node_modules. Usage:

    python runestone/codelens/frontend/serve-demo.py [port]

Then open http://127.0.0.1:<port>/runestone/codelens/frontend/demo.html
"""

import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {ROOT} without caching")
        print(f"Open http://127.0.0.1:{port}/runestone/codelens/frontend/demo.html")
        server.serve_forever()


if __name__ == "__main__":
    main()
