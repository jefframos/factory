@echo off
setlocal enabledelayedexpansion

:: === Fixed Paths ===
set "input=../images/"
set "output=./images"


:: Clean output directory before copying
if exist "%output%" (
    rd /s /q "%output%"
)
mkdir "%output%"

:: Create output directory if it doesn't exist
if not exist "%output%" (
    mkdir "%output%"
)

:: Copy all files and folders
robocopy "%input%" "%output%" /E /NFL /NDL /NJH /NJS /NC /NS

:: Rename folders: remove {tag} completely from folder names
for /f "delims=" %%F in ('dir "%output%" /ad /b /s ^| sort /R') do (
    set "full=%%F"
    set "name=%%~nxF"
    set "parent=%%~dpF"

    :: Use regex-like logic to strip off {...}
    for /f "tokens=1 delims={" %%A in ("!name!") do (
        set "clean=%%A"
    )

    if not "!name!"=="!clean!" (
        if not exist "!parent!!clean!" (
            ren "%%F" "!clean!"
        ) else (
            echo Merging "%%F" into "!parent!!clean!"...
            robocopy "%%F" "!parent!!clean!" /E /MOVE >nul
            rd "%%F"
        )
    )
)

echo Done!
pause