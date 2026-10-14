param([string]$File, [string]$Nome)
# Esegue un file SQL sul second brain (Management API, token nella variabile di Windows SUPABASE_ACCESS_TOKEN).
# Con -Nome lo registra come migrazione. Uso: .\scripts\sql.ps1 -File x.sql [-Nome nome_migrazione]
# Restituisce solo il risultato dell'ULTIMA istruzione del file.
$tok = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User')
$sql = [IO.File]::ReadAllText($File)
$h = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }
if ($Nome) {
  $body = @{ query = $sql; name = $Nome } | ConvertTo-Json -Compress
  $url = 'https://api.supabase.com/v1/projects/vgurncqvgulldolhetyr/database/migrations'
} else {
  $body = @{ query = $sql } | ConvertTo-Json -Compress
  $url = 'https://api.supabase.com/v1/projects/vgurncqvgulldolhetyr/database/query'
}
try {
  $r = Invoke-RestMethod -Method Post -Uri $url -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body))
  $r | ConvertTo-Json -Depth 6
} catch {
  $_.ErrorDetails.Message
}
