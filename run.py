"""Start AI Civilization Arena.

    python run.py                       # http://127.0.0.1:8080
    python run.py --host 0.0.0.0 --port 8080 --db data/civarena.db

Uses the production WSGI server `waitress` when it is installed, Flask's
built-in server otherwise (or with --dev).
"""
import argparse
import os

from civarena.web import create_app

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="AI Civilization Arena")
    p.add_argument("--host", default=os.environ.get("CIVARENA_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("CIVARENA_PORT", "8080")))
    p.add_argument("--db", default=os.environ.get("CIVARENA_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "civarena.db")))
    p.add_argument("--dev", action="store_true", help="use Flask's development server")
    a = p.parse_args()
    app = create_app(a.db)
    shown = "127.0.0.1" if a.host in ("0.0.0.0", "::") else a.host
    print(f"\n  AI Civilization Arena  ->  http://{shown}:{a.port}\n  Admin panel            ->  http://{shown}:{a.port}/admin\n")
    try:
        if a.dev:
            raise ImportError
        from waitress import serve
        serve(app, host=a.host, port=a.port, threads=16)
    except ImportError:
        app.run(host=a.host, port=a.port, threaded=True, debug=False, use_reloader=False)
