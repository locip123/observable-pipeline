FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations
COPY entrypoint.sh ./entrypoint.sh
RUN pip install --no-cache-dir . && chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
