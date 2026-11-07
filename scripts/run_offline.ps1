# Run Vitra on Windows. Same flags as scripts/run_offline.sh, same code (app/launch.py).
#
#   scripts\run_offline.ps1 --check            start everything, smoke test, socket audit
#   scripts\run_offline.ps1                    cold start and open the browser
#   scripts\run_offline.ps1 predict dev        predict and score a package split
#   scripts\run_offline.ps1 --help             everything else
#
# Python: $env:VITRA_PYTHON, else .venv\Scripts\python.exe, else py -3, else python.
# If script execution is disabled, run it as:
#   powershell -ExecutionPolicy Bypass -File scripts\run_offline.ps1 --check
# or use scripts\run_offline.cmd, which takes the same arguments.
$Root = Split-Path -Parent $PSScriptRoot
$Py = @()
if ($env:VITRA_PYTHON) {
    $Py = @($env:VITRA_PYTHON)
} elseif (Test-Path (Join-Path $Root '.venv\Scripts\python.exe')) {
    $Py = @(Join-Path $Root '.venv\Scripts\python.exe')
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $Py = @('py', '-3')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Py = @('python')
} else {
    [Console]::Error.WriteLine('Python not found. Create the venv first: py -3 -m venv .venv')
    exit 1
}
$Exe = $Py[0]
$PyArgs = @()
if ($Py.Count -gt 1) { $PyArgs = $Py[1..($Py.Count - 1)] }
Push-Location $Root
try {
    & $Exe @PyArgs -m app.launch @args
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $code
