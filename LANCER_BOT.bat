@echo off
title Discord Tracker Bot
echo Installation des dependances...
call npm install
echo.
echo Lancement du bot de capture d'IP...
echo Appuyez sur Ctrl+C pour arreter.
echo.
node bot_discord.js
pause
