# Gruppi WhatsApp di lavoro -> second brain (13.11.2026, ok di Giovanni).
# I gruppi non passano dal collegamento ufficiale di Meta. Questo programma li legge da WhatsApp Desktop (l'app
# ufficiale, gia' collegata al numero di Giovanni) con l'accessibilita' di Windows (UI Automation: la stessa strada
# dei lettori di schermo). NON usa l'AI, NON scrive mai in WhatsApp, NON apre link o allegati, NON tocca altre chat:
# apre solo i gruppi della lista (nome IDENTICO), legge i messaggi e li manda alla funzione wa-gruppi.
# File solo ASCII (PowerShell 5.1 legge male gli accenti nei file senza BOM).
#
# Uso:
#   .\scripts\wa-gruppi.ps1                       giro vero: lista dei gruppi dalla porta, lettura, invio
#   .\scripts\wa-gruppi.ps1 -Prova -Gruppi 'A','B'  non manda niente: dice cosa leggerebbe (con -Mostra anche i testi)
#   .\scripts\wa-gruppi.ps1 -Elenca 'Business'      scrive la parola nella ricerca e stampa i nomi esatti delle chat trovate
# Chiave: variabile utente di Windows GRUPPI_TOKEN (mai in file). Registro: %USERPROFILE%\.secondbrain\wa-gruppi.log
param(
  [switch]$Prova,
  [string[]]$Gruppi,
  [switch]$Mostra,
  [string]$Elenca,
  [int]$Giorni = 2
)
$ErrorActionPreference = 'Stop'
$PORTA = 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/wa-gruppi'
$APP = 'shell:AppsFolder\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'
$REGISTRO = Join-Path $env:USERPROFILE '.secondbrain\wa-gruppi.log'

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class WaWin {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, P f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  public static List<IntPtr> Tutte() {
    var l = new List<IntPtr>(); EnumWindows((h, x) => { l.Add(h); return true; }, IntPtr.Zero);
    var figli = new List<IntPtr>(); foreach (var t in l) EnumChildWindows(t, (h, x) => { figli.Add(h); return true; }, IntPtr.Zero);
    l.AddRange(figli); return l;
  }
  public static string Classe(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  // Il segnale che mandano i lettori di schermo: accende l'albero di accessibilita' della pagina.
  public static void Sveglia(IntPtr h) { IntPtr r; SendMessageTimeout(h, 0x003D, IntPtr.Zero, new IntPtr(1), 2, 2000, out r); }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  // La finestra principale di WhatsApp Desktop (quella che Giovanni vede).
  public static IntPtr Principale() {
    IntPtr t = IntPtr.Zero;
    EnumWindows((h, x) => { var n = new StringBuilder(256); GetWindowText(h, n, 256);
      if (Classe(h) == "WinUIDesktopWin32WindowClass" && n.ToString() == "WhatsApp") { t = h; return false; } return true; }, IntPtr.Zero);
    return t;
  }
}
'@
$UIA = [System.Windows.Automation.AutomationElement]

function Scrivi-Registro([string]$riga) {
  try {
    $dir = Split-Path $REGISTRO
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    Add-Content -Path $REGISTRO -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $riga) -Encoding UTF8
  } catch {}
}

# --- trovare la pagina di WhatsApp ---
function Trova-Maniglia {
  $proc = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name
  $ids = New-Object System.Collections.Generic.HashSet[uint32]
  foreach ($p in $proc) { if ($p.Name -like 'WhatsApp*') { [void]$ids.Add([uint32]$p.ProcessId) } }
  if ($ids.Count -eq 0) { return [IntPtr]::Zero }
  foreach ($passo in 1..4) { foreach ($p in $proc) { if ($ids.Contains([uint32]$p.ParentProcessId)) { [void]$ids.Add([uint32]$p.ProcessId) } } }
  foreach ($h in [WaWin]::Tutte()) {
    if ($ids.Contains([uint32][WaWin]::Pid($h)) -and [WaWin]::Classe($h) -eq 'Chrome_RenderWidgetHostHWND') { return $h }
  }
  return [IntPtr]::Zero
}

# Fotografia dell'albero: un elenco piatto, in ordine di lettura, con tipo, nome e livello di ogni elemento.
function Foto-Albero($radice) {
  $cr = New-Object System.Windows.Automation.CacheRequest
  $cr.Add($UIA::NameProperty); $cr.Add($UIA::ControlTypeProperty)
  $cr.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
  $cr.TreeFilter = [System.Windows.Automation.Automation]::RawViewCondition
  $cr.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
  $cima = $radice.GetUpdatedCache($cr)
  $elenco = New-Object System.Collections.Generic.List[object]
  $pila = New-Object System.Collections.Generic.Stack[object]
  $pila.Push(@($cima, 0, $null))
  while ($pila.Count -gt 0) {
    $v = $pila.Pop(); $e = $v[0]
    $nodo = [pscustomobject]@{
      El = $e; Liv = $v[1]; Padre = $v[2]; I = $elenco.Count
      Tipo = ($e.Cached.ControlType.ProgrammaticName -replace 'ControlType\.', '')
      Nome = [string]$e.Cached.Name
    }
    $elenco.Add($nodo)
    $figli = $e.CachedChildren
    for ($k = $figli.Count - 1; $k -ge 0; $k--) { $pila.Push(@($figli[$k], ($v[1] + 1), $nodo)) }
  }
  return ,$elenco
}

