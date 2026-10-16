"""A local server for public/ without caching, so every change shows up at once.

python tools/serve.py [port]
"""
import functools
import http.server
import os
import socket
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.webp': 'image/webp'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


class Loopback(http.server.ThreadingHTTPServer):
    # Browsers try localhost on ::1 first; IPv4 only makes the module worker hang.
    address_family = socket.AF_INET6
    # The default backlog is 5 connections; the map asks for dozens of tiles at once.
    request_queue_size = 128


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
Loopback(('::1', port), functools.partial(NoCache, directory=ROOT)).serve_forever()
