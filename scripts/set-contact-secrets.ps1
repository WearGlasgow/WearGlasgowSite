# Compatibility entry point: app-password setup has been replaced by Google OAuth.
param([string]$ClientJsonPath)
& (Join-Path $PSScriptRoot 'connect-google-mail.ps1') -ClientJsonPath $ClientJsonPath
