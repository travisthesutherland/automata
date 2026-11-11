#!/usr/bin/env python3
"""Local server for Automata. Run it, then open http://localhost:8642"""
import http.server, os, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8642
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    url = "http://localhost:%d" % PORT
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # something is already serving on this port, most likely another copy of this script
        print("Port %d is already in use, so Automata is probably running already: %s" % (PORT, url))
        print("To use another port: python3 serve.py 8650 --open")
        if "--open" in sys.argv:
            webbrowser.open(url)
        sys.exit(0)
    with httpd:
        print("Automata is running at " + url + "  (Ctrl+C to stop)")
        if "--open" in sys.argv:
            webbrowser.open(url)
        httpd.serve_forever()