# Vero se la finestra di WhatsApp e' quella attiva (Giovanni la sta usando).
function WhatsApp-Davanti {
  $f = [WaWin]::Principale()
  return ($f -ne [IntPtr]::Zero -and [WaWin]::GetForegroundWindow() -eq $f)
}

function Apri-WhatsApp {
  $h = Trova-Maniglia
  $fin = [WaWin]::Principale()
  if ($h -eq [IntPtr]::Zero -or $fin -eq [IntPtr]::Zero -or -not [WaWin]::IsWindowVisible($fin)) {
    # chiuso o nascosto (es. dopo un riavvio del PC): lo apre come un doppio clic sull'icona. All'avvio nessuna chat e' aperta.
    Start-Process $APP
    foreach ($attesa in 1..30) { Start-Sleep -Seconds 2; $h = Trova-Maniglia; $fin = [WaWin]::Principale(); if ($h -ne [IntPtr]::Zero -and $fin -ne [IntPtr]::Zero) { break } }
    if ($h -eq [IntPtr]::Zero -or $fin -eq [IntPtr]::Zero) { throw 'WhatsApp Desktop non parte' }
    Start-Sleep -Seconds 6
    # appena aperto e' davanti: lo si mette giu' e lo si riapre SENZA portarlo davanti (cosi' non segna niente come letto)
    [void][WaWin]::ShowWindow($fin, 6); Start-Sleep -Seconds 1; [void][WaWin]::ShowWindow($fin, 4); Start-Sleep -Seconds 2
  }
  if ($h -eq [IntPtr]::Zero) { throw 'WhatsApp Desktop non parte' }
  # ridotta a icona la pagina non si aggiorna (provato il 13.11.2026): si riapre SENZA portarla davanti e alla fine si rimette giu'
  $script:finestra = $fin; $script:eraIcona = $false
  if ($fin -ne [IntPtr]::Zero -and [WaWin]::IsIconic($fin)) { $script:eraIcona = $true; [void][WaWin]::ShowWindow($fin, 4); Start-Sleep -Seconds 2 }
  # Se Giovanni sta usando WhatsApp (finestra davanti) non si tocca niente: gli cambierebbe la chat aperta e
  # segnerebbe i messaggi come letti. Il giro vero aspetta fino a mezz'ora, la prova no.
  $giri = $(if ($Prova -or $Elenca) { 1 } else { 30 })
  foreach ($attesa in 1..$giri) { if (-not (WhatsApp-Davanti)) { break }; if ($attesa -lt $giri) { Start-Sleep -Seconds 60 } }
  if (WhatsApp-Davanti) { throw 'WhatsApp in primo piano: Giovanni lo sta usando, lettura saltata' }
  [WaWin]::Sveglia($h)
  foreach ($attesa in 1..20) {
    $radice = $UIA::FromHandle($h)
    $foto = Foto-Albero $radice
    if ((Casella-Ricerca $foto) -and ($foto | Where-Object { $_.Tipo -eq 'TabItem' })) { return $radice }
    if ($foto | Where-Object { $_.Nome -like '*codice QR*' -or $_.Nome -like '*Collega*telefono*' }) { throw 'WhatsApp Desktop non e'' collegato al telefono' }
    Start-Sleep -Seconds 2; [WaWin]::Sveglia($h)
  }
  throw 'WhatsApp Desktop: la lista delle chat non si vede (finestra chiusa o bloccata?)'
}

