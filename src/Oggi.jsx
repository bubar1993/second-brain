import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb, areaDa, quando, giorniDaOggi, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Icona, useModifiche, perCampo, useScorriAree, chiama } from './componenti'
import Rete from './Rete'
import { AttivaNotifiche } from './Notifiche'
import { visiteAperte, valoriEvento, CAMPI_EVENTO, ModificaAppuntamento, linkCall } from './Visita'
import { RispostaAI, useAttesaAI } from './RispostaAI'

const corto = (s, n = 16) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const numero = (n) => (n == null ? '…' : n.toLocaleString('de-CH'))

// Giorni da oggi al prossimo compleanno (0 = oggi).
function giorniAlCompleanno(iso) {
  const [, m, g] = iso.split('-').map(Number)
  const oggi = new Date()
  oggi.setHours(0, 0, 0, 0)
  let d = new Date(oggi.getFullYear(), m - 1, g)
  if (d < oggi) d = new Date(oggi.getFullYear() + 1, m - 1, g)
  return Math.round((d - oggi) / 86400000)
}

export default function Oggi({ inbox, bozze, domande, risposte, riordino, seguire, conferme }) {
  const { area, avvisa, vai } = useApp()
  const scorri = useScorriAree()
  const rete = useRef(null)
  const [fatti, setFatti] = useState(() => new Set())
  const [lampo, setLampo] = useState(null)
  const [avanti, setAvanti] = useState(false)
  const [aperto, setAperto] = useState(null) // promemoria aperto per modificarlo

  // Senza rete (garage, cantiere): l'ultima agenda caricata, solo da guardare, con l'ora in cui era aggiornata.
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const copia = `oggi-copia:${area}`
    try {
      const d = await leggiOggi()
      scrivi(copia, JSON.stringify({ ora: Date.now(), d }))
      return d
    } catch (e) {
      let c = null
      try { c = JSON.parse(leggi(copia) || 'null') } catch { /* copia rovinata */ }
      if (c?.d) return { ...c.d, senzaRete: c.ora }
      throw e
    }
  }, [area])

  // Quando torna la rete, si rilegge subito.
  useEffect(() => {
    window.addEventListener('online', ricarica)
    return () => window.removeEventListener('online', ricarica)
  }, [ricarica])

  async function leggiOggi() {
    let qp = sb.from('promemoria').select('id,testo,area,scade_il,urgente,nota_id,ricorrenza')
      .is('fatto_il', null).is('eliminata_il', null)
      .order('scade_il', { ascending: true, nullsFirst: false }).limit(50)
    // Le note dei clienti stanno nelle schede delle aziende: qui solo quelle scritte da Giovanni.
    let qn = sb.from('note').select('id,area,testo,fonte,creata_il,note_persone(persone(id,nome,cognome)),allegati(id)')
      .is('eliminata_il', null).not('area', 'is', null).is('azienda_id', null)
      .order('creata_il', { ascending: false }).limit(5)
    if (area !== 'T') {
      qp = qp.or(`area.eq.${area},area.is.null`)
      qn = qn.eq('area', area)
    }
    // Clienti che hanno scritto per ultimi (dalle note dell'agente).
    let qa = sb.from('note').select('data,aziende(id,nome,area)').not('azienda_id', 'is', null)
      .is('eliminata_il', null).is('scartata_il', null)
      .order('data', { ascending: false }).order('creata_il', { ascending: false }).limit(60)
    if (area === 'P') qa = Promise.resolve({ data: [] })
    else if (area !== 'T') qa = qa.eq('area', area)
    const qc = sb.from('persone').select('id,nome,cognome,compleanno,persone_aree(area)')
      .not('compleanno', 'is', null).is('eliminata_il', null)
    // Appuntamenti: da ora a 7 giorni, più le proposte degli agenti da approvare.
    const da = new Date(); da.setHours(0, 0, 0, 0)
    const a7 = new Date(da.getTime() + 8 * 86400000)
    let qe = sb.from('eventi').select(CAMPI_EVENTO)
      .in('stato', ['confermato', 'da_creare']).is('fatto_il', null).gte('inizio', da.toISOString()).lt('inizio', a7.toISOString())
      .order('inizio').limit(60)
    if (area !== 'T') qe = qe.or(`area.eq.${area},area.is.null`)
    // Le proposte degli agenti anche più in là di una settimana (14.10.2026): prima una data tra 3 settimane compariva solo all'ultimo.
    let qprop = sb.from('eventi').select(CAMPI_EVENTO).eq('stato', 'proposto').gte('inizio', da.toISOString()).order('inizio').limit(30)
    if (area !== 'T') qprop = qprop.or(`area.eq.${area},area.is.null`)
    // Appuntamenti dei 7 giorni scorsi non ancora spuntati: restano finché non li chiudi (o annoti).
    let qv = sb.from('eventi').select(CAMPI_EVENTO)
      .in('stato', ['confermato', 'da_creare']).is('fatto_il', null)
      .gte('inizio', new Date(da.getTime() - 7 * 86400000).toISOString()).lt('inizio', da.toISOString())
      .order('inizio', { ascending: false }).limit(40)
    if (area !== 'T') qv = qv.or(`area.eq.${area},area.is.null`)
    const oggiIso = `${da.getFullYear()}-${String(da.getMonth() + 1).padStart(2, '0')}-${String(da.getDate()).padStart(2, '0')}`
    let qr = sb.from('riassunti_giorno').select('parte,momento,testo,creata_il').eq('giorno', oggiIso)
    if (area === 'P') qr = qr.eq('parte', 'privato')
    else if (area !== 'T') qr = qr.eq('parte', 'lavoro')
    // Compleanni anche dai contatti del telefono senza scheda (Rubrica, quasi tutti privati).
    const qrub = sb.from('rubrica').select('id,nome,cognome,compleanno,area')
      .not('compleanno', 'is', null).is('eliminata_il', null).is('persona_id', null)
    const [promemoria, note, recenti, nati0, ev0, ria, vecchi, rub, prop] = await Promise.all([qp, qn, qa, qc, qe, qr, qv, qrub, qprop])
    const ev = { data: [...chk(ev0), ...chk(prop)] }
    const nati = { data: [...chk(nati0), ...chk(rub).map((c) => ({ ...c, persone_aree: [{ area: c.area || 'P' }], link: `#/rubrica/${c.id}` }))] }
    const aziende = []
    for (const r of chk(recenti)) {
      if (r.aziende && !aziende.some((a) => a.id === r.aziende.id)) aziende.push(r.aziende)
      if (aziende.length === 6) break
    }
    // Compleanni nei prossimi 14 giorni (l'anno non conta).
    const compleanni = chk(nati).map((p) => ({ ...p, tra: giorniAlCompleanno(p.compleanno) }))
      .filter((p) => p.tra <= 14 && (area === 'T' || p.persone_aree.some((x) => x.area === area)))
      .sort((a, b) => a.tra - b.tra)
    // Il riassunto più recente di ogni parte (la sera sostituisce il mattino).
    const riassunti = ['lavoro', 'privato'].map((parte) => chk(ria).filter((r) => r.parte === parte)
      .sort((a, b) => (a.momento === 'sera' ? -1 : 1) - (b.momento === 'sera' ? -1 : 1))[0]).filter(Boolean)
    return { promemoria: chk(promemoria), note: chk(note), aziende, compleanni, eventi: chk(ev), passati: chk(vecchi), riassunti }
  }

  // Quanto è grande la memoria: si legge una volta.
  const [totali, setTotali] = useState({ note: null, aziende: null })
  useEffect(() => {
    Promise.all([
      sb.from('note').select('id', { count: 'exact', head: true }).is('eliminata_il', null),
      sb.from('aziende').select('id', { count: 'exact', head: true }).is('eliminata_il', null).is('unito_in', null),
    ]).then(([n, a]) => setTotali({ note: n.count, aziende: a.count }))
  }, [])

  const togliFatto = (id) => setFatti((s) => { const x = new Set(s); x.delete(id); return x })

  async function fatto(p) {
    if (fatti.has(p.id)) return
    setFatti((s) => new Set(s).add(p.id))
    setAperto(null)
    rete.current?.assorbi(p.id)
    try {
      chk(await sb.from('promemoria').update({ fatto_il: new Date().toISOString() }).eq('id', p.id))
      // Le scadenze di ogni anno (cassa malati, gomme…) tornano l'anno dopo, quelle trimestrali (provvigioni) 3 mesi dopo.
      let nuovo = null
      if ((p.ricorrenza === 'annuale' || p.ricorrenza === 'trimestrale') && p.scade_il) {
        const prossimo = new Date(p.scade_il)
        if (p.ricorrenza === 'annuale') prossimo.setFullYear(prossimo.getFullYear() + 1)
        else prossimo.setMonth(prossimo.getMonth() + 3)
        nuovo = chk(await sb.from('promemoria').insert({ testo: p.testo, area: p.area, scade_il: prossimo.toISOString(), ricorrenza: p.ricorrenza, urgente: p.urgente })
          .select('id').single())
      }
      const torna = p.ricorrenza === 'trimestrale' ? 'Fatto: torna tra 3 mesi' : 'Fatto: torna l\'anno prossimo'
      avvisa(nuovo ? torna : 'Fatto', { etichetta: 'Annulla', fai: () => annullaFatto(p, nuovo) })
      setTimeout(ricarica, 450)
    } catch (e) {
      togliFatto(p.id)
      avvisa(messaggioErrore(e))
    }
  }

  async function annullaFatto(p, nuovo) {
    try {
      chk(await sb.from('promemoria').update({ fatto_il: null }).eq('id', p.id))
      // Il promemoria dell'anno dopo, appena creato, non serve più.
      if (nuovo) chk(await sb.from('promemoria').delete().eq('id', nuovo.id))
      togliFatto(p.id)
      avvisa('Rimesso tra le cose da fare')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Correggi, sposta o elimina un promemoria. Con "Annulla" torna com'era.
  async function cambia(p, campi, messaggio) {
    const prima = Object.fromEntries(Object.keys(campi).map((k) => [k, p[k] ?? null]))
    try {
      chk(await sb.from('promemoria').update(campi).eq('id', p.id))
      setAperto(null)
      avvisa(messaggio, {
        etichetta: 'Annulla',
        fai: async () => {
          try {
            chk(await sb.from('promemoria').update(prima).eq('id', p.id))
            avvisa('Come prima')
            ricarica()
          } catch (e) { avvisa(messaggioErrore(e)) }
        },
      })
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const ev = useAzioniEventi(ricarica, () => setAperto(null))

  const promemoria = (dati?.promemoria || []).filter((p) => !fatti.has(p.id))

  // Appuntamenti con gli spostamenti fatti dall'app già applicati: uno spostato a domani sta già sotto domani.
  // I giorni di scuola chiusa (vacanze dei gemelli) non sono appuntamenti: si vedono accanto al giorno.
  const eventi = dati ? [...dati.eventi, ...dati.passati].map(valoriEvento) : []
  const vacanze = eventi.filter(vacanza)
  const veri = eventi.filter((e) => !vacanza(e))
  const proposte = veri.filter((e) => e.stato === 'proposto' && giorniDaOggi(e.inizio) >= 0)
  const vecchi = veri.filter((e) => e.stato !== 'proposto' && giorniDaOggi(e.inizio) < 0)
    .sort((a, b) => b.inizio.localeCompare(a.inizio))

  // Una lista sola per giorno: appuntamenti e promemoria insieme, per orario (13.10.2026, scelta di Giovanni).
  const giorni = new Map()
  const ritardo = []
  const senzaData = []
  const piuAvanti = []
  const metti = (g, voce) => { if (!giorni.has(g)) giorni.set(g, []); giorni.get(g).push(voce) }
  for (const p of dati?.promemoria || []) {
    if (!p.scade_il) senzaData.push({ tipo: 'p', x: p })
    // In ritardo solo dal giorno dopo: le cose di oggi restano in "Oggi" anche passata l'ora.
    else if (giorniDaOggi(p.scade_il) < 0) ritardo.push({ tipo: 'p', x: p, ora: p.scade_il })
    else if (giorniDaOggi(p.scade_il) <= 14) metti(giorniDaOggi(p.scade_il), { tipo: 'p', x: p, ora: p.scade_il })
    else piuAvanti.push({ tipo: 'p', x: p })
  }
  for (const e of veri) {
    const g = giorniDaOggi(e.inizio)
    if (e.stato !== 'proposto' && g >= 0 && g <= 7) metti(g, { tipo: 'e', x: e, ora: e.tutto_il_giorno ? '' : e.inizio })
  }
  if (dati && !giorni.has(0)) giorni.set(0, [])
  for (const voci of giorni.values()) voci.sort((a, b) => a.ora.localeCompare(b.ora))
  const elencoGiorni = [...giorni.entries()].sort((a, b) => a[0] - b[0])
  const vacanzaDel = (g) => vacanze.find((e) => giorniDaOggi(e.inizio) === g)?.titolo.replace(/^Scuola chiusa:\s*/i, '')

  // Il prossimo appuntamento di oggi, o quello in corso (finisce dopo adesso; senza fine: un'ora).
  const adesso = Date.now()
  const prossimo = veri.filter((e) => e.stato !== 'proposto' && !e.tutto_il_giorno && !ev.fatti.has(e.id) && giorniDaOggi(e.inizio) === 0
    && new Date(e.fine || new Date(e.inizio).getTime() + 3600e3).getTime() > adesso)
    .sort((a, b) => a.inizio.localeCompare(b.inizio))[0]

  const nessunaCosa = dati && !dati.promemoria.length && !veri.some((e) => e.stato !== 'proposto' && giorniDaOggi(e.inizio) >= 0)
  const daFareOggi = promemoria.filter((p) => p.scade_il && giorniDaOggi(p.scade_il) <= 0).length
    + (giorni.get(0) || []).filter((v) => v.tipo === 'e' && !ev.fatti.has(v.x.id)).length

  const voce = (v, inRitardo) => (v.tipo === 'p'
    ? <RigaPromemoria key={v.x.id} p={v.x} finito={fatti.has(v.x.id)} aperta={aperto === v.x.id} lampo={lampo}
      fatto={fatto} apri={() => setAperto(aperto === v.x.id ? null : v.x.id)} cambia={cambia}
      chiudi={() => setAperto(null)} ritardo={inRitardo} />
    : <RiquadroEvento key={v.x.id} e={v.x} chiuso={ev.fatti.has(v.x.id)} apri={aperto === v.x.id}
      tocca={() => setAperto(aperto === v.x.id ? null : v.x.id)} fatto={ev.fatto} ricarica={ricarica}
      chiudi={() => setAperto(null)} />)

  // Neuroni: prima i promemoria aperti, poi le tue ultime note, poi i clienti che hanno scritto per ultimi.
  const chiaveNodi = dati ? [...promemoria, ...dati.note, ...dati.aziende].map((x) => x.id).join() : ''
  const nodi = useMemo(() => {
    if (!dati) return []
    const pr = promemoria.slice(0, 8).map((p) => ({ id: p.id, area: p.area, etichetta: corto(p.testo), tipo: 'promemoria' }))
    const no = dati.note.slice(0, Math.max(0, 4 - pr.length))
      .map((n) => ({ id: n.id, area: n.area, etichetta: corto(n.testo || 'Foto', 14), tipo: 'nota' }))
    const az = dati.aziende.slice(0, Math.max(0, 7 - pr.length - no.length))
      .map((a) => ({ id: a.id, area: a.area, etichetta: corto(a.nome, 16), tipo: 'azienda' }))
    return [...pr, ...no, ...az]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveNodi])

  const tocca = useCallback((n) => {
    if (n.tipo === 'nota') return vai(`/nota/${n.id}`)
    if (n.tipo === 'azienda') return vai(`/azienda/${n.id}`)
    setLampo({ id: n.id, k: Date.now() })
    setAperto(n.id)
  }, [vai])

  const oggi = new Date()
  const giorno = oggi.toLocaleDateString('it-CH', { weekday: 'long' })

  return (
    <div className="schermata oggi">
      <section className="rete" aria-label="La rete di oggi: trascina per ruotarla, tocca un nodo">
        <Rete ref={rete} nodi={nodi} onTocca={tocca} />
        <div className="nucleo">
          <span className="giorno">{giorno.charAt(0).toUpperCase() + giorno.slice(1)}</span>
          <span className="data">{oggi.toLocaleDateString('it-CH', { day: 'numeric', month: 'long' })}</span>
        </div>
        <p className="piede">La tua memoria: <b>{numero(totali.note)}</b> note, <b>{numero(totali.aziende)}</b> aziende</p>
      </section>

      {/* Sul PC questa colonna sta a destra della rete. Scorrendo col dito qui (non sulla rete) si cambia area. */}
      <div className="oggi-colonna" {...scorri}>
        <h1 className="titolo-oggi">
          {!dati ? 'Oggi' : daFareOggi === 0 ? 'Niente di urgente oggi' : daFareOggi === 1 ? '1 cosa da fare oggi' : `${daFareOggi} cose da fare oggi`}
        </h1>

        {dati?.senzaRete && (
          <div className="scheda scheda-allarme" role="status">
            <span>Senza rete: vedi l'agenda delle {new Date(dati.senzaRete).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })}{giorniDaOggi(new Date(dati.senzaRete).toISOString()) < 0 ? ` del ${new Date(dati.senzaRete).toLocaleDateString('it-CH')}` : ''}. Si aggiorna da sola quando torna la rete.</span>
          </div>
        )}

        <Adesso e={prossimo} />
        <ProssimaSveglia />

        {dati?.riassunti.map((r) => (
          <section key={r.parte} className="riassunto-giorno">
            <h3>{r.momento === 'mattino' ? 'Il punto del mattino' : 'Il punto della sera'}{dati.riassunti.length > 1 ? ` · ${r.parte === 'lavoro' ? 'lavoro' : 'privato'}` : ''}</h3>
            <p>{r.testo}</p>
          </section>
        ))}

        <Stato carica={carica} errore={errore} vuoto={nessunaCosa && !vacanzaDel(0) ? 'Niente in agenda. Quando aggiungi "Ricordamelo" o un appuntamento, compare qui.' : null}>
          {dati && !nessunaCosa && (
            <div className="agenda">
              {ritardo.length > 0 && (
                <>
                  <h3 className="agenda-giorno rosso">In ritardo</h3>
                  {ritardo.map((v) => voce(v, true))}
                </>
              )}
              {elencoGiorni.map(([g, voci]) => (
                <Fragment key={g}>
                  <h3 className="agenda-giorno">
                    {nomeGiorno(g)}
                    {vacanzaDel(g) && <span className="vacanza">Scuola chiusa: {vacanzaDel(g)}</span>}
                  </h3>
                  {voci.length ? voci.map((v) => voce(v)) : <p className="nota-piccola">Niente per oggi.</p>}
                </Fragment>
              ))}
              {senzaData.length > 0 && (
                <>
                  <h3 className="agenda-giorno">Senza data</h3>
                  {senzaData.map((v) => voce(v))}
                </>
              )}
              {piuAvanti.length > 0 && (
                <>
                  <button type="button" className="tasto-link" onClick={() => setAvanti(!avanti)} aria-expanded={avanti}>
                    {avanti ? 'Nascondi i promemoria più avanti' : `Promemoria più avanti: ${piuAvanti.length}`}
                  </button>
                  {avanti && piuAvanti.map((v) => voce(v))}
                </>
              )}
              <p className="nota-piccola">Tocca una riga per correggerla, spostarla o aprire la scheda.</p>
            </div>
          )}
          {dati && nessunaCosa && vacanzaDel(0) && (
            <h3 className="agenda-giorno"><span className="vacanza">Scuola chiusa: {vacanzaDel(0)}</span></h3>
          )}
        </Stato>

        {dati && <Proposte proposte={proposte} aperto={aperto} setAperto={setAperto} decidi={ev.decidi} ricarica={ricarica} />}
        {dati && <DaChiudere vecchi={vecchi} ev={ev} aperto={aperto} setAperto={setAperto} ricarica={ricarica} />}

        {visiteAperte().map((v) => (
          <a key={v.id} className="scheda scheda-allarme" href={`#/visita/${v.id}`}>
            <span>Appunti non finiti{v.titolo ? `: ${v.titolo}` : ''}. Tocca per riprendere e salvarli.</span>
            <Icona nome="freccia" size={18} />
          </a>
        ))}

        <AttivaImpronta />
        <AttivaNotifiche />
        <AvvisoGuasti />

        {/* Una scheda sola con tutto quello che aspetta te (14.10.2026, prima erano fino a 7 schede una sotto l'altra). */}
        <CosePerTe voci={[
          area !== 'P' && [bozze, 'bozza di risposta da approvare', 'bozze di risposta da approvare', '#/bozze'],
          conferme > 0 && [conferme, 'cosa da confermare al Capo', 'cose da confermare al Capo', '#/capo'],
          [domande, 'domanda degli agenti', 'domande degli agenti', '#/domande'],
          [risposte, 'risposta degli agenti da leggere', 'risposte degli agenti da leggere', '#/agenti'],
          area !== 'P' && [riordino, `${area === 'C' ? 'mail della Gmail' : area === 'G' ? 'mail di info@' : 'mail'} da riordinare`, `${area === 'C' ? 'mail della Gmail' : area === 'G' ? 'mail di info@' : 'mail'} da riordinare`, '#/riordino'],
          area !== 'P' && [seguire, 'cosa da seguire (promesse e problemi fermi)', 'cose da seguire (promesse e problemi fermi)', '#/seguire'],
          [inbox, 'cosa nell\'Inbox da smistare', 'cose nell\'Inbox da smistare', '#/inbox'],
        ]} />

        {dati?.compleanni.length > 0 && (
          <>
            <h2>Compleanni</h2>
            <div className="elenco">
              {dati.compleanni.map((p) => (
                <a key={p.id} className="riga" href={p.link || `#/persona/${p.id}`}>
                  <span className="pallino" style={{ background: areaDa(p.persone_aree[0]?.area)?.colore || 'var(--grigio)' }} />
                  <span className="riga-corpo">
                    <span className="riga-testo">{[p.nome, p.cognome].filter(Boolean).join(' ')}</span>
                    <span className="riga-meta">{p.tra === 0 ? 'Oggi!' : p.tra === 1 ? 'Domani' : `Tra ${p.tra} giorni`}</span>
                  </span>
                </a>
              ))}
            </div>
          </>
        )}

        <h2>Ultime note</h2>
        <Stato carica={carica} errore={errore} vuoto={dati && dati.note.length === 0 ? 'Ancora nessuna nota tua. Tocca + per la prima.' : null}>
          {dati && <div className="elenco">{dati.note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
        </Stato>
      </div>
    </div>
  )
}

// "Cose per te": una riga per tipo, solo quelle che ci sono. Tocco = la schermata giusta.
function CosePerTe({ voci }) {
  const ci = voci.filter((v) => v && v[0] > 0)
  if (!ci.length) return null
  const tot = ci.reduce((n, v) => n + v[0], 0)
  return (
    <section className="cose-per-te" aria-label="Cose per te">
      <h3>{tot === 1 ? '1 cosa per te' : `${tot} cose per te`}</h3>
      <div className="elenco">
        {ci.map(([n, uno, tanti, href]) => (
          <a key={href} className="riga" href={href}>
            <span className="numero-voce">{n}</span>
            <span className="riga-corpo"><span className="riga-testo">{n === 1 ? uno : tanti}</span></span>
            <Icona nome="freccia" size={18} />
          </a>
        ))}
      </div>
    </section>
  )
}

// "Adesso" (14.10.2026): il prossimo appuntamento di oggi (o quello in corso) con Naviga, Chiama e Appunti.
const mappa = (luogo) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(luogo)}`
function Adesso({ e }) {
  if (!e) return null
  const inCorso = new Date(e.inizio) <= new Date()
  const tel = e.persone?.telefono
  const chi = e.persone ? [e.persone.nome, e.persone.cognome].filter(Boolean).join(' ') : ''
  const call = linkCall(e)
  return (
    <section className="adesso" style={{ '--col': areaDa(e.area)?.colore || 'var(--grigio)' }} aria-label="Prossimo appuntamento">
      <p className="adesso-quando">{inCorso ? 'Adesso' : `Alle ${ora(e)}`}{inCorso && e.fine ? ` · fino alle ${new Date(e.fine).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      <p className="adesso-titolo">{e.titolo}</p>
      {(e.luogo || e.aziende || chi) && <p className="riga-meta">{[e.luogo, e.aziende?.nome, chi].filter(Boolean).join(' · ')}</p>}
      <div className="adesso-tasti">
        {call && <a className="tasto-piccolo" href={call} target="_blank" rel="noreferrer">Entra nella call</a>}
        {e.luogo && !call && !/teams|zoom|meet|webex/i.test(e.luogo) && <a className="tasto-piccolo" href={mappa(e.luogo)} target="_blank" rel="noreferrer">Naviga</a>}
        {tel && <a className="tasto-piccolo" href={`tel:${tel}`}
          onClick={() => scrivi('chiamata', JSON.stringify({ id: e.persone.id, ora: Date.now() }))}>Chiama {e.persone.nome}</a>}
        <a className="tasto-piccolo" href={`#/visita/${e.id}`}>Appunti</a>
        {e.aziende && <a className="tasto-piccolo" href={`#/azienda/${e.aziende.id}`}>Scheda</a>}
      </div>
      {lavoro(e) && <PrimaDellaVisita e={e} />}
    </section>
  )
}

// "Prima della visita" (22.10.2026, ok di Giovanni): l'AI riassume ditta e persona dell'appuntamento (cose aperte,
// ultime novità, cosa chiedere) con i crediti API, via chiedi-ai. Il riassunto resta sul telefono per quell'appuntamento.
function PrimaDellaVisita({ e }) {
  const chiave = `prima-visita:${e.id}`
  const [ai, setAi] = useState(() => { try { return JSON.parse(leggi(chiave) || 'null') } catch { return null } })
  useAttesaAI(ai, setAi)
  useEffect(() => { if (ai?.id) scrivi(chiave, JSON.stringify(ai)) }, [ai, chiave])

  async function prepara() {
    setAi({ stato: 'in_corso' })
    try {
      const r = await chiama('chiedi-ai', { visita: e.id })
      setAi(r?.id ? { id: r.id, stato: 'in_corso' } : { stato: 'errore', testo: 'L\'AI non è pronta: dillo a Claude sul PC.' })
    } catch (err) {
      setAi({ stato: 'errore', testo: messaggioErrore(err) })
    }
  }

  if (!ai) return <button type="button" className="tasto-piccolo prima-visita-tasto" onClick={prepara}>Prima della visita</button>
  return (
    <div className="prima-visita">
      <RispostaAI ai={ai} />
      {ai.stato !== 'in_corso' && <button type="button" className="tasto-link" onClick={prepara}>Rifai il riassunto</button>}
    </div>
  )
}

// I giorni di scuola chiusa dei gemelli (eventi "Scuola chiusa: …" alle 6, colore pavone): non sono appuntamenti.
export const vacanza = (e) => /^scuola chiusa/i.test(e.titolo || '')

function nomeGiorno(g) {
  if (g === 0) return 'Oggi'
  if (g === 1) return 'Domani'
  const d = new Date()
  d.setDate(d.getDate() + g)
  const s = d.toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const ora = (e) => new Date(e.inizio).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })
const finito = (e) => new Date(e.fine || e.inizio) < new Date()
const lavoro = (e) => e.area !== 'P'

const Spunta = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)

// Spunta e Sì/No degli appuntamenti. Spuntato: sparisce da Oggi (in Google Calendar resta com'è).
function useAzioniEventi(ricarica, chiudi) {
  const { avvisa } = useApp()
  const [fatti, setFatti] = useState(() => new Set())
  const togli = (id) => setFatti((s) => { const x = new Set(s); x.delete(id); return x })

  async function fatto(e) {
    if (fatti.has(e.id)) return
    setFatti((s) => new Set(s).add(e.id))
    chiudi()
    try {
      chk(await sb.from('eventi').update({ fatto_il: new Date().toISOString() }).eq('id', e.id))
      avvisa('Fatto', {
        etichetta: 'Annulla',
        fai: async () => {
          try {
            chk(await sb.from('eventi').update({ fatto_il: null }).eq('id', e.id))
            togli(e.id)
            ricarica()
          } catch (err) { avvisa(messaggioErrore(err)) }
        },
      })
      setTimeout(ricarica, 450)
    } catch (err) {
      togli(e.id)
      avvisa(messaggioErrore(err))
    }
  }

  async function decidi(e, si) {
    try {
      chk(await sb.from('eventi').update({ stato: si ? 'da_creare' : 'scartato' }).eq('id', e.id))
      const annulla = {
        etichetta: 'Annulla',
        fai: async () => {
          try {
            chk(await sb.from('eventi').update({ stato: 'proposto' }).eq('id', e.id))
            ricarica()
          } catch (err) { avvisa(messaggioErrore(err)) }
        },
      }
      avvisa(si ? 'Lo metto nel calendario entro un\'ora' : 'Scartato', annulla)
      ricarica()
    } catch (err) {
      avvisa(messaggioErrore(err))
    }
  }

  return { fatti, fatto, decidi }
}

// Dopo il luogo: " · in arrivo nel calendario"; senza luogo niente puntino davanti.
const statoEvento = (e, primo) => {
  const p = primo ? '' : ' · '
  return (
    <>
      {e.originale.cambio && `${p}spostato, in arrivo nel calendario`}
      {e.stato === 'da_creare' && !e.errore && `${p}in arrivo nel calendario`}
      {e.errore && <span className="rosso">{p}{e.stato === 'da_creare' ? 'non creato: ' : ''}{e.errore}</span>}
    </>
  )
}

// Appuntamento = riquadro col colore dell'area e l'ora grande: lì devi esserci.
// Appunti bene in vista (lavoro, da oggi in giù). Tocco: si apre sotto con scheda, persona e "sposta o cambia".
function RiquadroEvento({ e, chiuso, apri, tocca, fatto, ricarica, chiudi, daChiudere }) {
  const g = giorniDaOggi(e.inizio)
  const conAppunti = lavoro(e) && g <= 0
  const dove = e.luogo || e.aziende?.nome || ''
  return (
    <div className={'voce-promemoria' + (chiuso ? ' via' : '')}>
      <div>
        <div style={{ '--col': areaDa(e.area)?.colore || 'var(--grigio)' }} className={'riquadro-evento' + (chiuso ? ' fatto' : '')}>
          <button type="button" className="riquadro-tocca" onClick={tocca} aria-expanded={apri}>
            <span className="riquadro-ora">
              {e.tutto_il_giorno ? <small>tutto il giorno</small> : ora(e)}
              {daChiudere && <small>{g === -1 ? 'ieri' : new Date(e.inizio).toLocaleDateString('it-CH', { weekday: 'short', day: 'numeric' })}</small>}
            </span>
            <span className="riga-corpo">
              <span className="riga-testo">{e.titolo}</span>
              {(dove || e.originale.cambio || e.stato === 'da_creare' || e.errore) && (
                <span className="riga-meta">{dove}{statoEvento(e, !dove)}</span>
              )}
            </span>
          </button>
          {conAppunti && !apri && (
            <a className="tasto-piccolo tasto-appunti" href={`#/visita/${e.id}`} aria-label={`Prendi appunti: ${e.titolo}`}>Appunti</a>
          )}
          {daChiudere && (
            <button type="button" className="spunta" onClick={() => fatto(e)} aria-label={`Chiudi: ${e.titolo}`}><Spunta /></button>
          )}
        </div>
        {apri && (
          <div className="pannello-evento">
            <div className="contatti-persona pannello-link">
              {linkCall(e) && <a className="tasto-piccolo" href={linkCall(e)} target="_blank" rel="noreferrer">Entra nella call</a>}
              {e.aziende && <a className="tasto-piccolo" href={`#/azienda/${e.aziende.id}`}>Scheda {e.aziende.nome}</a>}
              {e.persone && <a className="tasto-piccolo" href={`#/persona/${e.persone.id}`}>{[e.persone.nome, e.persone.cognome].filter(Boolean).join(' ')}</a>}
              {lavoro(e) || !e.persone
                ? <a className="tasto-piccolo" href={`#/visita/${e.id}`}>{finito(e) ? 'Com\'è andata? Appunti' : 'Appunti'}</a>
                : finito(e) && <a className="tasto-piccolo" href={`#/aggiungi?persona=${e.persone.id}`}>Com'è andata? Annota</a>}
              <button type="button" className="tasto-piccolo" onClick={() => fatto(e)}>Segna fatto</button>
            </div>
            {lavoro(e) && !finito(e) && <PrimaDellaVisita e={e} />}
            <ModificaAppuntamento e={e} fatto={ricarica} chiudi={chiudi} />
          </div>
        )}
      </div>
    </div>
  )
}

// Le date trovate dagli agenti nelle note: Sì = va nel calendario Google.
function Proposte({ proposte, aperto, setAperto, decidi, ricarica }) {
  if (!proposte.length) return null
  return (
    <>
      <h2>Da mettere in calendario?</h2>
      <div className="elenco">
        {proposte.map((e) => (
          <div key={e.id}>
            <div className="riga riga-proposta">
              <span className="pallino" style={{ background: areaDa(e.area)?.colore || 'var(--grigio)' }} />
              <button type="button" className="riga-corpo riga-tocca" onClick={() => setAperto(aperto === e.id ? null : e.id)} aria-expanded={aperto === e.id}>
                <span className="riga-testo">{e.titolo}</span>
                <span className="riga-meta">{nomeGiorno(giorniDaOggi(e.inizio))} {e.tutto_il_giorno ? 'tutto il giorno' : ora(e)}{e.motivo ? ` · ${e.motivo}` : ''}</span>
              </button>
              <span className="azioni-proposta">
                <button type="button" className="tasto-piccolo" onClick={() => decidi(e, true)}>Sì</button>
                <button type="button" className="tasto-link" onClick={() => decidi(e, false)}>No</button>
              </span>
            </div>
            {aperto === e.id && (
              <div className="pannello-evento">
                {linkCall(e) && (
                  <div className="contatti-persona pannello-link">
                    <a className="tasto-piccolo" href={linkCall(e)} target="_blank" rel="noreferrer">Link della call</a>
                  </div>
                )}
                <ModificaAppuntamento e={e} fatto={ricarica} chiudi={() => setAperto(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// Appuntamenti dei 7 giorni scorsi non chiusi: spunta, Appunti per annotare com'è andata, o tocco per spostarlo.
function DaChiudere({ vecchi, ev, aperto, setAperto, ricarica }) {
  const [tutti, setTutti] = useState(false)
  if (!vecchi.length) return null
  const visti = tutti || vecchi.length <= 3 ? vecchi : vecchi.slice(0, 3)
  return (
    <>
      <h3>Da chiudere: giorni scorsi</h3>
      <p className="nota-piccola">Spunta quelli finiti, tocca Appunti per annotare com'è andata, o tocca l'appuntamento per spostarlo.</p>
      <div className="agenda">
        {visti.map((e) => (
          <RiquadroEvento key={e.id} e={e} chiuso={ev.fatti.has(e.id)} apri={aperto === e.id} daChiudere
            tocca={() => setAperto(aperto === e.id ? null : e.id)} fatto={ev.fatto} ricarica={ricarica} chiudi={() => setAperto(null)} />
        ))}
      </div>
      {vecchi.length > 3 && (
        <button type="button" className="tasto-link" onClick={() => setTutti(!tutti)} aria-expanded={tutti}>
          {tutti ? 'Mostra solo gli ultimi 3' : `Mostra tutti: ${vecchi.length}`}
        </button>
      )}
    </>
  )
}

// Quando rimandare: domani, lunedì prossimo o tra una settimana, alla stessa ora (senza ora: alle 8).
function rimandato(p, quando) {
  const prima = p.scade_il ? new Date(p.scade_il) : null
  const d = new Date()
  if (quando === 'domani') d.setDate(d.getDate() + 1)
  else if (quando === 'lunedi') d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  else d.setDate(d.getDate() + 7)
  d.setHours(prima ? prima.getHours() : 8, prima ? prima.getMinutes() : 0, 0, 0)
  return d
}
const RIMANDA = [['domani', 'Domani'], ['lunedi', 'Lunedì'], ['settimana', 'Tra una settimana']]

// Promemoria = riga leggera con il cerchio da spuntare: una cosa da fare, non un posto dove andare.
function RigaPromemoria({ p, finito, aperta, lampo, fatto, apri, cambia, chiudi, ritardo }) {
  const col = areaDa(p.area)?.colore || 'var(--grigio)'
  const d = p.scade_il ? new Date(p.scade_il) : null
  const quandoCorto = !d ? '' : ritardo
    ? (giorniDaOggi(p.scade_il) === -1 ? 'ieri' : d.toLocaleDateString('it-CH', { day: 'numeric', month: 'short' }))
    : giorniDaOggi(p.scade_il) > 14 ? d.toLocaleDateString('it-CH', { day: 'numeric', month: 'short' })
      : d.toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={'voce-promemoria' + (finito ? ' via' : '')}>
      <div>
        <div key={lampo?.id === p.id ? lampo.k : 0} style={{ '--col': col }}
          className={'riga riga-promemoria' + (finito ? ' fatto' : '') + (lampo?.id === p.id ? ' lampo' : '')}>
          <button type="button" className="spunta" onClick={() => fatto(p)} aria-label={`Segna fatto: ${p.testo}`}><Spunta /></button>
          <span className={'ora-agenda' + (ritardo ? ' rosso' : '')}>{quandoCorto}</span>
          <button type="button" className="riga-corpo riga-tocca" onClick={apri} aria-expanded={aperta}>
            <span className="riga-testo">{p.urgente && <strong className="rosso">! </strong>}{p.testo}</span>
          </button>
        </div>
        {aperta && <ModificaPromemoria p={p} cambia={cambia} chiudi={chiudi} />}
      </div>
    </div>
  )
}

// Il promemoria aperto: correggi il testo, cambia data, rimanda con un tocco, elimina (va nel Cestino).
function ModificaPromemoria({ p, cambia, chiudi }) {
  const [testo, setTesto] = useState(p.testo)
  const [data, setData] = useState(perCampo(p.scade_il))
  const cambiato = testo.trim() !== p.testo || data !== perCampo(p.scade_il)
  useModifiche(cambiato)

  function salva() {
    if (!testo.trim()) return
    cambia(p, { testo: testo.trim(), scade_il: data ? new Date(data).toISOString() : null }, 'Salvato')
  }

  return (
    <div className="modifica-promemoria">
      <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={2} aria-label="Testo del promemoria" />
      <label className="campo">
        Quando
        <input type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} />
      </label>
      <div className="chips">
        <span className="nota-piccola">Rimanda a:</span>
        {RIMANDA.map(([k, nome]) => {
          const d = rimandato(p, k)
          return (
            <button key={k} type="button" className="chip"
              onClick={() => cambia(p, { scade_il: d.toISOString() }, `Spostato a ${quando(d.toISOString(), true)}`)}>
              {nome}
            </button>
          )
        })}
      </div>
      <div className="azioni">
        {cambiato && <button type="button" className="tasto-piccolo tasto-salva" onClick={salva}>Salva</button>}
        {p.nota_id && <a className="tasto-piccolo" href={`#/nota/${p.nota_id}`}>Apri la nota</a>}
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
        <button type="button" className="tasto-link pericolo"
          onClick={() => cambia(p, { eliminata_il: new Date().toISOString() }, 'Eliminato (resta 30 giorni nel Cestino)')}>
          Elimina
        </button>
      </div>
    </div>
  )
}

// Guasti aperti trovati dal guardiano (ogni 15 minuti), compresi backup, copie e posta (prima avevano un avviso
// ciascuno). "Manda a Claude" (21.10.2026): il guasto va in modifiche_claude già con l'ok, Claude lo trova
// all'inizio della sessione sul PC.
const appDelGuasto = (chiave) => (/^(app|db):ceramex$/.test(chiave) ? 'ceramex' : /^(app|db):gc$/.test(chiave) ? 'gc' : 'brain')
function AvvisoGuasti() {
  const { avvisa } = useApp()
  const [guasti, setGuasti] = useState([])
  const [mandati, setMandati] = useState(() => new Set())

  const carica = useCallback(async () => {
    const { data } = await sb.from('guasti').select('id,chiave,titolo,dettaglio,aperto_il').is('chiuso_il', null).order('aperto_il')
    setGuasti(data || [])
    if (data?.length) {
      const { data: m } = await sb.from('modifiche_claude').select('guasto_id').in('guasto_id', data.map((g) => g.id))
      setMandati(new Set((m || []).map((x) => x.guasto_id)))
    }
  }, [])
  useEffect(() => { carica() }, [carica])

  async function manda(g) {
    try {
      chk(await sb.from('modifiche_claude').insert({
        app: appDelGuasto(g.chiave), guasto_id: g.id, stato: 'ok', ok_il: new Date().toISOString(),
        titolo: `Guasto: ${g.titolo}`,
        testo: `Trovato dal guardiano il ${quando(g.aperto_il, true)} (${g.chiave}).\n${g.dettaglio || ''}\nGuarda cosa non va e sistemalo.`,
      }))
      setMandati((s) => new Set(s).add(g.id))
      avvisa('Mandato a Claude: lo trova quando apri la sessione sul PC')
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  if (!guasti.length) return null
  return (
    <div className="scheda scheda-allarme">
      {guasti.map((g) => (
        <div key={g.id}>
          <p>{g.titolo} (dal {quando(g.aperto_il, true)}). {g.dettaglio}</p>
          {mandati.has(g.id)
            ? <p className="piccolo">Mandato a Claude.</p>
            : <button type="button" className="tasto-piccolo" onClick={() => manda(g)}>Manda a Claude</button>}
        </div>
      ))}
    </div>
  )
}

// Invito ad attivare l'accesso con impronta/volto, finché non è attivo.
function AttivaImpronta() {
  const { avvisa } = useApp()
  const [mostra, setMostra] = useState(false)
  const [lavoro, setLavoro] = useState(false)

  useEffect(() => {
    if (!window.PublicKeyCredential || leggi('impronta-rimandata') === '1') return
    sb.auth.passkey.list().then(({ data, error }) => {
      if (error) return
      if (data?.length) scrivi('impronta-attiva', '1')
      else setMostra(true)
    })
  }, [])

  async function attiva() {
    setLavoro(true)
    const { error } = await sb.auth.registerPasskey()
    setLavoro(false)
    if (error) return avvisa('Impronta non attivata: ' + (error.message || 'riprova'))
    scrivi('impronta-attiva', '1')
    setMostra(false)
    avvisa('Fatto. Dalla prossima volta entri con impronta o volto.')
  }

  if (!mostra) return null
  return (
    <div className="scheda scheda-impronta">
      <p>Vuoi entrare con impronta o volto, senza codici?</p>
      <div className="azioni">
        <button type="button" className="tasto-pieno" onClick={attiva} disabled={lavoro}>Attiva</button>
        <button type="button" className="tasto-link" onClick={() => { scrivi('impronta-rimandata', '1'); setMostra(false) }}>
          Più tardi
        </button>
      </div>
    </div>
  )
}

// Prossima sveglia Sonos (Privato e Tutte): una riga piccola, il tocco apre la pagina Sveglie. Senza Sonos o senza rete non c'è.
function ProssimaSveglia() {
  const { area } = useApp()
  const [p, setP] = useState(null)
  useEffect(() => {
    if (area !== 'P' && area !== 'T') return
    let vivo = true
    chiama('sonos', { azione: 'sveglie_elenco' }).then((d) => { if (vivo) setP(d?.prossima || null) }).catch(() => {})
    return () => { vivo = false }
  }, [area])
  if (!p || (area !== 'P' && area !== 'T')) return null
  const g = giorniDaOggi(`${p.data}T12:00:00`)
  const quale = g === 0 ? 'oggi' : g === 1 ? 'domani' : new Date(`${p.data}T12:00`).toLocaleDateString('it-CH', { weekday: 'long' })
  return (
    <a href="#/sveglie" className="riga-prossima-sveglia">
      <Icona nome="sveglie" size={18} />
      <span>Sveglia {quale} alle <b>{p.ora}</b> · {p.cassa}</span>
    </a>
  )
}