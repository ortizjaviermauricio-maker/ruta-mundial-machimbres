@echo off
title Ruta al Mundial del Mueble 2026 - Machimbres
color 0A
cls
echo ===============================================
echo    RUTA AL MUNDIAL DEL MUEBLE 2026
echo    MACHIMBRES Y MADERAS S.A.S.
echo ===============================================
echo.
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js no esta instalado.
    echo Descargue e instale Node.js LTS desde https://nodejs.org
    pause
    exit /b
)
if not exist node_modules (
    echo Instalando dependencias...
    npm install
)
start http://localhost:5173
npm run dev
pause
