# Setup Daily Test Case Execution Schedule
# This script creates a Windows Task Scheduler task to run tests daily

param(
    [Parameter(Mandatory=$false)]
    [string]$Time = "HH:mm",
    [Parameter(Mandatory=$false)]
    [string]$TaskName = "DailyTestCaseExecution"
)

$config = Get-Content ".\Settings.json" -Raw | ConvertFrom-Json
$Time = $config.SCHEDULE
Write-Host $config

Write-Host "Setting up daily test case execution schedule..." -ForegroundColor Green
Write-Host "Task Name: $TaskName" -ForegroundColor Yellow
Write-Host "Execution Time: $Time daily" -ForegroundColor Yellow
Write-Host ""

# Get current directory
$CurrentDir = Get-Location
$BatchFile = Join-Path $CurrentDir "main.bat"

# Check if batch file exists
if (-not (Test-Path $BatchFile)) {
    Write-Host "ERROR: run-daily-tests.bat not found in current directory" -ForegroundColor Red
    Write-Host "Please make sure you're running this script from the correct directory" -ForegroundColor Red
    exit 1
}

try {
    # Check if task already exists
    $ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($ExistingTask) {
        Write-Host "Task '$TaskName' already exists. Removing old task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }

    # Create task action
    $Action = New-ScheduledTaskAction -Execute $BatchFile -WorkingDirectory $CurrentDir

    # Create task trigger (daily at specified time)
    $Trigger = New-ScheduledTaskTrigger -Daily -At $Time

    # Create task settings
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    # Create task principal (run as current user)
    $Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

    # Register the task
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Daily execution of CSV test cases using Test Execution MCP"

    Write-Host "✅ Task scheduled successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task Details:" -ForegroundColor Cyan
    Write-Host "  Name: $TaskName" -ForegroundColor White
    Write-Host "  Schedule: Daily at $Time" -ForegroundColor White
    Write-Host "  Command: $BatchFile" -ForegroundColor White
    Write-Host "  Working Directory: $CurrentDir" -ForegroundColor White
    Write-Host ""
    Write-Host "Management Commands:" -ForegroundColor Cyan
    Write-Host "  View task: Get-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host "  Run now: Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host "  Delete task: Unregister-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host ""
    Write-Host "The task will run automatically every day at $Time" -ForegroundColor Green
    Write-Host "Logs will be saved to daily-test-log.txt" -ForegroundColor Green
    Write-Host "Reports will be saved to daily-test-report.json" -ForegroundColor Green

} catch {
    Write-Host "ERROR: Failed to create scheduled task" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Note: You may need to run PowerShell as Administrator to create scheduled tasks" -ForegroundColor Yellow
    exit 1
}