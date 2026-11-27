# Prepara sul PC la seconda copia del backup G&C su Hostpoint Drive (una volta sola; rifarlo non fa danni):
# attivita' programmata "Second Brain - copia backup G&C su Hostpoint": ogni mattina alle 05:30 lancia
# scripts\copia-hostpoint.ps1 (solo quando Giovanni e' collegato a Windows: G: di Google Drive c'e' solo nella sua
# sessione; se il PC era spento parte appena si riaccende).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\copia-hostpoint-installa.ps1
#      (Destinazione = la cartella "My files" che OX Drive tiene allineata con Hostpoint)
# File solo ASCII: PowerShell 5 legge il file come ANSI.
param([string]$Destinazione = 'C:\Users\giova\OX Drive\My files')
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'copia-hostpoint.ps1'
if (-not (Test-Path -LiteralPath $Destinazione)) { throw "Manca la cartella di OX Drive: $Destinazione" }

# Chiave HOSTPOINT_TOKEN per mandare l'esito al guardiano: variabile utente di Windows + segreto Supabase
# (creata solo se manca; non viene mai stampata). Serve SUPABASE_ACCESS_TOKEN.
$REF = 'vgurncqvgulldolhetyr'
$tok = [Environment]::GetEnvironmentVariable('HOSTPOINT_TOKEN', 'User')
if (-not $tok) {
  $b = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $tok = ([BitConverter]::ToString($b) -replace '-', '').ToLowerInvariant()
  [Environment]::SetEnvironmentVariable('HOSTPOINT_TOKEN', $tok, 'User')
  Write-Output 'Creata la chiave (variabile di Windows HOSTPOINT_TOKEN).'
}
$api = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $api) { throw 'Manca SUPABASE_ACCESS_TOKEN' }
$corpo = ConvertTo-Json -Compress @(@{ name = 'HOSTPOINT_TOKEN'; value = $tok })
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$REF/secrets" -Headers @{ Authorization = "Bearer $api"; 'Content-Type' = 'application/json' } -Body $corpo | Out-Null
Write-Output 'Segreto HOSTPOINT_TOKEN salvato in Supabase.'

$azione = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Destinazione `"$Destinazione`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$quando = New-ScheduledTaskTrigger -Daily -At '05:30'
$regole = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Second Brain - copia backup GC su Hostpoint' -Action $azione -Trigger $quando -Settings $regole `
  -Description 'Copia ogni mattina i file nuovi del backup G&C (Google Drive, BACK UP FILE) nella cartella di OX Drive di Hostpoint. Mai sovrascrive (scripts\copia-hostpoint.ps1)' -Force | Out-Null
Write-Output "Pronta: 'Second Brain - copia backup GC su Hostpoint' (ogni mattina alle 05:30, verso $Destinazione)."
