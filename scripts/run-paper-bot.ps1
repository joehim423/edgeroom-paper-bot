$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodePath = "C:\Users\ipjas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:PATH = "$nodePath;$env:PATH"

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Starting paper bot" | Out-File -FilePath ".\logs\paper-bot.log" -Append -Encoding utf8
node ".\scripts\paper-bot.mjs" *>> ".\logs\paper-bot.log"
