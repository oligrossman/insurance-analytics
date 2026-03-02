#!/usr/bin/env python3
"""
Run the dashboard locally with a simple HTTP server.

Usage:
    python3 run_local.py

This will:
1. Generate fresh data
2. Start a local web server on http://localhost:8000
3. Open your browser automatically

Press Ctrl+C to stop the server.
"""

import subprocess
import sys
import webbrowser
import time
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

def generate_data():
    """Generate fresh data (uses same Python as this script)."""
    print("📊 Generating data...")
    backend_script = Path(__file__).parent / "backend" / "generate_data.py"
    try:
        subprocess.run(
            [sys.executable, str(backend_script)],
            check=True,
            capture_output=True
        )
        print("✓ Data generated\n")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to generate data: {e}")
        sys.exit(1)

def run_server():
    """Start local HTTP server."""
    port = 8000
    server_address = ('', port)
    httpd = HTTPServer(server_address, SimpleHTTPRequestHandler)
    
    url = f"http://localhost:{port}/index.html"
    print("=" * 60)
    print("🚀 Insurance Analytics Dashboard - Local Server")
    print("=" * 60)
    print(f"\n📍 Server running at: {url}")
    print("📊 Dashboard available at: http://localhost:8000/")
    print("\nPress Ctrl+C to stop the server\n")
    
    # Open browser after a short delay
    time.sleep(1)
    webbrowser.open(url)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped")
        httpd.shutdown()

if __name__ == "__main__":
    generate_data()
    run_server()
