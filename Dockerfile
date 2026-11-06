# Yeli with the bot's voice in the stream and the stream sent to other platforms.
# espeak-ng turns the !say messages into audio on the server; ffmpeg sends the stream to Kick, TikTok, Twitch...
#   docker build -t yeli . && docker run -p 5000:5000 -e HOST=0.0.0.0 yeli
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV HOST=0.0.0.0 PORT=5000
EXPOSE 5000
CMD ["python", "app.py"]
