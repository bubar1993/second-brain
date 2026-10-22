import { useEffect, useState } from 'react'
import { sb, areaDa, AREE, quando, numeroWhatsApp, giorniDaOggi } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, Icona, useModifiche, useDueTocchi } from './componenti'

// Rubrica (13.10.2026, ok di Giovanni): i contatti Google di giovannifabris@ceramex.ch, cioè quelli del telefono.
// Aggiungere, correggere ed eliminare qui cambia anche il telefono (funzione `rubrica`, Google li porta sul telefono
// in pochi minuti); quello che cambia sul telefono arriva qui entro 15 minuti.
// Chi è già una persona del brain è collegato alla sua scheda. Gli altri (quasi tutti privati) non hanno scheda
// né note: la scheda si apre a mano con "Apri una scheda", solo per chi serve (scelta di Giovanni).

const SENZA_ANNO = '1904'
const CAMPI = 'id,risorsa,nome,cognome,ditta,ruolo,telefoni,email,compleanno,appunti,area,persona_id,origine,eliminata_il,aggiornata_il'
export const nomeContatto = (c) => [c?.nome, c?.cognome].filter(Boolean).join(' ') || c?.ditta || 'Senza nome'

// Legge tutte le righe anche oltre il limite di 1000 per richiesta (prima del 22.10 i contatti dopo la "N" mancavano).
async function tutte(crea) {
  const righe = []
  for (let da = 0; ; da += 1000) {
    const pezzo = chk(await crea().range(da, da + 999))
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
  }
}

function dataCompleanno(iso) {
  if (!iso) return ''
  const [a, m, g] = iso.split('-')
  const d = new Date(2000, Number(m) - 1, Number(g)).toLocaleDateString('it-CH', { day: 'numeric', month: 'long' })
  return a === SENZA_ANNO ? d : `${d} ${a}`
}
// "3.5" o "03.05.1980" → "1904-05-03" / "1980-05-03"
function leggiCompleanno(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/)
  if (!m) return null
  const [, g, mese, a] = m
  if (Number(mese) < 1 || Number(mese) > 12 || Number(g) < 1 || Number(g) > 31) return null
  return `${a || SENZA_ANNO}-${mese.padStart(2, '0')}-${g.padStart(2, '0')}`
}
function scriviCompleanno(iso) {
  if (!iso) return ''
  const [a, m, g] = iso.split('-')
  return a === SENZA_ANNO ? `${g}.${m}` : `${g}.${m}.${a}`
}

// Biglietto da visita (vCard) per mandarlo con WhatsApp, mail, SMS…
export function vcard(c) {
  const e = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
  const righe = ['BEGIN:VCARD', 'VERSION:3.0', `N:${e(c.cognome)};${e(c.nome)};;;`, `FN:${e(nomeContatto(c))}`]
  if (c.ditta || c.ruolo) righe.push(`ORG:${e(c.ditta)}`)
  if (c.ruolo) righe.push(`TITLE:${e(c.ruolo)}`)
  for (const t of c.telefoni || []) righe.push(`TEL;TYPE=${/home|casa/i.test(t.tipo || '') ? 'HOME' : /work|lavoro|ufficio/i.test(t.tipo || '') ? 'WORK' : 'CELL'}:${t.valore}`)
  for (const m of c.email || []) righe.push(`EMAIL;TYPE=INTERNET:${m.valore}`)
  if (c.compleanno) righe.push(c.compleanno.startsWith(SENZA_ANNO) ? `BDAY:--${c.compleanno.slice(5).replace('-', '')}` : `BDAY:${c.compleanno}`)
  righe.push('END:VCARD')
  return righe.join('\r\n')
}
export async function condividi(c, avvisa) {
  const nome = nomeContatto(c)
  const file = new File([vcard(c)], `${nome.replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'contatto'}.vcf`, { type: 'text/vcard' })
  try {
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: nome })
    const testo = [nome, c.ditta, ...(c.telefoni || []).map((t) => t.valore), ...(c.email || []).map((m) => m.valore)].filter(Boolean).join('\n')
    if (navigator.share) return await navigator.share({ title: nome, text: testo })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  } catch (e) {
    if (e?.name !== 'AbortError') avvisa(messaggioErrore(e))
  }
}

export function Rubrica({ parti }) {
  if (parti[0] === 'nuovo') return <Modifica key="nuovo" />
  if (parti[0]) return <Contatto key={parti[0]} id={parti[0]} />
  return <Elenco />
}

