FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/app \
    HF_HOME=/home/app/.cache/huggingface

RUN useradd --create-home --uid 10001 app

WORKDIR /tmp
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

WORKDIR /app
COPY . /app/worker
USER app

# One pass, then exit. Cron or GitHub Actions starts the container.
CMD ["python", "-m", "worker"]
