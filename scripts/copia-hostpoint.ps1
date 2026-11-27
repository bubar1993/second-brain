# Seconda copia del backup G&C su Hostpoint Drive (27.11.2026, ok di Giovanni, piano controllato dall'antagonista).
# Copia la cartella "BACK UP FILE" del Google Drive G&C (vista dal PC in G:) nella cartella che il programma
# OX Drive di Hostpoint tiene allineata col Drive di info@. Lo script non parla con Hostpoint e non conosce
# nessuna password: carica OX Drive.
#
# Regole:
# - MAI sovrascrivere: si copiano solo i file che nella copia non ci sono ancora (robocopy /XC /XN /XO).
#   Un file rovinato su Google (virus, errore) non puo' coprire quello buono gia' copiato.
# - Niente si cancella, tranne nella sola cartella Database della copia: backup-*.json.gz e schema-*.sql
#   piu' vecchi di 60 giorni (eta' presa dalla data nel nome), tenendo SEMPRE gli ultimi 14 di ogni tipo,
#   e solo se nello stesso giro c'e' il backup di oggi.
# - Si ferma (giro "non riuscito") se G: non compare entro 10 minuti, se la cartella sorgente sembra vuota
#   (meno di 1000 file) o se manca la cartella di destinazione.
# File solo ASCII (PowerShell 5.1 legge male gli accenti nei file senza BOM).
#
# Uso:
#   .\scripts\copia-hostpoint.ps1                 giro vero
#   .\scripts\copia-hostpoint.ps1 -Prova          non copia e non cancella: dice cosa farebbe
#   .\scripts\copia-hostpoint.ps1 -Destinazione D:\prova -Prova
# Registro: %USERPROFILE%\.secondbrain\copia-hostpoint.log (righe corte) e copia-hostpoint-robocopy.log (dettaglio
# dell'ultimo giro); esito dell'ultimo giro in copia-hostpoint.json.
param(
  [switch]$Prova,
  [string]$Sorgente = 'G:\Il mio Drive\G&C\NUOVO GESTIONALE\BACK UP FILE',
  [string]$Destinazione = 'C:\Users\giova\OX Drive\My files',
  [int]$MinimoFile = 1000,
  [int]$GiorniDatabase = 60,
  [int]$TieniSempre = 14
)
$ErrorActionPreference = 'Stop'
$CARTELLA = Join-Path $env:USERPROFILE '.secondbrain'
if (-not (Test-Path $CARTELLA)) { New-Item -ItemType Directory -Path $CARTELLA | Out-Null }
$REGISTRO = Join-Path $CARTELLA 'copia-hostpoint.log'
$DETTAGLIO = Join-Path $CARTELLA 'copia-hostpoint-robocopy.log'
$ESITO = Join-Path $CARTELLA 'copia-hostpoint.json'
$PORTA = 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/copia-hostpoint'
$inizio = Get-Date

function Scrivi-Riga([string]$t) {
  $r = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $(if ($Prova) { '[prova] ' } else { '' }) + $t
  Add-Content -Path $REGISTRO -Value $r -Encoding UTF8
  Write-Output $r
}

function Salva-Esito([bool]$ok, [hashtable]$dati, [string]$errore) {
  if ($Prova) { return }
  $e = [ordered]@{ il = (Get-Date).ToString('o'); ok = $ok; errore = $errore; minuti = [math]::Round(((Get-Date) - $inizio).TotalMinutes, 1) }
  foreach ($k in $dati.Keys) { $e[$k] = $dati[$k] }
  $e | ConvertTo-Json -Compress | Set-Content -Path $ESITO -Encoding UTF8
  # Esito al second brain, per il guardiano (chiave: variabile utente di Windows HOSTPOINT_TOKEN, mai in file).
  $tok = [Environment]::GetEnvironmentVariable('HOSTPOINT_TOKEN', 'User')
  if (-not $tok) { Scrivi-Riga 'attenzione: manca HOSTPOINT_TOKEN, esito non mandato al guardiano'; return }
  try {
    $corpo = @{ ok = $ok; errore = $errore; dettagli = $e } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri $PORTA -Headers @{ 'x-hostpoint-token' = $tok } -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) -TimeoutSec 60 | Out-Null
  } catch { Scrivi-Riga "attenzione: esito non mandato al guardiano ($($_.Exception.Message))" }
}

