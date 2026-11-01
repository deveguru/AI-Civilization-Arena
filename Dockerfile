FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
    CIVARENA_HOST=0.0.0.0 CIVARENA_PORT=8080 CIVARENA_DB=/app/data/civarena.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY civarena ./civarena
COPY run.py .
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["python", "run.py"]
