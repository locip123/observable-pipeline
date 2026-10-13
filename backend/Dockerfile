FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations
RUN pip install --no-cache-dir .

CMD ["uvicorn", "pipeline.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
