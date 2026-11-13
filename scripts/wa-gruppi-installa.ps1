# Prepara sul PC la lettura dei gruppi WhatsApp di lavoro (una volta sola; rifarlo non fa danni):
# 1. chiave GRUPPI_TOKEN: variabile utente di Windows + segreto Supabase (creata solo se manca; non viene mai stampata);
# 2. attivita' programmata "Second Brain - gruppi WhatsApp": ogni notte alle 00:05 lancia scripts\wa-gruppi.ps1
#    (solo quando Giovanni e' collegato a Windows: serve WhatsApp Desktop aperto nella sua sessione).
# Sul NAS (mini PC Windows) si rifa' uguale: stesso script, stessa chiave.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\wa-gruppi-installa.ps1   (serve SUPABASE_ACCESS_TOKEN)
# File solo ASCII: PowerShell 5 legge il file come ANSI.
$ErrorActionPreference = 'Stop'
$REF = 'vgurncqvgulldolhetyr'
$script = Join-Path $PSScriptRoot 'wa-gruppi.ps1'

$tok = [Environment]::GetEnvironmentVariable('GRUPPI_TOKEN', 'User')
if (-not $tok) {
  $b = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $tok = ([BitConverter]::ToString($b) -replace '-', '').ToLowerInvariant()
  [Environment]::SetEnvironmentVariable('GRUPPI_TOKEN', $tok, 'User')
  Write-Output 'Creata la chiave (variabile di Windows GRUPPI_TOKEN).'
}
$api = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $api) { throw 'Manca SUPABASE_ACCESS_TOKEN' }
$corpo = ConvertTo-Json -Compress @(@{ name = 'GRUPPI_TOKEN'; value = $tok })
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$REF/secrets" -Headers @{ Authorization = "Bearer $api"; 'Content-Type' = 'application/json' } -Body $corpo | Out-Null
Write-Output 'Segreto GRUPPI_TOKEN salvato in Supabase.'

$azione = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$quando = New-ScheduledTaskTrigger -Daily -At '00:05'
$regole = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Second Brain - gruppi WhatsApp' -Action $azione -Trigger $quando -Settings $regole `
  -Description 'Legge di notte i gruppi WhatsApp di lavoro da WhatsApp Desktop e li manda al second brain (scripts\wa-gruppi.ps1)' -Force | Out-Null
Write-Output 'Pronta: "Second Brain - gruppi WhatsApp" (ogni notte alle 00:05).'
