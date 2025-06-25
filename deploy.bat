@echo off

REM Define the source and destination folders
set "source_folder=.\dist"
set "destination_folder=..\play\games\factory"
set "root_folder=..\play\"

CALL npm run build

REM Define the counter file
set "counter_file=%~dp0..\counterFactory.txt"

REM Check if the counter file exists, if not create it and set counter to 0
if not exist "%counter_file%" (
    echo 0 > "%counter_file%"
)

REM Read the counter from the file
set /p counter=<"%counter_file%"

REM Increment the counter
set /a counter+=1

REM Save the new counter value to the file
echo %counter% > "%counter_file%"

REM Copy the folder to the destination
xcopy /E /I /Y "%source_folder%" "%destination_folder%"

REM Change directory to the destination folder
cd /d "%root_folder%"

REM Execute Node.js commands
node generateAll.js

REM Execute Git commands
git add .
git commit -m "Auto commit - Execution number %counter%"
git push origin gh-pages

REM Pause the script to see the output
pause
