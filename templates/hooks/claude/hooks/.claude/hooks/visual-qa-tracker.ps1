# Visual QA Tracker - PostToolUse Hook
# Records when UI files are modified so Stop hook can verify visual QA was done

param(
    [string]$ToolName,
    [string]$FilePath
)

# Define UI file patterns
$uiPatterns = @(
    "*.tsx", "*.jsx", "*.vue", "*.svelte",
    "*.css", "*.scss", "*.sass", "*.less",
    "*.html", "*.htm",
    "*/components/*", "*/pages/*", "*/app/*", "*/views/*"
)

# Check if the file matches UI patterns
function Test-IsUiFile {
    param([string]$Path)

    foreach ($pattern in $uiPatterns) {
        if ($Path -like $pattern) {
            return $true
        }
    }

    # Check for common UI paths
    if ($Path -match "(components|pages|app|views|layouts|templates)" -and
        $Path -match "\.(tsx|jsx|vue|svelte|css|scss|html)$") {
        return $true
    }

    return $false
}

# Only process Write and Edit tool calls
if ($ToolName -notin @("Write", "Edit")) {
    exit 0
}

# Check if this is a UI file
if (-not (Test-IsUiFile $FilePath)) {
    exit 0
}

# Record the UI modification
$trackingDir = Join-Path $PSScriptRoot "..\..\.fastops\visual-qa-tracking"
if (-not (Test-Path $trackingDir)) {
    New-Item -ItemType Directory -Path $trackingDir -Force | Out-Null
}

$trackingFile = Join-Path $trackingDir "modified-ui-files.json"
$timestamp = Get-Date -Format "o"

# Load existing tracking data or create new
if (Test-Path $trackingFile) {
    $tracking = Get-Content $trackingFile | ConvertFrom-Json
    if (-not $tracking.files) {
        $tracking = @{ files = @(); session_start = $timestamp }
    }
} else {
    $tracking = @{ files = @(); session_start = $timestamp }
}

# Add this file if not already tracked
$existingFile = $tracking.files | Where-Object { $_.path -eq $FilePath }
if (-not $existingFile) {
    $tracking.files += @{
        path = $FilePath
        modified_at = $timestamp
        tool = $ToolName
        verified = $false
    }
}

# Save tracking data
$tracking | ConvertTo-Json -Depth 10 | Set-Content $trackingFile

Write-Host "[Visual QA Tracker] Recorded UI modification: $FilePath"
