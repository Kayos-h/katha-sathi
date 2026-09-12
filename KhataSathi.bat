@echo off
title Khata Sathi
cd /d "%~dp0"
python run.py
if errorlevel 1 pause
