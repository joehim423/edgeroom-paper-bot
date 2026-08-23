$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodePath = "C:\Users\ipjas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:PATH = "$nodePath;$env:PATH"
$env:WRANGLER_LOG_PATH = ".wrangler/wrangler.log"

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Starting dashboard server" | Out-File -FilePath ".\logs\dashboard-server.log" -Append -Encoding utf8
& ".\node_modules\.bin\vinext.CMD" start *>> ".\logs\dashboard-server.log"
