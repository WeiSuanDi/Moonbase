#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""月球基地本地开发服务器：禁用缓存，改完代码刷新即生效。
用法:  python serve.py [端口]   （默认 8080）
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # 安静一点，只显示非 200
        if args and len(args) > 1 and str(args[1]) not in ("200", "304"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with http.server.ThreadingHTTPServer(("", port), NoCacheHandler) as server:
        print(f"🌙 月球基地本地服务器: http://localhost:{port}  (Ctrl+C 停止)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
