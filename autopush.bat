@echo off
set count_file=commit_count.txt

:: Check if the file exists; if not, initialize it at 0
if not exist %count_file% (
    echo 0 > %count_file%
)

:: Read the current value from the file
set /p current_count=<%count_file%

:: Increment the value by 1
set /a new_count=%current_count% + 1

:: Save the new value back to the text file
echo %new_count% > %count_file%

:: Define the internal commit message with the counter
set commit_message="Internal Build #%new_count%"

echo Adding changes...
git add .

echo Committing: %commit_message%
git commit -m %commit_message%

echo Pushing to remote...
git push

echo Successfully updated to Build #%new_count%
pause