# ЛИС · Сервер тестов (Docker / локально)

Сервер на вашем ПК: курсанты открывают ссылку, сдают тест **один раз**, баллы видите вы. Пересдача — только после вашей разблокировки.

## Быстрый старт без Docker (Windows)

1. Установите [Python 3.10+](https://www.python.org/downloads/) (галочка «Add to PATH»).
2. В этой папке дважды щёлкните `start-server.bat`  
   или в PowerShell:

```powershell
py -m pip install -r server\requirements.txt
py -m uvicorn server.app:app --host 0.0.0.0 --port 8080
```

3. Откройте [http://localhost:8080/admin](http://localhost:8080/admin)  
   Пароль по умолчанию: `admin`

4. Курсантам отправьте ссылку вида:

```text
http://<IP-вашего-ПК>:8080/t/<id-теста>
```

Узнать IP: `ipconfig` → IPv4 (например `192.168.1.50`). ПК и телефоны курсантов — в одной Wi‑Fi/LAN. В брандмауэре Windows разрешите входящие на порт **8080**.

Пароль: переменная окружения `ADMIN_PASSWORD` или правка в `start-server.bat`.

## Docker

```bash
docker compose up -d --build
```

Пароль: `ADMIN_PASSWORD=секрет docker compose up -d`  
Данные (БД и HTML тестов) — том `lis-data`.

Ключ для просмотра паролей учёток админом: `LIS_VAULT_KEY` (опционально) или файл `/data/.lis_vault_key`. Не используйте пароль админа как ключ vault.

Остановка: `docker compose down`

## Staging (проверка без боя)

Отдельный контейнер на порту **8081**, своя БД (`lis-staging-data`), тот же код что у prod.

| | Prod | Staging |
|--|------|---------|
| URL | `http://HOST:8080` | `http://HOST:8081` |
| Compose | `docker-compose.yml` | `docker-compose.staging.yml` |
| Данные | том `lis-data` | том `lis-staging-data` |
| Метка | `LIS_ENV=prod` | `LIS_ENV=staging` (+ оранжевая полоса в UI) |

На VPS (из папки проекта):

```powershell
# только staging
.\deploy-vps.ps1 -UseKey -Staging

# prod и staging одним выкладом кода
.\deploy-vps.ps1 -UseKey -Both
```

Локально / на сервере вручную:

```bash
docker compose -p lis-staging -f docker-compose.staging.yml up -d
```

Smoke: `python smoke_check.py --base http://HOST:8081`

## Как пользоваться

1. Откройте [http://localhost:8080/tools/generator](http://localhost:8080/tools/generator).
2. Загрузите банк вопросов (Excel/Word), настройте тест, нажмите **«Создать тест и получить ссылку»** (пароль преподавателя — как в кабинете, по умолчанию `admin`).
3. Скопируйте ссылку и отправьте курсантам — **HTML-файл им не нужен**.
4. Курсант открывает ссылку, вводит номер и позывной, проходит тест один раз.
5. Баллы и пересдача — в [кабинете](http://localhost:8080/admin).

## URL

| URL | Назначение |
|-----|------------|
| `/` | Главное меню |
| `/admin` | Кабинет преподавателя |
| `/t/{id}` | Ссылка для курсанта |
| `/tools/generator` | Генератор тестов |
| `/tools/flights` | Полётная ведомость |

Полётная ведомость по-прежнему хранит данные в `localStorage` браузера.
