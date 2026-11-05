# Yeli with the bot's voice in the stream.
# espeak-ng turns the !say messages into audio on the server; the streamer's studio mixes it into the stream.
#   docker build -t yeli . && docker run -p 5000:5000 -e HOST=0.0.0.0 yeli
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV HOST=0.0.0.0 PORT=5000
EXPOSE 5000
CMD ["python", "app.py"]
