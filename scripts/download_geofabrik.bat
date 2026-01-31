@echo off
REM Windows batch script to download Geofabrik OSM extracts
REM Usage: download_geofabrik.bat spain
REM        download_geofabrik.bat europe/france

if "%1"=="" (
    echo Usage: download_geofabrik.bat ^<region^>
    echo.
    echo Examples:
    echo   download_geofabrik.bat spain
    echo   download_geofabrik.bat europe/france
    echo   download_geofabrik.bat asia/japan
    echo.
    echo Run the Python script for more options:
    echo   python download_geofabrik.py --help
    exit /b 1
)

python "%~dp0download_geofabrik.py" %*
