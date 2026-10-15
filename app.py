"""Entry point.

    python app.py              # usa Waitress si está instalado (Windows / multiplataforma)
    gunicorn app:app           # recomendado en servidores Linux / hosting en la nube
"""
import os
from yeli import create_app

# Instancia de la aplicación expuesta globalmente para servidores WSGI (Gunicorn / Waitress / Render / Railway)
app = create_app()

if __name__ == "__main__":
    # En producción se debe usar '0.0.0.0' para recibir tráfico público
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    
    # Modo depuración desactivado por defecto para evitar brechas de seguridad
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"

    try:
        from waitress import serve
    except ImportError:
        print("Waitress no está instalado. Usando el servidor de desarrollo de Flask.")
        app.run(host=host, port=port, threaded=True, debug=debug_mode)
    else:
        threads = int(os.environ.get("YELI_THREADS", "32"))
        print(f"Yeli iniciado en http://{host}:{port} ({threads} hilos con Waitress)")
        serve(app, host=host, port=port, threads=threads)