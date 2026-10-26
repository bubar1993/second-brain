# Trascrive le note vocali WhatsApp sul PC di Giovanni (Whisper sulla scheda video RTX 4070, gratis).
# Gira ogni 5 minuti con l'attività programmata di Windows "Second Brain - note vocali" (scripts/trascrivi-vocali.ps1 la crea).
# Parla solo con la funzione whatsapp-vocali (chiave nella variabile di Windows TRASCRIVI_TOKEN).
# Se non ci sono vocali esce subito, senza caricare il modello. Log in %USERPROFILE%\.secondbrain\trascrivi.log
# (non in AppData: lanciato da Claude finirebbe nella cartella "virtuale" dell'app Claude).
import json, os, sys, tempfile, time, urllib.error, urllib.parse, urllib.request, winreg
from pathlib import Path

CARTELLA = Path(os.environ['USERPROFILE']) / '.secondbrain'
LOG = CARTELLA / 'trascrivi.log'
BLOCCO = CARTELLA / 'trascrivi.lock'
URL = 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/whatsapp-vocali'
# large-v3, non turbo (26.10.2026): in italiano sbaglia molto meno nomi e parole, ~3 s per un vocale di un minuto.
MODELLO = 'large-v3'
# Se la funzione non manda i nomi del contatto (vedi wa_parole_vocale), almeno questi.
PAROLE_BASE = ('Nomi: Ceramex, G&C Home Concepts, Marazzi, Ragno, Flaviker, ABK, Garbelotto, Profilitec, '
               'Manno, Lugano, Ticino, Dafalgan, Algifor, Ponstan.')


def scrivi_log(riga):
    CARTELLA.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%d.%m.%Y %H:%M:%S ') + riga + '\n')
    if LOG.stat().st_size > 1_000_000:  # tieni il log piccolo
        LOG.write_text(LOG.read_text(encoding='utf-8')[-200_000:], encoding='utf-8')


def chiave():
    t = os.environ.get('TRASCRIVI_TOKEN')
    if not t:  # l'attività programmata può partire con un ambiente vecchio: leggi dal registro
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
            t = winreg.QueryValueEx(k, 'TRASCRIVI_TOKEN')[0]
    return t


def chiama(percorso='', corpo=None, binario=False):
    req = urllib.request.Request(URL + percorso, method='POST' if corpo is not None else 'GET',
                                 headers={'x-trascrivi-token': chiave(), 'Content-Type': 'application/json'},
                                 data=json.dumps(corpo).encode() if corpo is not None else None)
    with urllib.request.urlopen(req, timeout=120) as r:
        dati = r.read()
    return dati if binario else json.loads(dati)


def librerie_cuda():
    # cuBLAS e cuDNN arrivano dai pacchetti pip nvidia-*: Windows deve sapere dove sono le DLL.
    base = Path(sys.prefix) / 'Lib' / 'site-packages' / 'nvidia'
    for bin_dir in base.glob('*/bin'):
        os.add_dll_directory(str(bin_dir))
        os.environ['PATH'] = str(bin_dir) + os.pathsep + os.environ['PATH']


def main():
    # Un giro alla volta: se il precedente è ancora in corso (da meno di 30 minuti) esci.
    if BLOCCO.exists() and time.time() - BLOCCO.stat().st_mtime < 1800:
        return
    CARTELLA.mkdir(parents=True, exist_ok=True)
    BLOCCO.write_text(str(os.getpid()))
    try:
        vocali = chiama()
        if isinstance(vocali, dict):
            scrivi_log(f"errore elenco: {vocali.get('errore')}")
            return
        if not vocali:
            return
        librerie_cuda()
        from faster_whisper import WhisperModel
        modello = WhisperModel(MODELLO, device='cuda', compute_type='float16')
        for v in vocali:
            try:
                audio = chiama('?audio=' + urllib.parse.quote(v['id']), binario=True)
                with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as f:
                    f.write(audio)
                    percorso = f.name
                try:
                    # Lingua riconosciuta da Whisper (ogni tanto arrivano vocali in altre lingue).
                    pezzi, info = modello.transcribe(percorso, beam_size=5, vad_filter=True,
                                                     initial_prompt=v.get('parole') or PAROLE_BASE)
                    testo = ' '.join(p.text.strip() for p in pezzi).strip()
                finally:
                    os.unlink(percorso)
                if testo:
                    chiama(corpo={'id': v['id'], 'testo': testo})
                    scrivi_log(f"ok {v['id'][:24]} ({info.language}, {info.duration:.0f}s)")
                else:
                    chiama(corpo={'id': v['id'], 'errore': 'nessuna parola'})
                    scrivi_log(f"vuota {v['id'][:24]}")
            except urllib.error.HTTPError as e:
                motivo = e.read().decode(errors='ignore')[:200]
                scrivi_log(f"errore {v['id'][:24]}: {e.code} {motivo}")
                if e.code in (404, 502):  # file sparito da Meta: non riprovare all'infinito
                    chiama(corpo={'id': v['id'], 'errore': f'{e.code} {motivo}'})
            except Exception as e:  # noqa: BLE001
                scrivi_log(f"errore {v['id'][:24]}: {e}")
    except Exception as e:  # noqa: BLE001
        scrivi_log(f'errore: {e}')
    finally:
        BLOCCO.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