# --- azioni: solo premere una riga/un pulsante e scrivere nella casella di RICERCA ---
function Premi($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return $true }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return $true }
  return $false
}
# Dove finisce la colonna di sinistra (lista delle chat) e comincia la conversazione aperta.
function Fine-Lista($foto) {
  $limite = $foto | Where-Object { $_.Tipo -eq 'Button' -and ($_.Nome -like 'Ridimensiona la scheda*' -or $_.Nome -like 'Informazioni sul gruppo *' -or $_.Nome -like 'Informazioni sul contatto*' -or $_.Nome -like 'Dettagli profilo*') } | Select-Object -First 1
  if ($limite) { return $limite.I }
  $scrivi = $foto | Where-Object { $_.Tipo -eq 'Edit' -and $_.Nome -like 'Digita*' } | Select-Object -First 1
  if ($scrivi) { return $scrivi.I }
  return $foto.Count
}
# La casella di RICERCA delle chat. Si accetta solo se si e' davvero sulla lista delle chat (c'e' la scheda "Tutte"
# subito dopo) e la casella si chiama "Cerca..." (vuota) oppure non ha nome ma ha accanto la X (ricerca in corso).
# In ogni altro caso (Impostazioni, Profilo, Nuova chat, casella "Digita un messaggio") niente: il gruppo risulta non trovato.
function Casella-Ricerca($foto) {
  $max = Fine-Lista $foto
  $tutte = $foto | Where-Object { $_.I -lt $max -and $_.Tipo -eq 'TabItem' -and $_.Nome -eq 'Tutte' } | Select-Object -First 1
  if (-not $tutte) { return $null }
  $c = $foto | Where-Object { $_.I -lt $tutte.I -and $_.Tipo -eq 'Edit' } | Select-Object -First 1
  if (-not $c) { return $null }
  if ($c.Nome -like 'Cerca*') { return $c }
  if (-not $c.Nome) {
    $x = $foto | Where-Object { $_.I -gt $c.I -and $_.I -lt $tutte.I -and $_.Tipo -eq 'Button' -and $_.Nome -eq 'End icon button' } | Select-Object -First 1
    if ($x) { return $c }
  }
  return $null
}
function Scrivi-Ricerca($radice, [string]$testo) {
  $cerca = Casella-Ricerca (Foto-Albero $radice)
  if (-not $cerca) { return $false }
  $p = $null
  if (-not $cerca.El.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { return $false }
  $p.SetValue($testo)
  return $true
}
# Toglie la ricerca: preme la X della casella (se c'e'), altrimenti svuota il testo.
function Chiudi-Ricerca($radice) {
  $foto = Foto-Albero $radice
  $max = Fine-Lista $foto
  $cerca = Casella-Ricerca $foto
  if (-not $cerca) { return }
  $x = $foto | Where-Object { $_.I -gt $cerca.I -and $_.I -lt $max -and $_.I -le ($cerca.I + 6) -and $_.Tipo -eq 'Button' -and ($_.Nome -eq 'End icon button' -or $_.Nome -like 'Annulla ricerca*' -or $_.Nome -like 'Cancella*') } | Select-Object -First 1
  if ($x) { [void](Premi $x.El) } else { [void](Scrivi-Ricerca $radice '') }
}

# --- leggere ---
function Semplice([string]$s) {
  $d = $s.Normalize([Text.NormalizationForm]::FormD); $b = New-Object Text.StringBuilder
  foreach ($ch in $d.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$b.Append($ch) }
  }
  return $b.ToString().ToLowerInvariant().Trim()
}
function Data-Etichetta([string]$t, [datetime]$oggi) {
  $s = Semplice $t
  if ($s -eq 'oggi') { return $oggi.Date }
  if ($s -eq 'ieri') { return $oggi.Date.AddDays(-1) }
  if ($s -match '^(\d{1,2})/(\d{1,2})/(\d{4})$') { return (New-Object datetime ([int]$Matches[3]), ([int]$Matches[2]), ([int]$Matches[1])) }
  $nomi = 'domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'
  $k = [array]::IndexOf($nomi, $s)
  if ($k -ge 0) { foreach ($j in 1..7) { $d = $oggi.Date.AddDays(-$j); if ([int]$d.DayOfWeek -eq $k) { return $d } } }
  return $null
}
function Chat-Aperta($foto) {
  $b = $foto | Where-Object { $_.Tipo -eq 'Button' -and $_.Nome -like 'Informazioni sul gruppo *' } | Select-Object -First 1
  if ($b) { return $b.Nome.Substring('Informazioni sul gruppo '.Length) }
  return $null
}
function Fine-Ramo($foto, $nodo) {
  $j = $nodo.I + 1
  while ($j -lt $foto.Count -and $foto[$j].Liv -gt $nodo.Liv) { $j++ }
  return $j   # primo indice FUORI dal ramo
}
$ETICHETTE = 'Apri', 'Salva come...', 'Inoltra media', 'Inoltra', 'Scarica', 'Messaggio citato'

