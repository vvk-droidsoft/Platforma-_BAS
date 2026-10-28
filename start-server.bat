@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not defined ADMIN_PASSWORD set ADMIN_PASSWORD=admin
if not defined DATA_DIR set DATA_DIR=%~dp0data

echo.
echo  ЛИС · Сервер тестов
echo  Кабинет:  http://localhost:8080/admin
echo  Пароль:   %ADMIN_PASSWORD%
echo  Данные:   %DATA_DIR%
echo.
echo  Курсантам: http://^<IP-ПК^>:8080/t/^<id^>
echo  (узнать IP: ipconfig)
echo.

py -m pip install -q -r server\requirements.txt
if errorlevel 1 (
  echo Не удалось установить зависимости. Установите Python с python.org
  pause
  exit /b 1
)

py -m uvicorn server.app:app --host 0.0.0.0 --port 8080
pause
