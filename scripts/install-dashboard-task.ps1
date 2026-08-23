$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runner = Join-Path $projectRoot "scripts\run-dashboard-server.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn

Register-ScheduledTask `
  -TaskName "EdgeRoom Dashboard Server" `
  -Action $action `
  -Trigger $trigger `
  -Description "Starts the EdgeRoom local dashboard server on login so localhost:3000 is available." `
  -Force | Out-Null

Write-Host "Installed EdgeRoom Dashboard Server."