# Fotografia della chat aperta: le righe dei messaggi in ordine (dall'alto), ognuna con il suo giorno.
# WhatsApp riempie solo le righe vicine al punto in cui si guarda: le altre sono vuote (Resa = falso).
function Leggi-Chat($foto, [string]$gruppo, [datetime]$oggi) {
  $ini = $foto | Where-Object { $_.Tipo -eq 'Button' -and $_.Nome -eq ('Informazioni sul gruppo ' + $gruppo) } | Select-Object -First 1
  if (-not $ini) { return $null }
  $fine = $foto | Where-Object { $_.I -gt $ini.I -and $_.Tipo -eq 'Edit' -and $_.Nome -like 'Digita un messaggio*' } | Select-Object -First 1
  $ultimoI = if ($fine) { $fine.I } else { $foto.Count }
  $righe = New-Object System.Collections.Generic.List[object]
  $prima = $null
  for ($q = $ini.I + 1; $q -lt $ultimoI; $q++) { if ($foto[$q].Tipo -eq 'DataItem') { $prima = $foto[$q]; break } }
  if (-not $prima) { return [pscustomobject]@{ Righe = $righe } }
  $livRiga = $prima.Liv
  $giorno = $null; $mittente = $null; $prossimo = $null
  $i = $ini.I + 1
  while ($i -lt $ultimoI) {
    $n = $foto[$i]
    if ($n.Tipo -eq 'Button' -and $n.Nome -like 'Apri dettagli chat di *') { $prossimo = $n.Nome.Substring('Apri dettagli chat di '.Length); $i++; continue }
    if ($n.Tipo -eq 'Text') {
      # etichette vere del giorno: un livello sotto le righe. La data "galleggiante" in cima sta altrove e non conta.
      if ($n.Liv -eq $livRiga + 1) {
        $d = Data-Etichetta $n.Nome $oggi
        if ($d) { $giorno = $d; $mittente = $null; $prossimo = $null }
      }
      $i++; continue
    }
    if ($n.Tipo -ne 'DataItem' -or $n.Liv -ne $livRiga) { $i++; continue }
    # una riga = un messaggio
    $stop = Fine-Ramo $foto $n
    $resa = $false
    for ($q = $i + 1; $q -lt $stop; $q++) { if ($foto[$q].Nome) { $resa = $true; break } }
    if (-not $resa) {
      $mittente = $null; $prossimo = $null
      $righe.Add([pscustomobject]@{ Resa = $false; Giorno = $giorno; Msg = $null; Nodo = $n; Espandi = $null })
      $i = $stop; continue
    }
    $ora = $null; $mio = $false; $citato = $null; $file = $null; $vocale = $false; $video = $false; $immagini = 0; $espandi = $null
    $chiRiga = $null; $vistoContenuto = $false
    $pezzi = New-Object System.Collections.Generic.List[object]
    $j = $i + 1
    while ($j -lt $stop) {
      $x = $foto[$j]
      if ($x.Tipo -eq 'Group' -and $x.Nome -match '^Tu:?\s*$') { $mio = $true; $j++; continue }
      if ($x.Tipo -eq 'Button') {
        if ($x.Nome -eq 'Messaggio citato') {
          $fuori = Fine-Ramo $foto $x
          for ($q = $x.I + 1; $q -lt $fuori; $q++) { if ($foto[$q].Tipo -eq 'Button') { $citato = $foto[$q].Nome; break } }
          $vistoContenuto = $true; $j = $fuori; continue
        }
        if ($x.Nome -match ' \d+([.,]\d+)? (kB|MB|GB)( \d{1,2}:\d{2})?$') {
          $fuori = Fine-Ramo $foto $x; $lungo = ''
          for ($q = $x.I + 1; $q -lt $fuori; $q++) {
            $y = $foto[$q]
            if ($y.Tipo -ne 'Text') { continue }
            if ($y.Nome -match '^\d{1,2}:\d{2}$') { $ora = $y.Nome } elseif ($y.Nome.Length -gt $lungo.Length) { $lungo = $y.Nome }
          }
          $file = $lungo; $vistoContenuto = $true; $j = $fuori; continue
        }
        if ($x.Nome -like '*vocale*') { $vocale = $true; $vistoContenuto = $true; $j++; continue }
        if ($x.Nome -like '*video*') { $video = $true; $vistoContenuto = $true; $j++; continue }
        if ($x.Nome -like 'Apri immagine*' -or $x.Nome -like 'Apri foto*') { $immagini++; $vistoContenuto = $true; $j++; continue }
        if ($x.Nome -like 'Leggi tutto*' -or $x.Nome -like 'Leggi altro*') { $espandi = $x; $j = Fine-Ramo $foto $x; continue }
        if ($ETICHETTE -contains $x.Nome) { $j = Fine-Ramo $foto $x; continue }
        # il primo pulsante della riga, prima di ogni contenuto, e' il nome di chi scrive
        if (-not $vistoContenuto -and -not $chiRiga -and -not $mio -and $x.Nome -and $x.Nome -notmatch '^\d{1,2}:\d{2}') { $chiRiga = $x.Nome; $j = Fine-Ramo $foto $x; continue }
        $j++; continue
      }
      if ($x.Tipo -eq 'Image') {
        # emoji = immagine col nome corto; le icone (wds-ic-...) e le foto senza nome non sono testo
        if ($x.Nome -and $x.Nome.Length -le 8 -and $x.Nome -notmatch '^[a-zA-Z0-9_\-]+$') { $pezzi.Add($x); $vistoContenuto = $true }
        $j++; continue
      }
      if ($x.Tipo -eq 'Text') {
        # il testo "contenitore" (che ripete i figli) si salta: si tengono le foglie
        $haFigliTesto = ($j + 1 -lt $stop) -and ($foto[$j + 1].Liv -gt $x.Liv) -and ($foto[$j + 1].Tipo -in 'Text', 'Image')
        if (-not $haFigliTesto) { $pezzi.Add($x); $vistoContenuto = $true }
        $j++; continue
      }
      $j++
    }
    # ore (hh:mm): l'ultima e' l'ora del messaggio; "+3" = altre foto di un album; "Inoltrato"/"Modificato" non sono testo
    $altre = 0
    for ($k = $pezzi.Count - 1; $k -ge 0; $k--) {
      $t = $pezzi[$k]
      if ($t.Tipo -ne 'Text') { continue }
      if ($t.Nome -match '^\d{1,2}:\d{2}$') { if (-not $ora) { $ora = $t.Nome }; $pezzi.RemoveAt($k); continue }
      if ($t.Nome -match '^\+(\d+)$') { $altre = [int]$Matches[1]; $pezzi.RemoveAt($k); continue }
      if ($t.Nome -in 'Inoltrato', 'Modificato', 'Inoltrato molte volte') { $pezzi.RemoveAt($k); continue }
    }
    # i pezzi di testo si attaccano; tra due blocchi senza spazio in mezzo se ne mette uno
    $sb = New-Object Text.StringBuilder
    foreach ($t in $pezzi) {
      $pz = [string]$t.Nome
      if ($sb.Length -gt 0 -and $pz.Length -gt 0 -and -not [char]::IsWhiteSpace($sb[$sb.Length - 1]) -and -not [char]::IsWhiteSpace($pz[0]) -and '.,;:!?)'.IndexOf($pz[0]) -lt 0 -and $t.Tipo -eq 'Text' -and $pz.Length -gt 2) { [void]$sb.Append(' ') }
      [void]$sb.Append($pz)
    }
    $testo = $sb.ToString().Trim()
    if ($mio) { $chi = 'Tu' }
    elseif ($chiRiga) { $chi = $chiRiga }
    elseif ($prossimo) { $chi = $prossimo }
    else { $chi = $mittente }
    # contatto non in rubrica: WhatsApp scrive "Forse <nome>" e mette il numero come primo testo
    if ($chi -and $chi.StartsWith('Forse ')) { $chi = '~' + $chi.Substring(6) }
    $testo = ($testo -replace '^\+\d[\d ]{6,20}\s+', '').Trim()
    $prossimo = $null; $mittente = $chi
    $tipo = 'testo'
    if ($file) { $tipo = 'documento'; $testo = ('[file: ' + $file + '] ' + $testo).Trim() }
    elseif ($vocale) { $tipo = 'vocale'; if (-not $testo) { $testo = '[messaggio vocale]' } }
    elseif ($video) { $tipo = 'foto'; $testo = ('[video] ' + $testo).Trim() }
    elseif ($immagini -gt 0) { $tipo = 'foto'; $quante = $immagini + $altre; $testo = ($(if ($quante -gt 1) { '[' + $quante + ' foto] ' } else { '[foto] ' }) + $testo).Trim() }
    $msg = $null
    if ($giorno -and $ora -and $testo -and (Semplice $testo) -notlike '*messaggio*eliminato*') {
      $hm = $ora.Split(':')
      $quando = $giorno.AddHours([int]$hm[0]).AddMinutes([int]$hm[1])
      $dir = $(if ($mio) { 'out' } else { 'in' })
      $msg = [pscustomobject]@{ data = $quando; mittente = $chi; direzione = $dir; tipo = $tipo; testo = $testo; citazione = $citato
        chiave = ($quando.ToString('yyyy-MM-ddTHH:mm') + '|' + $dir + '|' + $tipo + '|' + ((Semplice $testo) -replace '\s+', ' ')) }
    }
    $righe.Add([pscustomobject]@{ Resa = $true; Giorno = $giorno; Msg = $msg; Nodo = $n; Espandi = $espandi })
    $i = $stop
  }
  return [pscustomobject]@{ Righe = $righe }
}

