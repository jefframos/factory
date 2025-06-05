@echo off
echo Installing project...

start "Project Install" cmd /k "npm install"

echo Installing tools...

start "Tools Install" cmd /k "cd /d ..\eugine-tools && npm install"

echo Project Installed