@echo off
title Ruta al Mundial del Mueble 2026
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo Iniciando sistema local...
echo Abra: http://localhost:5173
call npm run dev
pause
