@echo off
title Game Asset Processor
echo ---------------------------------------
echo   STARTING ASSET GENERATION
echo ---------------------------------------

:: Run the node script
node processIcons.js

echo ---------------------------------------
echo   DONE! CLOSING IN 3 SECONDS...
echo ---------------------------------------

:: Wait for 3 seconds so you can see if there were any errors
timeout /t 3 /nobreak > nul

exit