# Finestra dove Giovanni incolla il token del "pulsante remoto" (trigger API) di una routine.
# Il token non si vede mentre lo incolli, non passa dalla chat e non resta in nessun file:
# va solo nel segreto ROUTINE_TOKEN_<AGENTE> del second brain.
# Uso: powershell -File scripts\salva-pulsante-finestra.ps1 <lavoro|ceramex|gc|calendario|privato>
param([Parameter(Mandatory = $true)][ValidateSet('lavoro', 'ceramex', 'gc', 'calendario', 'privato')][string]$Agente)

$Host.UI.RawUI.WindowTitle = "Second Brain - codice dell'agente $Agente"
Write-Host ""
Write-Host "Codice per l'agente: $Agente" -ForegroundColor Cyan
Write-Host "Incolla il codice (comincia con sk-ant-oat01-): tasto destro del mouse oppure Ctrl+V, poi Invio."
Write-Host "Mentre incolli non vedi niente: e' normale."
$sicuro = Read-Host -AsSecureString "Codice"
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicuro)).Trim()

if ($token -notmatch '^sk-ant-oat01-[A-Za-z0-9_-]{20,}$') {
  Write-Host ""
  Write-Host "Questo non e' il codice giusto (deve cominciare con sk-ant-oat01-). Niente salvato." -ForegroundColor Red
} else {
  $api = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
  $nome = "ROUTINE_TOKEN_$($Agente.ToUpper())"
  $corpo = ConvertTo-Json -InputObject @(@{ name = $nome; value = $token }) -Compress
  try {
    Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/vgurncqvgulldolhetyr/secrets' `
      -Headers @{ Authorization = "Bearer $api" } -ContentType 'application/json' -Body $corpo | Out-Null
    Write-Host ""
    Write-Host "Fatto: codice salvato. Puoi chiudere questa finestra." -ForegroundColor Green
  } catch {
    Write-Host ""
    Write-Host "Non sono riuscito a salvarlo: $($_.Exception.Message)" -ForegroundColor Red
  }
}
$token = $null
Write-Host ""
Read-Host "Premi Invio per chiudere"
