param([string]$ClientJsonPath)
$ErrorActionPreference = 'Stop'
if (-not $ClientJsonPath) {
    $ClientJsonPath = Read-Host 'Path to your downloaded Google Desktop OAuth client JSON file'
}
$ClientJsonPath = $ClientJsonPath.Trim().Trim('"')
if (-not (Test-Path -LiteralPath $ClientJsonPath -PathType Leaf)) { throw 'OAuth client file was not found.' }
$helperPath = Join-Path $PSScriptRoot 'connect-google-mail.cjs'
& npx --yes --package=node@22 node $helperPath $ClientJsonPath
if ($LASTEXITCODE -ne 0) { throw 'Google mail connection did not finish. Follow the message above and try again.' }
