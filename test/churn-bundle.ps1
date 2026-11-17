$ErrorActionPreference = 'Stop'
$path = 'D:\dsh_data\profiles\web\package.json'
$backupDir = 'C:\Users\SF\Documents\deepseek-harness\default-workspace\dsh-screenshot-plugin\.install-backup'
$backup = Join-Path $backupDir 'package.json.pre-churn'
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
Copy-Item -LiteralPath $path -Destination $backup -Force

$original = Get-Content -LiteralPath $path -Raw
$doc = $original | ConvertFrom-Json
$bundles = @($doc.dsh.profile.bundles)
if (-not ($bundles -contains 'dsh-screenshot-plugin')) { throw "dsh-screenshot-plugin is not registered as a bundle" }
$without = @($bundles | Where-Object { $_ -ne 'dsh-screenshot-plugin' })
if ($without.Count -ne ($bundles.Count - 1)) { throw "unexpected bundle count: $($without.Count) of $($bundles.Count)" }

function Write-Manifest([string[]] $bundles) {
    $copy = $original | ConvertFrom-Json
    $copy.dsh.profile.bundles = $bundles
    $json = $copy | ConvertTo-Json -Depth 8
    # ConvertTo-Json escapes nothing here, but keep LF-free content deterministic.
    [System.IO.File]::WriteAllText($path, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

Write-Host "removing bundle entry..."
Write-Manifest $without
Start-Sleep -Seconds 3
Write-Host "restoring bundle entry..."
Write-Manifest @($without + 'dsh-screenshot-plugin')

$after = Get-Content -LiteralPath $path -Raw
$check = $after | ConvertFrom-Json
Write-Host ("bundles now: " + ($check.dsh.profile.bundles -join ', '))
Write-Host ("dependencies intact: " + ($check.dependencies.PSObject.Properties.Name -join ', '))
if (-not ($check.dsh.profile.bundles -contains 'dsh-screenshot-plugin')) { throw "bundle entry missing after restore" }
Write-Host "churn complete"
