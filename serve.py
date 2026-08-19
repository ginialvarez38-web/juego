#!/usr/bin/env python3
"""Servidor estatico minimo. Los modulos ES necesitan HTTP (no file://)."""
import http.server, socketserver, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Theatrum Belli -> http://localhost:{PORT}")
    httpd.serve_forever()
