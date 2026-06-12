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

rem Version label mirrors analyserVersion() in app.js. RELEASES is the list of
rem commits crowned as major releases - keep it in sync with RELEASE_COMMITS in
rem app.js (sorted ascending). Each release reads X.0 and resets the minor counter:
rem commit 29 = 1.0, commit 60 = 2.0, etc.
set RELEASES=29,60,100
for /f %%v in ('powershell -NoProfile -Command "$n=%NEXT_COUNT%; $major=0; $base=0; foreach($r in @(%RELEASES%)){ if($n -ge $r){ $major++; $base=$r } else { break } }; if($major -eq 0){ '0.{0:D2}' -f $n } elseif(($n-$base) -eq 0){ '{0}.0' -f $major } else { '{0}.{1:D2}' -f $major,($n-$base) }"') do set VERLABEL=%%v
echo Bumping version to %VERLABEL% (commit %NEXT_COUNT%)

rem -Encoding UTF8 on BOTH ends is required: without it, Get-Content defaults to
rem the ANSI code page and reads this UTF-8 file as Windows-1252, mangling every
rem non-ASCII char (e.g. the ellipsis in "Reading file..." became "...â€¦...") a
rem little more on every commit. Read and write UTF-8 explicitly so it round-trips.
powershell -Command "(Get-Content 'assets/js/core/app.js' -Encoding UTF8) -replace 'const COMMIT_COUNT = \d+;', 'const COMMIT_COUNT = %NEXT_COUNT%;' | Set-Content 'assets/js/core/app.js' -Encoding utf8"

rem Bump the service-worker cache epoch too, so every commit ships fresh JS/CSS
rem instead of leaving cached clients on a stale shell (stale-while-revalidate
rem otherwise keeps serving the old code until VERSION changes).
powershell -Command "(Get-Content 'sw.js' -Encoding UTF8) -replace 'const VERSION = ''analyser-v\d+'';', 'const VERSION = ''analyser-v%NEXT_COUNT%'';' | Set-Content 'sw.js' -Encoding utf8"

rem Prerender the static /formats page from the catalog (single source of truth
rem in assets/js/core/formats.js), so the supported-formats list and its #fmt- /
rem #ext- deep-link anchors exist in plain HTML for crawlers. Non-fatal: a missing
rem Node or a generator error just commits the existing formats.html.
echo Prerendering /formats from the catalog...
node --no-warnings tools/prerender-formats.mjs
if errorlevel 1 echo WARNING: formats.html prerender failed - committing the existing copy.

rem Prerender the per-extension /format/<ext> landing pages (only for formats with
rem a real viewer/deep analysis - depth 'full' in the catalog) plus sitemap-formats.xml.
echo Prerendering per-format landing pages...
node --no-warnings tools/prerender-format-pages.mjs
if errorlevel 1 echo WARNING: per-format page prerender failed - committing the existing copies.

rem Stamp the live format count into the static crawler-only copy (meta/OG/JSON-LD
rem descriptions, manifest, feature text) and refresh the main sitemap lastmod, so
rem the hand-maintained numbers can't drift from the catalog. Non-fatal.
echo Stamping format count and sitemap dates...
node --no-warnings tools/stamp-counts.mjs
if errorlevel 1 echo WARNING: count/sitemap stamp failed - committing the existing copies.

rem Stamp the shared footer block (the "Everything runs in your browser" heading +
rem the whole Download-for-offline-use section) into every main page from
rem tools/partials/footer-shared.html, so the footer can't drift across pages. Each
rem page's own .footer-bottom row (return button + page links) is left alone. Non-fatal.
echo Stamping shared footer...
node --no-warnings tools/stamp-footer.mjs
if errorlevel 1 echo WARNING: footer stamp failed - committing the existing copies.

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
