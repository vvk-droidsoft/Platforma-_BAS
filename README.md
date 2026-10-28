# ЛИС · Сервер тестов 2.1

Сервер на вашем ПК: создаёте тест на сайте → даёте курсантам ссылку → смотрите баллы и разбор ответов.

## Быстрый старт (Docker)

```bash
docker compose up -d --build
```

- Сайт: http://localhost:8080  
- Генератор: http://localhost:8080/tools/generator  
- Кабинет: http://localhost:8080/admin (пароль по умолчанию: `admin`)

Пароль: `ADMIN_PASSWORD=секрет docker compose up -d`

## Без Docker

Запустите `start-server.bat` (нужен Python 3.10+).

## Git и Docker

В Git хранится **код** проекта (`Dockerfile`, `docker-compose.yml`, сервер).  
Сам Git **не запускает** контейнеры.

Типичная схема:

1. Код лежит в репозитории (GitHub / GitLab / свой сервер).
2. На ПК или VPS с Docker: `git pull` → `docker compose up -d --build`.

Курсанты ходят на IP машины, где крутится Docker, не на Git.

## Структура

| Путь | Назначение |
|------|------------|
| `server/` | FastAPI: попытки, баллы, кабинет |
| `Dockerfile` / `docker-compose.yml` | Запуск в контейнере |
| `Генератор_тестов.html` | Создание теста и публикация ссылки |
| `data/` | БД и опубликованные тесты (не в Git) |
