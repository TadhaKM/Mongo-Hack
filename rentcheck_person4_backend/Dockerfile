# Build context is the repository root (see docker-compose.yml) so the AI agents package can be installed.
FROM python:3.11-slim
WORKDIR /app
COPY rentcheck_person4_backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agents /opt/agents
RUN pip install --no-cache-dir /opt/agents
COPY rentcheck_person4_backend/app ./app
COPY rentcheck_person4_backend/scripts ./scripts
COPY rentcheck_person4_backend/source_catalog.json .
COPY rentcheck_person4_backend/data ./data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
