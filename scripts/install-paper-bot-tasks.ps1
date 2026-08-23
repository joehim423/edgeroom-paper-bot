$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runner = Join-Path $projectRoot "scripts\run-paper-bot.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""

$morningAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$morningTrigger = New-ScheduledTaskTrigger -Daily -At "9:00AM"
Register-ScheduledTask `
  -TaskName "EdgeRoom Paper Bot Morning" `
  -Action $morningAction `
  -Trigger $morningTrigger `
  -Description "Runs the EdgeRoom 7-day paper sports betting bot once each morning." `
  -Force | Out-Null

$nightAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$nightTrigger = New-ScheduledTaskTrigger -Daily -At "11:30PM"
Register-ScheduledTask `
  -TaskName "EdgeRoom Paper Bot Night" `
  -Action $nightAction `
  -Trigger $nightTrigger `
  -Description "Runs the EdgeRoom 7-day paper sports betting bot each night to settle completed games." `
  -Force | Out-Null

Write-Host "Installed EdgeRoom Paper Bot Morning and EdgeRoom Paper Bot Night."
