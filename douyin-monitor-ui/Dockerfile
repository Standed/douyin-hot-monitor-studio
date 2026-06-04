FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY douyin-monitor-ui/package.json douyin-monitor-ui/package-lock.json ./
RUN npm ci

COPY douyin-monitor/requirements.docker.txt /tmp/douyin-monitor-requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r /tmp/douyin-monitor-requirements.txt

COPY douyin-monitor-ui ./

ENV HOST=0.0.0.0
ENV PYTHON_BIN=python3
ENV MONITOR_DIR=/app/douyin-monitor
ENV LOCAL_API_BASE=http://douyin-parser

EXPOSE 5174 8787

CMD ["npm", "run", "dev:docker"]
