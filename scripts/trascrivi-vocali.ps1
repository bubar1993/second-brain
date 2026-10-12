# Prepara la trascrizione delle note vocali WhatsApp sul PC (una volta sola):
# 1. ambiente Python in %USERPROFILE%\.secondbrain\whisper-venv con faster-whisper e le librerie CUDA
#    (non in AppData: lanciato da Claude finirebbe nella cartella "virtuale" dell'app Claude);
# 2. attività programmata "Second Brain - note vocali" ogni 5 minuti (solo quando Giovanni è collegato, finestra nascosta).
# Il modello Whisper (circa 1.6 GB) si scarica da solo al primo vocale.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\trascrivi-vocali.ps1
$cartella = Join-Path $env:USERPROFILE '.secondbrain'
$venv = Join-Path $cartella 'whisper-venv'
$script = Join-Path $PSScriptRoot 'trascrivi-vocali.py'

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  New-Item -ItemType Directory -Force $cartella | Out-Null
  py -3.12 -m venv $venv
  & (Join-Path $venv 'Scripts\python.exe') -m pip install --upgrade pip -q
  & (Join-Path $venv 'Scripts\python.exe') -m pip install faster-whisper nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*' 'av<16' -q  # av 16+ non va con faster-whisper 1.2
}

$azione = New-ScheduledTaskAction -Execute (Join-Path $venv 'Scripts\pythonw.exe') -Argument "`"$script`"" -WorkingDirectory $cartella
$quando = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$regole = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Second Brain - note vocali' -Action $azione -Trigger $quando -Settings $regole `
  -Description 'Trascrive le note vocali WhatsApp del second brain con Whisper (scripts\trascrivi-vocali.py)' -Force | Out-Null
Write-Output 'Pronta: "Second Brain - note vocali" (ogni 5 minuti).'  # niente accenti: PowerShell 5 legge il file come ANSI
