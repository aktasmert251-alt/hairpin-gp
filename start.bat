@echo off
title HAIRPIN GP
rem HAIRPIN GP: Node.js (>= 24) gerekir. dist\ yoksa derler, sunucuyu baslatir, tarayiciyi acar.
cd /d "%~dp0"
if not exist dist\index.html (
  if not exist node_modules call npm install
  call npm run build
  if errorlevel 1 (
    echo Derleme basarisiz.
    pause
    exit /b 1
  )
)
start "" http://localhost:4173
call npx vite preview --port 4173