# Il nome di una cella della lista e' "[N messaggi non letti ]<titolo> <ora o data>": torna il titolo (o niente).
$CODE = 'ieri', 'oggi', 'domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'
function Titolo-Cella([string]$nome) {
  $s = $nome -replace '^\d+ messagg\w+ non lett\w+ ', ''
  $k = $s.LastIndexOf(' ')
  if ($k -lt 1) { return $null }
  $coda = Semplice $s.Substring($k + 1)
  if ($coda -match '^\d{1,2}:\d{2}$' -or $coda -match '^\d{1,2}/\d{1,2}/\d{4}$' -or ($CODE -contains $coda)) { return $s.Substring(0, $k) }
  return $null
}
# Riga del gruppo nella lista delle chat: titolo IDENTICO, una sola riga, e (durante una ricerca) solo nella parte "Chat".
# Torna la riga intera, la cella da premere e quanti messaggi non letti segna.
function Riga-Gruppo($foto, [string]$gruppo) {
  $max = Fine-Lista $foto
  $trovate = New-Object System.Collections.Generic.List[object]
  foreach ($c in $foto) {
    if ($c.I -ge $max) { break }
    if ($c.Tipo -ne 'DataItem' -or -not $c.Nome) { continue }
    if ((Titolo-Cella $c.Nome) -ne $gruppo) { continue }
    # la riga intera e' l'antenato che sta direttamente nella griglia delle chat
    $riga = $c; $su = $c.Padre
    while ($su -and $su.Tipo -notin 'DataGrid', 'Table', 'List') { if ($su.Tipo -eq 'DataItem') { $riga = $su }; $su = $su.Padre }
    # titolo della parte della lista (Chat, Contatti, Messaggi...): la riga-titolo piu' vicina sopra, senza celle dentro
    $parte = $null
    for ($j = $riga.I - 1; $j -ge 0; $j--) {
      $x = $foto[$j]
      if ($x.Liv -lt $riga.Liv) { break }
      if ($x.Liv -eq $riga.Liv -and $x.Tipo -eq 'DataItem') {
        $haCelle = ($j + 1 -lt $foto.Count) -and ($foto[$j + 1].Liv -gt $x.Liv) -and ($foto | Where-Object { $_.I -gt $x.I -and $_.I -lt (Fine-Ramo $foto $x) -and $_.Tipo -eq 'DataItem' })
        if (-not $haCelle) { $parte = $x.Nome; break }
      }
    }
    if ($parte -and $parte -ne 'Chat') { continue }
    $nonLetti = 0
    if ($riga.Nome -match '^(\d+) messagg\w+ non lett') { $nonLetti = [int]$Matches[1] }
    if (-not ($trovate | Where-Object { $_.Riga.I -eq $riga.I })) { $trovate.Add([pscustomobject]@{ Riga = $riga; Cella = $c; NonLetti = $nonLetti }) }
  }
  if ($trovate.Count -ne 1) { return $null }
  return $trovate[0]
}
# Cerca il gruppo (prima nella lista cosi' com'e', poi con la ricerca) e torna la sua riga. $script:cercato dice se la ricerca e' aperta.
function Trova-Gruppo($radice, [string]$gruppo) {
  $r = Riga-Gruppo (Foto-Albero $radice) $gruppo
  if ($r) { return $r }
  # nella ricerca si scrivono solo le lettere del nome (le emoji la confondono); il confronto resta sul nome intero
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $gruppo.ToCharArray()) { if ([int]$ch -lt 0x2000 -and -not [char]::IsSurrogate($ch)) { [void]$sb.Append($ch) } }
  $parole = ($sb.ToString() -replace '\s+', ' ').Trim()
  if (-not $parole -or -not (Scrivi-Ricerca $radice $parole)) { return $null }
  $script:cercato = $true
  foreach ($attesa in 1..6) { Start-Sleep -Milliseconds 800; $r = Riga-Gruppo (Foto-Albero $radice) $gruppo; if ($r) { return $r } }
  return $null
}
function Apri-Gruppo($radice, [string]$gruppo) {
  $script:cercato = $false; $script:nonLettiPrima = 0
  $foto = Foto-Albero $radice
  $r = Trova-Gruppo $radice $gruppo
  if ($r) { $script:nonLettiPrima = $r.NonLetti }
  $ok = ((Chat-Aperta $foto) -eq $gruppo)
  if (-not $ok -and $r) {
    $bersagli = @($r.Cella); $p = $r.Cella.Padre
    while ($p -and $p.Tipo -notin 'DataGrid', 'Table', 'List') { if ($p.Tipo -eq 'DataItem') { $bersagli += $p }; $p = $p.Padre }
    foreach ($b in $bersagli) {
      if (-not (Premi $b.El)) { continue }
      foreach ($attesa in 1..8) { Start-Sleep -Milliseconds 700; if ((Chat-Aperta (Foto-Albero $radice)) -eq $gruppo) { $ok = $true; break } }
      if ($ok) { break }
    }
  }
  if ($script:cercato) { Chiudi-Ricerca $radice; $script:cercato = $false }
  return $ok
}
# Quanti messaggi non letti segna adesso la riga del gruppo (-1 = riga non trovata).
function Non-Letti($radice, [string]$gruppo) {
  $script:cercato = $false
  $r = Trova-Gruppo $radice $gruppo
  if ($script:cercato) { Chiudi-Ricerca $radice; $script:cercato = $false }
  if ($r) { return $r.NonLetti }
  return -1
}

