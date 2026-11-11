#!/bin/sh
# Double-click to launch Automata in your browser.
cd "$(dirname "$0")" && exec python3 serve.py --open