function Elenco() {
  const { area, avvisa } = useApp()
  const [cerca, setCerca] = useState('')
  const [eliminati, setEliminati] = useState(false)
  const [lavora, setLavora] = useState(false)
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [c, s] = await Promise.all([
      tutte(() => sb.from('rubrica').select(CAMPI).order('nome').order('cognome').order('id')),
      sb.from('rubrica_stato').select('ultimo_giro,esito').maybeSingle(),
    ])
    return { contatti: c, stato: chk(s) }
  }, [])

  async function aggiorna() {
    setLavora(true)
    try {
      const r = await chiama('rubrica', { azione: 'sincronizza' })
      avvisa(r.lette ? `Aggiornata: ${r.lette} contatti cambiati sul telefono` : 'Aggiornata: nessuna novità')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
    setLavora(false)
  }

  const parole = cerca.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const tutti = dati?.contatti || []
  const vivi = tutti.filter((c) => !c.eliminata_il && (area === 'T' || c.area === area))
  const visibili = vivi.filter((c) => {
    if (!parole.length) return true
    const testo = [c.nome, c.cognome, c.ditta, c.ruolo, ...c.telefoni.map((t) => t.valore), ...c.email.map((m) => m.valore)].join(' ').toLowerCase()
    const cifre = testo.replace(/[\s'/.-]/g, '')
    return parole.every((p) => testo.includes(p) || (/^\+?\d[\d\s]*$/.test(p) && cifre.includes(p.replace(/\s/g, ''))))
  })
  const via = tutti.filter((c) => c.eliminata_il && giorniDaOggi(c.eliminata_il) > -30)

  return (
    <div className="schermata">
      <div className="testata-con-tasto">
        <Indietro titolo="Rubrica" />
        <a className="tasto-piccolo" href="#/rubrica/nuovo">+ Nuovo</a>
      </div>
      <input type="search" className="cerca-persone" value={cerca} onChange={(e) => setCerca(e.target.value)}
        placeholder="Cerca nome, ditta, numero o mail" />
      <p className="nota-piccola">
        I contatti del telefono (account giovannifabris@ceramex.ch). Quello che cambi qui cambia anche sul telefono.
        {dati?.stato?.ultimo_giro ? ` Ultima lettura ${quando(dati.stato.ultimo_giro, true)}.` : ' Non ancora collegata a Google.'}
        {' '}<button type="button" className="tasto-link" onClick={aggiorna} disabled={lavora}>{lavora ? 'Leggo…' : 'Aggiorna adesso'}</button>
      </p>
      <Stato carica={carica} errore={errore} vuoto={dati && !vivi.length ? 'Ancora nessun contatto: la rubrica si riempie dopo il collegamento a Google.' : null}>
        {dati && (
          <div className="elenco">
            {visibili.slice(0, 300).map((c) => (
              <a key={c.id} className="riga" href={`#/rubrica/${c.id}`}>
                <span className="pallino" style={{ background: areaDa(c.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{nomeContatto(c)}</span>
                  <span className="riga-meta">
                    {[c.ditta && c.ditta !== nomeContatto(c) ? c.ditta : null, c.telefoni[0]?.valore || c.email[0]?.valore, c.persona_id ? 'scheda' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </a>
            ))}
            {visibili.length > 300 && <p className="msg">Altri {visibili.length - 300}: scrivi un nome per trovarli.</p>}
            {parole.length > 0 && !visibili.length && <p className="msg">Nessun contatto con «{cerca.trim()}».</p>}
          </div>
        )}
      </Stato>
      {via.length > 0 && (
        <>
          <button type="button" className="tasto-link apri-dati" onClick={() => setEliminati(!eliminati)} aria-expanded={eliminati}>
            <Icona nome={eliminati ? 'x' : 'freccia'} size={16} /> Eliminati di recente ({via.length})
          </button>
          {eliminati && (
            <div className="elenco">
              {via.map((c) => <Eliminato key={c.id} c={c} dopo={ricarica} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Eliminato({ c, dopo }) {
  const { avvisa } = useApp()
  const [lavora, setLavora] = useState(false)
  async function ripristina() {
    setLavora(true)
    try {
      await chiama('rubrica', { azione: 'ripristina', id: c.id })
      avvisa('Ripristinato, anche sul telefono')
      dopo()
    } catch (e) {
      avvisa(messaggioErrore(e))
      setLavora(false)
    }
  }
  return (
    <div className="riga">
      <span className="pallino" style={{ background: 'var(--grigio)' }} />
      <span className="riga-corpo">
        <span className="riga-testo">{nomeContatto(c.copia || c)}</span>
        <span className="riga-meta">Eliminato {quando(c.eliminata_il)}</span>
      </span>
      <button type="button" className="tasto-piccolo" onClick={ripristina} disabled={lavora}>{lavora ? '…' : 'Ripristina'}</button>
    </div>
  )
}

function Contatto({ id }) {
  const { avvisa, vai } = useApp()
  const [modifica, setModifica] = useState(false)
  // Due tocchi (useDueTocchi): il secondo dopo mezzo secondo, dopo 5 secondi torna com'era.
  const due = useDueTocchi()
  const sicuro = due.armato === 'elimina'
  const [lavora, setLavora] = useState(false)
  const { dati: c, errore, carica, ricarica } = useCarica(async () => chk(await sb.from('rubrica').select(CAMPI + ',copia').eq('id', id).single()), [id])

  if (!c) return <div className="schermata"><Indietro titolo="Contatto" /><Stato carica={carica} errore={errore} /></div>
  if (modifica) return <Modifica c={c} fatto={() => { setModifica(false); ricarica() }} />

  const elimina = () => due.tocca('elimina', eliminaDavvero)
  async function eliminaDavvero() {
    setLavora(true)
    try {
      await chiama('rubrica', { azione: 'elimina', id })
      avvisa('Eliminato, anche dal telefono', { etichetta: 'Annulla', fai: async () => {
        try { await chiama('rubrica', { azione: 'ripristina', id }); avvisa('Ripristinato') } catch (e) { avvisa(messaggioErrore(e)) }
      } })
      history.back()
    } catch (e) {
      avvisa(messaggioErrore(e))
      setLavora(false)
    }
  }

  // La scheda si apre solo quando serve: nell'area del contatto, con numero, mail e compleanno.
  async function apriScheda() {
    setLavora(true)
    try {
      const p = chk(await sb.from('persone').insert({
        nome: c.nome || c.cognome || c.ditta || 'Senza nome',
        cognome: c.nome ? (c.cognome || '').replace(/\s*\([^)]*\)\s*$/, '') || null : null,
        telefono: c.telefoni[0]?.valore || null, email: c.email[0]?.valore?.toLowerCase() || null,
        compleanno: c.compleanno, fonte: 'rubrica', chiave: c.risorsa ? `rubrica:${c.risorsa}` : null,
      }).select('id').single())
      chk(await sb.from('persone_aree').insert({ persona_id: p.id, area: c.area || 'P' }))
      chk(await sb.from('rubrica').update({ persona_id: p.id }).eq('id', id))
      vai(`/persona/${p.id}`)
    } catch (e) {
      avvisa(messaggioErrore(e))
      setLavora(false)
    }
  }

  if (c.eliminata_il) {
    return (
      <div className="schermata">
        <Indietro titolo={nomeContatto(c.copia || c)} />
        <p className="msg">Eliminato {quando(c.eliminata_il)}. Lo ritrovi in Rubrica → "Eliminati di recente" per ripristinarlo.</p>
      </div>
    )
  }

  return (
    <div className="schermata scheda-persona">
      <Indietro titolo={nomeContatto(c)} />
      {(c.ditta || c.ruolo) && <p className="persona-chi"><span>{[c.ditta, c.ruolo].filter(Boolean).join(' · ')}</span></p>}
      <p className="nota-piccola">
        <span className="pallino" style={{ background: areaDa(c.area)?.colore || 'var(--grigio)' }} /> {areaDa(c.area)?.nome || 'Senza area'}
        {c.persona_id ? <> · <a href={`#/persona/${c.persona_id}`}>Apri la scheda</a></> : null}
      </p>

      <div className="elenco">
        {c.telefoni.map((t, i) => {
          const wa = numeroWhatsApp(t.valore)
          return (
            <div key={'t' + i} className="riga">
              <span className="riga-corpo">
                <span className="riga-testo selezionabile">{t.valore}</span>
                {t.tipo && <span className="riga-meta">{t.tipo}</span>}
              </span>
              <a className="tasto-piccolo" href={`tel:${t.valore}`}>Chiama</a>
              {wa && <a className="tasto-piccolo" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            </div>
          )
        })}
        {c.email.map((m, i) => (
          <div key={'m' + i} className="riga">
            <span className="riga-corpo">
              <span className="riga-testo selezionabile">{m.valore}</span>
              {m.tipo && <span className="riga-meta">{m.tipo}</span>}
            </span>
            <a className="tasto-piccolo" href={`mailto:${m.valore}`}>Mail</a>
          </div>
        ))}
      </div>
      {c.compleanno && <p className="nota-piccola">Compleanno: {dataCompleanno(c.compleanno)}</p>}
      {c.appunti && <p className="testo-mail">{c.appunti}</p>}

      <div className="contatti-persona">
        <button type="button" className="tasto-piccolo" onClick={() => setModifica(true)}>Modifica</button>
        <button type="button" className="tasto-piccolo" onClick={() => condividi(c, avvisa)}>Condividi</button>
        {!c.persona_id && <button type="button" className="tasto-piccolo" onClick={apriScheda} disabled={lavora}>Apri una scheda</button>}
      </div>
      {!c.persona_id && <p className="nota-piccola">Senza scheda: niente note né riassunti. Aprila solo per chi ti serve.</p>}

      <button type="button" className={'tasto-link' + (sicuro ? ' pericolo-pieno' : ' pericolo')} onClick={elimina} disabled={lavora}>
        {lavora && sicuro ? 'Elimino…' : sicuro ? 'Tocca ancora: si elimina anche dal telefono' : 'Elimina contatto'}
      </button>
    </div>
  )
}

const vuoto = { nome: '', cognome: '', ditta: '', ruolo: '', telefoni: [{ valore: '', tipo: 'cellulare' }], email: [], compleanno: '', appunti: '' }

function Modifica({ c, fatto }) {
  const { area, avvisa, vai } = useApp()
  const [m, setM] = useState(null)
  const [areaNuovo, setAreaNuovo] = useState(area === 'T' ? 'P' : area)
  const [lavora, setLavora] = useState(false)
  const [cambiato, setCambiato] = useState(false)
  useModifiche(cambiato)

  useEffect(() => {
    if (m) return
    setM(c ? {
      nome: c.nome || '', cognome: c.cognome || '', ditta: c.ditta || '', ruolo: c.ruolo || '',
      telefoni: c.telefoni.length ? c.telefoni : [{ valore: '', tipo: 'cellulare' }], email: c.email,
      compleanno: scriviCompleanno(c.compleanno), appunti: c.appunti || '',
    } : vuoto)
  }, [c, m])
  if (!m) return null

  const metti = (k, v) => { setM({ ...m, [k]: v }); setCambiato(true) }
  const campo = (k) => ({ value: m[k], onChange: (e) => metti(k, e.target.value) })
  const lista = (k, i, v) => metti(k, m[k].map((x, j) => (j === i ? { ...x, valore: v } : x)))

  async function salva() {
    const compleanno = m.compleanno.trim() ? leggiCompleanno(m.compleanno) : null
    if (m.compleanno.trim() && !compleanno) return avvisa('Compleanno: scrivi giorno.mese (anno se lo sai), es. 3.5.1980')
    if (!m.nome.trim() && !m.cognome.trim() && !m.ditta.trim()) return avvisa('Serve almeno un nome')
    setLavora(true)
    try {
      const r = await chiama('rubrica', { azione: 'salva', id: c?.id, area: areaNuovo, campi: { ...m, compleanno } })
      setCambiato(false)
      avvisa(c ? 'Salvato, anche sul telefono' : 'Aggiunto, anche sul telefono')
      if (c) fatto()
      else vai(`/rubrica/${r.id}`)
    } catch (e) {
      avvisa(messaggioErrore(e))
      setLavora(false)
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo={c ? 'Modifica contatto' : 'Nuovo contatto'} />
      {!c && (
        <div className="scelta-area" role="group" aria-label="Area">
          {AREE.map((a) => (
            <button key={a.codice} type="button" style={{ '--c': a.colore }} aria-pressed={areaNuovo === a.codice}
              className={'chip chip-area' + (areaNuovo === a.codice ? ' attivo' : '')} onClick={() => setAreaNuovo(a.codice)}>{a.nome}</button>
          ))}
        </div>
      )}
      <div className="modulo">
        <div className="due">
          <label>Nome<input {...campo('nome')} autoComplete="off" /></label>
          <label>Cognome<input {...campo('cognome')} autoComplete="off" /></label>
        </div>
        <div className="due">
          <label>Ditta<input {...campo('ditta')} /></label>
          <label>Ruolo<input {...campo('ruolo')} /></label>
        </div>
        {m.telefoni.map((t, i) => (
          <label key={'t' + i}>Telefono{t.tipo ? ` (${t.tipo})` : ''}
            <input type="tel" inputMode="tel" value={t.valore} onChange={(e) => lista('telefoni', i, e.target.value)} placeholder="+41 79 …" />
          </label>
        ))}
        <button type="button" className="tasto-link" onClick={() => metti('telefoni', [...m.telefoni, { valore: '', tipo: 'cellulare' }])}>+ numero</button>
        {m.email.map((x, i) => (
          <label key={'m' + i}>Mail{x.tipo ? ` (${x.tipo})` : ''}
            <input type="email" inputMode="email" value={x.valore} onChange={(e) => lista('email', i, e.target.value)} />
          </label>
        ))}
        <button type="button" className="tasto-link" onClick={() => metti('email', [...m.email, { valore: '', tipo: 'lavoro' }])}>+ mail</button>
        <label>Compleanno<input {...campo('compleanno')} inputMode="decimal" placeholder="es. 3.5 oppure 3.5.1980" /></label>
        <label>Appunti<textarea rows={3} {...campo('appunti')} /></label>
        <p className="nota-piccola">Per togliere un numero o una mail svuota il campo.</p>
        <button type="button" className="tasto-grande" onClick={salva} disabled={lavora}>{lavora ? 'Salvo…' : 'Salva'}</button>
      </div>
    </div>
  )
}