# Cuce una fotografia con quello che e' gia' stato letto: $G e' l'elenco in ordine (dall'alto), $idx le chiavi gia' viste.
function Unisci($G, $idx, $righe) {
  $nuovi = 0; $pos = -1
  $attesa = New-Object System.Collections.Generic.List[object]
  foreach ($r in $righe) {
    if (-not $r.Resa -or -not $r.Msg) { continue }
    $k = $r.Msg.chiave
    if ($idx.ContainsKey($k)) {
      $rec = $idx[$k]
      if (-not $rec.mittente -and $r.Msg.mittente) { $rec.mittente = $r.Msg.mittente }
      $pos = $G.IndexOf($rec)
      if ($attesa.Count -gt 0) { $G.InsertRange($pos, $attesa); $pos += $attesa.Count; $attesa.Clear() }
    } else {
      $idx[$k] = $r.Msg; $nuovi++
      if ($pos -ge 0) { $G.Insert($pos + 1, $r.Msg); $pos++ } else { $attesa.Add($r.Msg) }
    }
  }
  if ($attesa.Count -gt 0) {
    # nessuna riga gia' nota in questa fotografia: le piu' vecchie in cima, le piu' nuove in fondo
    if ($G.Count -eq 0 -or $attesa[$attesa.Count - 1].data -le $G[0].data) { $G.InsertRange(0, $attesa) } else { $G.AddRange($attesa) }
  }
  return $nuovi
}
function Scroll-Di($nodo) {
  $p = $nodo.Padre
  while ($p) {
    $x = $null
    if ($p.El.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$x)) { if ($x.Current.VerticallyScrollable) { return $x } }
    $p = $p.Padre
  }
  return $null
}
# Porta la conversazione in fondo (ultimi messaggi) e controlla di esserci davvero.
function In-Fondo($radice, [string]$gruppo, [datetime]$oggi) {
  foreach ($tentativo in 1..4) {
    $foto = Foto-Albero $radice
    $giu = $foto | Where-Object { $_.Tipo -eq 'Button' -and $_.Nome -eq 'Scorri in fondo' } | Select-Object -First 1
    if ($giu) { [void](Premi $giu.El); Start-Sleep -Milliseconds 900; $foto = Foto-Albero $radice }
    $s = Leggi-Chat $foto $gruppo $oggi
    if (-not $s -or $s.Righe.Count -eq 0) { return }
    $sc = Scroll-Di $s.Righe[0].Nodo
    if (-not $sc) { return }
    if ($sc.Current.VerticalScrollPercent -ge 99) { return }
    try { $sc.SetScrollPercent(-1, 100) } catch {}
    Start-Sleep -Milliseconds 900
  }
}

