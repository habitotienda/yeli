"""Entry point.

    python app.py              # uses Waitress (a real multi-threaded server) when it is installed
    flask --app app run        # development server
    waitress-serve --threads=32 --call app:create_app
"""
import os

from yeli import create_app

app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    try:
        from waitress import serve
    except ImportError:
        print("Waitress isn't installed, using Flask's development server (pip install waitress for real use).")
        app.run(host=host, port=port, threaded=True, debug=os.environ.get("FLASK_DEBUG") == "1")
    else:
        threads = int(os.environ.get("YELI_THREADS", "32"))
        print(f"Yeli on http://{host}:{port} ({threads} threads)")
        serve(app, host=host, port=port, threads=threads)
