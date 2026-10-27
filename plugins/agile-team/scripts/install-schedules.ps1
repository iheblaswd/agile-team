# Registers Windows Scheduled Tasks that run the team ceremonies unattended with Claude Code.
#   powershell -ExecutionPolicy Bypass -File install-schedules.ps1 -ProjectRoot "D:\projects\forge" [-DailyTime 09:00] [-TickMinutes 45] [-Prefix forge]
#   powershell -ExecutionPolicy Bypass -File install-schedules.ps1 -ProjectRoot "D:\projects\forge" -Uninstall
# Requirements: `claude` on PATH (Claude Code), team/team.config.json and team/.env filled, plugin installed in that project.
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$DailyTime = "09:00",
  [int]$TickMinutes = 45,
  [string]$Prefix = "",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
if (-not $Prefix) { $Prefix = Split-Path $ProjectRoot -Leaf }
$logDir = Join-Path $ProjectRoot "team\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$tasks = @(
  @{ Name = "agile-team-$Prefix-daily"; Skill = "/agile-team:daily";  Trigger = (New-ScheduledTaskTrigger -Daily -At $DailyTime) },
  @{ Name = "agile-team-$Prefix-tick";  Skill = "/agile-team:tick";   Trigger = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $TickMinutes)) }
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
  Write-Host "Daily runs at $DailyTime, tick every $TickMinutes min. Logs in $logDir."
  Write-Host "The tick skips itself when a previous run is still going (MultipleInstances=IgnoreNew)."
  Write-Host "If a run stops on a permission prompt, add the needed Bash(...) allow rules to .claude/settings.json (see README)."
}