# Legge un gruppo dal fondo salendo a passi, finche' vede un giorno piu' vecchio di $da (o la storia finisce).
function Leggi-Gruppo($radice, [string]$gruppo, [datetime]$da, [datetime]$oggi) {
  if (-not (Apri-Gruppo $radice $gruppo)) { return $null }
  Start-Sleep -Milliseconds 800
  In-Fondo $radice $gruppo $oggi
  $G = New-Object System.Collections.Generic.List[object]; $idx = @{}
  $fermo = 0; $passi = 0; $piuVecchio = $null
  # Completo = si e' arrivati davvero fino a $da (o alla fine della storia). Se no i messaggi NON si mandano:
  # altrimenti al giro dopo si ripartirebbe dall'ultimo salvato e il buco in mezzo andrebbe perso.
  $completo = $false
  $tempo = [Diagnostics.Stopwatch]::StartNew()
  while ($passi -lt 200 -and $tempo.Elapsed.TotalSeconds -lt 150) {
    $passi++
    $s = Leggi-Chat (Foto-Albero $radice) $gruppo $oggi
    if (-not $s) { return $null }
    # messaggi lunghi: preme "Leggi tutto" (resta dentro il gruppo) e rilegge
    $lunghi = @($s.Righe | Where-Object { $_.Espandi })
    if ($lunghi.Count -gt 0) {
      foreach ($r in $lunghi) { try { [void](Premi $r.Espandi.El) } catch {} }
      Start-Sleep -Milliseconds 600
      $s = Leggi-Chat (Foto-Albero $radice) $gruppo $oggi
      if (-not $s) { return $null }
    }
    $nuovi = Unisci $G $idx $s.Righe
    $rese = @($s.Righe | Where-Object { $_.Resa -and $_.Giorno })
    foreach ($r in $rese) { if (-not $piuVecchio -or $r.Giorno -lt $piuVecchio) { $piuVecchio = $r.Giorno } }
    if ($rese | Where-Object { $_.Giorno -lt $da.Date }) { $completo = $true; break }
    if ($s.Righe.Count -eq 0) { $completo = $true; break }
    if (WhatsApp-Davanti) { break }
    $sc = Scroll-Di $s.Righe[0].Nodo
    if (-not $sc) { $completo = $true; break }
    $p = $sc.Current.VerticalScrollPercent; $v = $sc.Current.VerticalViewSize
    if ($p -le 0.5) {
      # in cima: WhatsApp carica i messaggi piu' vecchi; se per tre volte non arriva niente, la storia e' finita
      if ($nuovi -eq 0) { $fermo++ } else { $fermo = 0 }
      if ($fermo -ge 3) { $completo = $true; break }
      try { $sc.SetScrollPercent(-1, 0) } catch {}
      Start-Sleep -Milliseconds 1500
    } else {
      $passo = [Math]::Max(3, $v * 0.7)
      try { $sc.SetScrollPercent(-1, [Math]::Max(0, $p - $passo)) } catch { break }
      Start-Sleep -Milliseconds 700
    }
  }
  In-Fondo $radice $gruppo $oggi
  # chi scrive: i messaggi di seguito della stessa persona non ripetono il nome
  $prec = $null; $ord = 0
  foreach ($m in $G) {
    if (-not $m.mittente) {
      if ($prec -and $prec.mittente -and $prec.direzione -eq 'in' -and $prec.data.Date -eq $m.data.Date) { $m.mittente = $prec.mittente } else { $m.mittente = '?' }
    }
    $m | Add-Member -NotePropertyName ord -NotePropertyValue ($ord++) -Force
    $prec = $m
  }
  return [pscustomobject]@{ Messaggi = @($G | Sort-Object data, ord); PrimoGiorno = $piuVecchio; Passi = $passi; Completo = $completo }
}

function Impronta([string]$gruppo, $m) {
  $sha = [Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($gruppo + '|' + $m.chiave))) -replace '-', '').ToLowerInvariant()
}

# --- porta del second brain ---
function Chiama-Porta([string]$metodo, $corpo) {
  $tok = [Environment]::GetEnvironmentVariable('GRUPPI_TOKEN', 'User')
  if (-not $tok) { throw 'Manca la variabile GRUPPI_TOKEN' }
  $par = @{ Uri = $PORTA; Method = $metodo; Headers = @{ 'x-gruppi-token' = $tok }; UseBasicParsing = $true; TimeoutSec = 60 }
  if ($corpo) { $par.Body = [Text.Encoding]::UTF8.GetBytes(($corpo | ConvertTo-Json -Depth 8 -Compress)); $par.ContentType = 'application/json; charset=utf-8' }
  $r = Invoke-WebRequest @par
  return ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json)
}

