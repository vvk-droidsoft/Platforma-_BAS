FROM python:3.12-slim

WORKDIR /app

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server /app/server
COPY Генератор_тестов.html Конвертер_тестов.html Нормативы.html Полётная_ведомость.html Полигон.html /app/

ENV DATA_DIR=/data
ENV ADMIN_PASSWORD=admin
ENV PYTHONUNBUFFERED=1

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/')" || exit 1

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8080"]
