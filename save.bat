@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set FORCE_MODE=0
set COMMIT_ONLY=0
set ACTION=%~1

if /i "%ACTION%"=="--force"   (set FORCE_MODE=1 & set ACTION=save)
if /i "%ACTION%"=="commit"    (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="--commit"  (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="--no-push" (set COMMIT_ONLY=1 & set ACTION=save)
if /i "%ACTION%"=="save"   goto save
if /i "%ACTION%"=="commit" goto save
if /i "%ACTION%"=="push"   goto push
if /i "%ACTION%"=="pull"   goto pull

:menu
echo.
echo === GIT ===
echo.
echo   1. Save    (add + commit + push)
echo   2. Commit  (add + commit, no push)
echo   3. Push    (push current branch)
echo   4. Pull    (pull current branch)
echo   5. Quit
echo.
set /p CHOICE=Choose [1-5]:
if "%CHOICE%"=="1" goto save
if "%CHOICE%"=="2" (set COMMIT_ONLY=1 & goto save)
if "%CHOICE%"=="3" goto push
if "%CHOICE%"=="4" goto pull
if "%CHOICE%"=="5" exit /b 0
echo Invalid choice.
goto menu


:save
echo.
echo === SAVE TO GIT ===
echo.

set SAVE_ERROR=0

for /f %%i in ('git rev-list --count HEAD 2^>nul') do set COMMIT_COUNT=%%i
if not defined COMMIT_COUNT set COMMIT_COUNT=0
set /a NEXT_COUNT=%COMMIT_COUNT%+1

rem Version label mirrors analyserVersion() in app.js. RELEASE is the commit that
rem is crowned 1.0 - keep it in sync with RELEASE_COMMITS in app.js. Commits before
rem it read 0.NN, the release reads 1.0, and commits after it read 1.NN.
set RELEASE=29
for /f %%v in ('powershell -NoProfile -Command "$n=%NEXT_COUNT%; $r=%RELEASE%; if($n -lt $r){'0.{0:D2}' -f $n} elseif($n -eq $r){'1.0'} else{'1.{0:D2}' -f ($n-$r)}"') do set VERLABEL=%%v
echo Bumping version to %VERLABEL% (commit %NEXT_COUNT%)

powershell -Command "(Get-Content 'assets/js/core/app.js') -replace 'const COMMIT_COUNT = \d+;', 'const COMMIT_COUNT = %NEXT_COUNT%;' | Set-Content 'assets/js/core/app.js' -Encoding utf8"

git add .
git status

echo.
set /p MSG=Commit message [default: update]:
if "%MSG%"=="" set MSG=update

git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo ERROR: git commit failed.
  set SAVE_ERROR=1
  goto end
)

if "%COMMIT_ONLY%"=="1" goto committed
if "%FORCE_MODE%"=="1" goto forcepush

echo.
set /p DOPUSH=Push to GitHub? (y/n):
if /i not "%DOPUSH%"=="y" goto skipped

git push origin main
if not errorlevel 1 goto pushed

echo.
echo Push was rejected. The remote has changes you don't have locally.
echo.
set /p FETCH=Fetch and merge remote changes? (y/n):
if /i "%FETCH%"=="y" goto fetch

set /p FORCE=Force push instead? This will overwrite the remote. (y/n):
if /i "%FORCE%"=="y" goto forcepush

echo Skipped. No changes pushed.
set SAVE_ERROR=1
goto end

:fetch
git pull origin main
if errorlevel 1 set SAVE_ERROR=1
echo.
echo Pulled. You may need to resolve conflicts, then run this script again.
goto end

:forcepush
git push origin main --force
if errorlevel 1 set SAVE_ERROR=1
echo.
echo Force pushed.
goto end

:pushed
echo.
echo Pushed.
goto end

:skipped
echo.
echo Skipped push.
goto end


:committed
echo.
echo Committed locally as %VERLABEL% (not pushed).
goto end


:push
echo.
echo === PUSH ===
echo.
set SAVE_ERROR=0
git push origin main
if errorlevel 1 (
  echo.
  set /p FORCE=Push failed. Force push? This will overwrite the remote. (y/n):
  if /i "!FORCE!"=="y" (
    git push origin main --force
    if errorlevel 1 set SAVE_ERROR=1
  ) else (
    set SAVE_ERROR=1
  )
)
goto end


:pull
echo.
echo === PULL ===
echo.
set SAVE_ERROR=0
git pull origin main
if errorlevel 1 set SAVE_ERROR=1
goto end


:end
echo.
pause
exit /b %SAVE_ERROR%
