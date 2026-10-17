"""A local server for public/ without caching, so every change shows up at once.

python tools/serve.py [port]
"""
import functools
import http.server
import os
import socket
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.webp': 'image/webp'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


class Loopback(http.server.ThreadingHTTPServer):
    # The default backlog is 5 connections; the map asks for dozens of tiles at once.
    request_queue_size = 128


class Loopback6(Loopback):
    address_family = socket.AF_INET6


# localhost on both loopback addresses: browsers try ::1 first (IPv4 only made the module
# worker hang) but may fall back to 127.0.0.1 for some requests. Never on the network.
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
handler = functools.partial(NoCache, directory=ROOT)
v4 = Loopback(('127.0.0.1', port), handler)
threading.Thread(target=v4.serve_forever, daemon=True).start()
Loopback6(('::1', port), handler).serve_forever()