$dati = @{}
try {
  # 1. Google Drive per desktop deve essere partito (G: e la cartella).
  $limite = (Get-Date).AddMinutes(10)
  while (-not (Test-Path -LiteralPath $Sorgente)) {
    if ((Get-Date) -gt $limite) { throw "Cartella del backup su Google Drive non trovata dopo 10 minuti: $Sorgente (Google Drive per desktop e' acceso e collegato?)" }
    Start-Sleep -Seconds 30
  }

  # 2. La sorgente non deve sembrare vuota (Drive scollegato, cartella rinominata o svuotata).
  $nSorgente = @(Get-ChildItem -LiteralPath $Sorgente -Recurse -File -Force -ErrorAction Stop | Where-Object { $_.Name -ne 'desktop.ini' }).Count
  $dati.file_sorgente = $nSorgente
  if ($nSorgente -lt $MinimoFile) { throw "Nella cartella del backup ci sono solo $nSorgente file (minimo $MinimoFile): non copio niente." }

  # 3. La cartella di OX Drive deve esistere (la crea il programma di Hostpoint, non questo script).
  # Scelta di Giovanni (27.11): le cartelle Clienti, Fornitori, Database... stanno direttamente in "My files".
  if (-not (Test-Path -LiteralPath $Destinazione)) { throw "Manca la cartella di OX Drive: $Destinazione (il programma di Hostpoint e' installato e collegato?)" }

  # 4. Copia dei soli file nuovi. /XC /XN /XO = mai sovrascrivere un file che c'e' gia'.
  $arg = @($Sorgente, $Destinazione, '/E', '/XC', '/XN', '/XO', '/XF', 'desktop.ini', '*.tmp', '~$*',
           '/R:2', '/W:5', '/NP', '/NDL', '/V', '/BYTES', "/UNILOG:$DETTAGLIO")
  if ($Prova) { $arg += '/L' }
  & robocopy.exe @arg | Out-Null
  $codice = $LASTEXITCODE
  $dati.codice_robocopy = $codice
  # Riassunto dal registro di robocopy: riga "Files :" = Totale, Copiati, Saltati, Diversi, Non riusciti, Extra.
  $righe = Get-Content -LiteralPath $DETTAGLIO -Encoding Unicode
  $f = $righe | Where-Object { $_ -match '^\s*(Files|File)\s*:\s+\d' } | Select-Object -Last 1
  if ($f) {
    $n = [regex]::Matches($f, '\d+') | ForEach-Object { [int64]$_.Value }
    if ($n.Count -ge 6) { $dati.copiati = $n[1]; $dati.gia_presenti = $n[2]; $dati.non_riusciti = $n[4] }
  }
  # File che su Google hanno lo stesso nome ma sono cambiati: NON vengono copiati (regola "mai sovrascrivere").
  # Etichette di robocopy /V: in inglese Newer/Older/Changed/Tweaked, sul Windows italiano "piu' recente", "piu' vecchio"...
  $cambiati = @($righe | Where-Object { $_ -match '^\s*(Newer|Older|Changed|Tweaked|Modified|pi. recente|pi. vecchio|modificat\w*|cambiat\w*)\s' }).Count
  $dati.cambiati_non_copiati = $cambiati
  # "Ignorati" di robocopy comprende anche i desktop.ini esclusi (etichetta "denominato" / "named").
  $esclusi = @($righe | Where-Object { $_ -match '^\s*(named|denominat\w*)\s' }).Count
  if ($null -ne $dati.gia_presenti) { $dati.gia_presenti = $dati.gia_presenti - $esclusi }
  if ($codice -ge 8) { throw "robocopy ha dato errore (codice $codice): alcuni file non sono stati copiati. Dettaglio in $DETTAGLIO" }

  # 5. Pulizia della sola cartella Database della copia.
  $db = Join-Path $Destinazione 'Database'
  $tolti = 0
  if (Test-Path -LiteralPath $db) {
    $oggi = (Get-Date).ToString('yyyy-MM-dd')
    $haOggi = Test-Path -LiteralPath (Join-Path $db "backup-$oggi.json.gz")
    if (-not $haOggi -and $Prova) { $haOggi = Test-Path -LiteralPath (Join-Path (Join-Path $Sorgente 'Database') "backup-$oggi.json.gz") }
    if ($haOggi) {
      $soglia = (Get-Date).Date.AddDays(-$GiorniDatabase)
      foreach ($tipo in @(@{ p = '^backup-(\d{4}-\d{2}-\d{2})\.json\.gz$' }, @{ p = '^schema-(\d{4}-\d{2}-\d{2})\.sql$' })) {
        $lista = @(Get-ChildItem -LiteralPath $db -File | ForEach-Object {
          $m = [regex]::Match($_.Name, $tipo.p)
          if ($m.Success) { [pscustomobject]@{ f = $_; d = [datetime]::ParseExact($m.Groups[1].Value, 'yyyy-MM-dd', $null) } }
        } | Sort-Object d -Descending)
        if ($lista.Count -le $TieniSempre) { continue }
        foreach ($x in ($lista | Select-Object -Skip $TieniSempre)) {
          if ($x.d -lt $soglia) {
            if ($Prova) { Scrivi-Riga "toglierei $($x.f.Name)" } else { Remove-Item -LiteralPath $x.f.FullName -Confirm:$false }
            $tolti++
          }
        }
      }
    } else { $dati.pulizia = "saltata: manca il backup di oggi ($oggi)" }
  }
  $dati.tolti_database = $tolti
  $nCopia = 0
  if (Test-Path -LiteralPath $Destinazione) { $nCopia = @(Get-ChildItem -LiteralPath $Destinazione -Recurse -File -Force | Where-Object { $_.Name -ne 'desktop.ini' -and $_.Name -ne '.lock' }).Count }
  $dati.file_copia = $nCopia

  Salva-Esito $true $dati $null
  Scrivi-Riga ("ok: sorgente {0} file, copiati {1}, gia' presenti {2}, cambiati su Google e non copiati {3}, database tolti {4}, nella copia {5} file" -f $nSorgente, $dati.copiati, $dati.gia_presenti, $cambiati, $tolti, $nCopia)
} catch {
  $msg = $_.Exception.Message
  Salva-Esito $false $dati $msg
  Scrivi-Riga "NON RIUSCITO: $msg"
  exit 1
}