# ================= giro =================
$oggi = Get-Date
$script:finestra = [IntPtr]::Zero; $script:eraIcona = $false
function Rimetti-Finestra { if ($script:eraIcona -and $script:finestra -ne [IntPtr]::Zero) { try { [void][WaWin]::ShowWindow($script:finestra, 7) } catch {}; $script:eraIcona = $false } }
try {
  $radice = Apri-WhatsApp

  if ($Elenca) {
    # aiuto per la prima impostazione: nomi esatti delle chat il cui TITOLO contiene la parola cercata (solo i titoli)
    if (-not (Scrivi-Ricerca $radice $Elenca)) { throw 'casella di ricerca non trovata' }
    Start-Sleep -Seconds 3
    $foto = Foto-Albero $radice
    $max = Fine-Lista $foto
    $foto | Where-Object { $_.I -lt $max -and $_.Tipo -eq 'DataItem' -and $_.Nome } | ForEach-Object { Titolo-Cella $_.Nome } |
      Where-Object { $_ -and $_ -like ('*' + $Elenca + '*') } | Sort-Object -Unique | ForEach-Object { 'chat: [' + $_ + ']' }
    Chiudi-Ricerca $radice
    Rimetti-Finestra
    return
  }

  if ($Prova) {
    # senza -Gruppi: prova sul gruppo che e' gia' aperto in WhatsApp
    if (-not $Gruppi) { $aperta = Chat-Aperta (Foto-Albero $radice); if (-not $aperta) { throw 'nessun gruppo aperto: usa -Gruppi' }; $Gruppi = @($aperta) }
    $lista = @($Gruppi | ForEach-Object { [pscustomobject]@{ nome = $_; ultimo = $null } })
  } else {
    $lista = @((Chiama-Porta 'GET' $null).gruppi)
  }
  $esito = New-Object System.Collections.Generic.List[object]
  $pacco = New-Object System.Collections.Generic.List[object]
  foreach ($g in $lista) {
    if (WhatsApp-Davanti) { $esito.Add([pscustomobject]@{ gruppo = $g.nome; ok = $false; errore = 'WhatsApp in primo piano: lettura saltata' }); continue }
    # da dove leggere: dall'ultimo messaggio gia' salvato (al massimo 7 giorni indietro), la prima volta $Giorni giorni
    $da = $oggi.AddDays(-$Giorni).Date
    if ($g.ultimo) { $da = ([datetime]$g.ultimo).AddMinutes(-1); if ($da -lt $oggi.AddDays(-7)) { $da = $oggi.AddDays(-7) } }
    $letto = $null; $errore = $null
    try { $letto = Leggi-Gruppo $radice $g.nome $da $oggi } catch { $errore = $_.Exception.Message }
    if (-not $letto) {
      $esito.Add([pscustomobject]@{ gruppo = $g.nome; ok = $false; errore = $(if ($errore) { $errore } else { 'gruppo non trovato con questo nome esatto (o piu'' di uno)' }) })
      continue
    }
    $primaNL = $script:nonLettiPrima
    if (-not $letto.Completo) {
      $esito.Add([pscustomobject]@{ gruppo = $g.nome; ok = $false; errore = 'lettura incompleta (interrotta prima di arrivare all''ultimo messaggio salvato): niente salvato, si riprova al prossimo giro'; passi = $letto.Passi })
      continue
    }
    $righe = New-Object System.Collections.Generic.List[object]
    foreach ($m in $letto.Messaggi) {
      if ($m.data -lt $da) { continue }
      $righe.Add([pscustomobject]@{
        data = $m.data.ToString('yyyy-MM-ddTHH:mm:sszzz'); mittente = $m.mittente; direzione = $m.direzione; tipo = $m.tipo
        testo = $(if ($m.testo.Length -gt 4000) { $m.testo.Substring(0, 4000) } else { $m.testo })
        citazione = $(if ($m.citazione -and $m.citazione.Length -gt 200) { $m.citazione.Substring(0, 200) } else { $m.citazione })
        impronta = (Impronta $g.nome $m)
      })
    }
    $dopoNL = Non-Letti $radice $g.nome
    $e = [pscustomobject]@{ gruppo = $g.nome; ok = $true; errore = $null; messaggi = $righe.Count; dal = $(if ($letto.PrimoGiorno) { $letto.PrimoGiorno.ToString('yyyy-MM-dd') } else { $null }); passi = $letto.Passi; non_letti_prima = $primaNL; non_letti_dopo = $dopoNL }
    # i messaggi si salvano lo stesso, ma se la lettura li ha segnati come letti Giovanni lo deve sapere (guardiano)
    if ($dopoNL -ge 0 -and $dopoNL -lt $primaNL) { $e.ok = $false; $e.errore = 'messaggi segnati come letti durante la lettura (' + $primaNL + ' -> ' + $dopoNL + ')' }
    $esito.Add($e)
    $pacco.Add([pscustomobject]@{ nome = $g.nome; messaggi = $righe })
  }

  Rimetti-Finestra
  if ($Prova) {
    $esito | ForEach-Object { $_ | ConvertTo-Json -Compress }
    if ($Mostra) { foreach ($p in $pacco) { '== ' + $p.nome; $p.messaggi | ForEach-Object { $_.data.Substring(0, 16) + ' | ' + $_.mittente + ' | ' + $_.tipo + ' | ' + ($_.testo -replace '\s+', ' ') + $(if ($_.citazione) { '  (risposta a: ' + $_.citazione + ')' } else { '' }) } } }
    return
  }
  $r = Chiama-Porta 'POST' ([pscustomobject]@{ letto_il = $oggi.ToString('yyyy-MM-ddTHH:mm:sszzz'); gruppi = $pacco; esito = $esito })
  Scrivi-Registro ('ok ' + ($r | ConvertTo-Json -Compress))
} catch {
  $msg = $_.Exception.Message
  Rimetti-Finestra
  Scrivi-Registro ('ERRORE ' + $msg)
  if ($Prova -or $Elenca) { 'ERRORE: ' + $msg; return }
  try { [void](Chiama-Porta 'POST' ([pscustomobject]@{ letto_il = $oggi.ToString('yyyy-MM-ddTHH:mm:sszzz'); errore = $msg })) } catch { Scrivi-Registro ('ERRORE porta ' + $_.Exception.Message) }
  exit 1
}
