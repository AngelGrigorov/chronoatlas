"""Локален сървър за public/ без кеширане, за да се вижда всяка промяна веднага.

python tools/serve.py [порт]
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
    # Браузърът търси localhost първо на ::1; само IPv4 кара module worker-а да виси.
    address_family = socket.AF_INET6
    # По подразбиране опашката е 5 връзки; картата иска десетки плочки наведнъж.
    request_queue_size = 128


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
Loopback(('::1', port), functools.partial(NoCache, directory=ROOT)).serve_forever()
