# Registers Windows Scheduled Tasks that run the team ceremonies unattended with Claude Code.
#   powershell -ExecutionPolicy Bypass -File install-schedules.ps1 -ProjectRoot "D:\projects\forge" [-DailyTime 09:00] [-TickMinutes 60] [-From 08:00] [-To 19:00] [-Weekdays] [-Prefix forge]
#   -From/-To bound the tick to working hours (default 08:00-19:00); -Weekdays limits daily and tick to Monday-Friday.
#   powershell -ExecutionPolicy Bypass -File install-schedules.ps1 -ProjectRoot "D:\projects\forge" -Uninstall
# Requirements: `claude` on PATH (Claude Code), team/team.config.json and team/.env filled, plugin installed in that project.
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$DailyTime = "09:00",
  [int]$TickMinutes = 60,
  [string]$From = "08:00",
  [string]$To = "19:00",
  [switch]$Weekdays,
  [string]$Prefix = "",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
if (-not $Prefix) { $Prefix = Split-Path $ProjectRoot -Leaf }
$logDir = Join-Path $ProjectRoot "team\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$window = ([datetime]$To) - ([datetime]$From)
if ($window.TotalMinutes -le 0) { throw "-To must be after -From" }
$days = @("Monday","Tuesday","Wednesday","Thursday","Friday")
if ($Weekdays) {
  $dailyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $DailyTime
  $tickTrigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $From
} else {
  $dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
  $tickTrigger  = New-ScheduledTaskTrigger -Daily -At $From
}
# Repeat the tick every $TickMinutes between $From and $To only.
$tickTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At $From -RepetitionInterval (New-TimeSpan -Minutes $TickMinutes) -RepetitionDuration $window).Repetition

# Laptops: Task Scheduler never catches up missed *repetitions*, so the tick also fires 2 minutes after
# every logon (the tick itself runs the daily when today's is missing — see tick skill §2).
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logonTrigger.Delay = "PT2M"

$tasks = @(
  @{ Name = "agile-team-$Prefix-daily"; Skill = "/agile-team:daily";  Trigger = @($dailyTrigger) },
  @{ Name = "agile-team-$Prefix-tick";  Skill = "/agile-team:tick";   Trigger = @($tickTrigger, $logonTrigger) }
)

foreach ($t in $tasks) {
  if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
    Write-Host "Removed $($t.Name)"
  }
  if ($Uninstall) { continue }
  $log = Join-Path $logDir ("$($t.Skill.Split(':')[1]).log")
  $cmd = "cd /d `"$ProjectRoot`" && claude -p `"$($t.Skill)`" --permission-mode acceptEdits >> `"$log`" 2>&1"
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd"
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Settings $settings -Description "agile-team plugin: $($t.Skill) for $ProjectRoot" | Out-Null
  Write-Host "Registered $($t.Name) -> $($t.Skill)"
}

if (-not $Uninstall) {
  Write-Host ""
  $when = if ($Weekdays) { "Monday-Friday" } else { "every day" }
  Write-Host "Daily runs at $DailyTime, tick every $TickMinutes min between $From and $To, $when. Logs in $logDir."
  Write-Host "The tick also runs 2 min after each logon, and runs the daily itself when today's is missing."
  Write-Host "The tick skips itself when a previous run is still going (MultipleInstances=IgnoreNew)."
  Write-Host "If a run stops on a permission prompt, add the needed Bash(...) allow rules to .claude/settings.json (see README)."
}
