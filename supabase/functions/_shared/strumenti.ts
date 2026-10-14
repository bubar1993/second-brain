// Strumenti di SOLA LETTURA sul second brain, per la risposta dell'AI in Chiedi (chiedi-ai, 14.10.2026).
// Da qui in avanti questa è la fonte unica: oggi la usa solo chiedi-ai; il connettore `mcp` ne ha ancora una sua
// copia più vecchia (da passare a questo file con l'ok di Giovanni, vedi CLAUDE.md).
// Differenze rispetto a `mcp`:
// - l'area la decide il server (quella scelta in alto nell'app), mai il modello: con un'area scelta non esce
//   niente delle altre aree (note, riassunti delle persone, mail);
// - ogni cosa trovata ha un numero [n] e il suo collegamento nell'app: la risposta cita i numeri e i link li
//   costruisce il server (mai link scritti dal modello).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type Area = 'C' | 'G' | 'P'
export type Fonte = { n: number; tipo: string; titolo: string; area: string | null; data: string | null; link: string }
export type Contesto = {
  sb: SupabaseClient
  area: Area | null // null = tutte le aree
  chiamaFunzione: (nome: string, corpo: unknown) => Promise<any> // con lo stesso accesso di chi chiede
  fonte: (f: Omit<Fonte, 'n'>) => number
  fonti: Fonte[]
}
type Strumento = { descrizione: string; parametri: Record<string, unknown>; richiesti?: string[]; fai: (c: Contesto, a: Record<string, any>) => Promise<string> }

export const AREE: Record<string, string> = { C: 'Ceramex', G: 'G&C', P: 'Privato' }
const fuso = 'Europe/Zurich'
const giorno = (d?: string | null) => d ? new Date(d).toLocaleString('it-CH', { timeZone: fuso, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const giornoSolo = (d?: string | null) => d ? new Date(d).toLocaleDateString('it-CH', { timeZone: fuso }) : ''
const corto = (t?: string | null, n = 600) => !t ? '' : t.length > n ? t.slice(0, n) + '…' : t
const pulisciNome = (s: string) => String(s || '').replace(/[,()%*\\]/g, ' ').trim()

export function nuovoContesto(sb: SupabaseClient, area: Area | null, chiamaFunzione: Contesto['chiamaFunzione']): Contesto {
  const fonti: Fonte[] = []
  const perLink = new Map<string, number>()
  return {
    sb, area, chiamaFunzione, fonti,
    fonte: (f) => {
      const gia = perLink.get(f.link)
      if (gia) return gia
      const n = fonti.length + 1
      fonti.push({ ...f, n })
      perLink.set(f.link, n)
      return n
    },
  }
}

async function chk<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

// Persone che stanno nell'area scelta (una persona può stare in più aree).
async function personeDellArea(c: Contesto, ids: string[]) {
  if (!c.area || !ids.length) return new Set(ids)
  const righe = await chk(c.sb.from('persone_aree').select('persona_id').eq('area', c.area).in('persona_id', ids)) as any[]
  return new Set(righe.map((r) => r.persona_id))
}

export const STRUMENTI: Record<string, Strumento> = {
  cerca: {
    descrizione: 'Cerca in tutto il second brain (note, mail G&C, riassunti delle persone, WhatsApp): prima per parole, poi per significato. Usalo per primo per quasi ogni domanda. Si può chiamare più volte con parole diverse.',
    parametri: { testo: { type: 'string', description: 'Parole da cercare, es. "Bazzi campionatura" o "offerta Profilitec"' },
      quanti: { type: 'integer', description: 'Quanti risultati per parole (max 30, di solito 15)' } },
    richiesti: ['testo'],
    fai: async (c, a) => {
      const testo = String(a.testo || '').trim().slice(0, 300)
      if (!testo) return 'Testo vuoto.'
      const [parole, significato] = await Promise.all([
        chk(c.sb.rpc('cerca', { q: testo, area_scelta: c.area, quanti: Math.min(Number(a.quanti) || 15, 30) })) as Promise<any[]>,
        c.chiamaFunzione('significato', { azione: 'cerca', q: testo, area: c.area, quanti: 8 }).then((r) => r?.risultati || []).catch(() => []),
      ])
      const visti = new Set<string>()
      const righe = [...(parole || []), ...significato].filter((r) => {
        const k = r.tipo + r.id
        if (visti.has(k) || (c.area && r.area !== c.area)) return false
        visti.add(k)
        return true
      })
      if (!righe.length) return 'Nessun risultato.'
      return righe.map((r) => {
        const n = c.fonte({ tipo: r.tipo, titolo: r.titolo || r.tipo, area: r.area, data: r.data, link: r.collegamento })
        return `[${n}] ${r.tipo} {${AREE[r.area] || 'Inbox'}} ${giornoSolo(r.data)} ${r.titolo || ''}: ${corto(String(r.estratto || '').replace(/[«»]/g, ''), 400)}`
      }).join('\n')
    },
  },
  agenda: {
    descrizione: 'Appuntamenti (Google Calendar), promemoria aperti e il punto del giorno scritto dagli agenti. Per domande come "cosa ho oggi/domani/questa settimana" o "quando vedo…".',
    parametri: { giorni: { type: 'integer', description: 'Quanti giorni avanti guardare (default 7, max 45)' },
      indietro: { type: 'integer', description: 'Quanti giorni indietro (default 0, max 30), per "quando ho visto…"' } },
    fai: async (c, a) => {
      const g = Math.min(Math.max(Number(a.giorni) || 7, 1), 45)
      const ind = Math.min(Math.max(Number(a.indietro) || 0, 0), 30)
      const da = new Date(); da.setHours(0, 0, 0, 0); da.setTime(da.getTime() - ind * 864e5)
      const fino = new Date(Date.now() + (g + 1) * 864e5)
      let qe = c.sb.from('eventi').select('id,titolo,inizio,fine,tutto_il_giorno,luogo,area,stato,fatto_il,aziende(nome),persone(nome,cognome)')
        .in('stato', ['confermato', 'proposto']).gte('inizio', da.toISOString()).lt('inizio', fino.toISOString()).order('inizio').limit(80)
      let qp = c.sb.from('promemoria').select('id,testo,scade_il,area,urgente,nota_id').is('fatto_il', null).is('eliminata_il', null)
        .lt('scade_il', fino.toISOString()).order('scade_il').limit(40)
      if (c.area) { qe = qe.eq('area', c.area); qp = qp.eq('area', c.area) }
      const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: fuso })
      const [ev, pr, ri] = await Promise.all([chk(qe), chk(qp),
        chk(c.sb.from('riassunti_giorno').select('parte,momento,testo').eq('giorno', oggi))]) as any[][]
      const out = [`APPUNTAMENTI (da ${giornoSolo(da.toISOString())}, prossimi ${g} giorni):`]
      out.push(...(ev.length ? ev.map((e) => {
        const n = c.fonte({ tipo: 'appuntamento', titolo: e.titolo, area: e.area, data: e.inizio, link: '#/oggi' })
        return `[${n}] ${e.tutto_il_giorno ? giornoSolo(e.inizio) + ' tutto il giorno' : giorno(e.inizio)} ${e.titolo}${e.luogo ? ' @ ' + e.luogo : ''}${e.aziende ? ' [' + e.aziende.nome + ']' : ''}${e.persone ? ' (' + [e.persone.nome, e.persone.cognome].filter(Boolean).join(' ') + ')' : ''} {${AREE[e.area] || '-'}}${e.stato === 'proposto' ? ' (proposto, non ancora in calendario)' : ''}${e.fatto_il ? ' (fatto)' : ''}`
      }) : ['- nessuno']))
      out.push('PROMEMORIA APERTI (scaduti o in arrivo):')
      out.push(...(pr.length ? pr.map((p) => {
        const n = c.fonte({ tipo: 'promemoria', titolo: corto(p.testo, 60), area: p.area, data: p.scade_il, link: p.nota_id ? `#/nota/${p.nota_id}` : '#/oggi' })
        return `[${n}] ${giorno(p.scade_il)} ${p.urgente ? '[URGENTE] ' : ''}${p.testo} {${AREE[p.area] || 'Inbox'}}`
      }) : ['- nessuno']))
      // Il punto del giorno: la parte privata solo se il Privato è nell'area scelta.
      const punti = ri.filter((r) => !c.area || (c.area === 'P' ? r.parte === 'privato' : r.parte === 'lavoro'))
      if (punti.length) out.push('PUNTO DEL GIORNO:', ...punti.map((r) => `- ${r.parte} ${r.momento}: ${r.testo}`))
      return out.join('\n')
    },
  },
  azienda: {
    descrizione: 'Scheda di una ditta (cliente Ceramex o G&C): dati, persone, cantieri e le note più recenti per mandante/fornitore e sezione (problemi, campionature, offerte, ordini, accordi, comunicazioni). Utile prima di una visita o per "come siamo messi con…".',
    parametri: { nome: { type: 'string', description: 'Nome della ditta (anche parziale)' },
      note: { type: 'integer', description: 'Quante note recenti (default 30, max 80)' } },
    richiesti: ['nome'],
    fai: async (c, a) => {
      const chi = pulisciNome(a.nome)
      if (!chi) return 'Nome vuoto.'
      let q = c.sb.from('aziende').select('id,nome,ragione_sociale,area,email').is('eliminata_il', null).is('unito_in', null)
        .or(`nome.ilike.%${chi}%,ragione_sociale.ilike.%${chi}%`).limit(6)
      if (c.area) q = q.eq('area', c.area)
      const ditte = await chk(q) as any[]
      if (!ditte.length) return 'Nessuna ditta con questo nome' + (c.area ? ` in ${AREE[c.area]}.` : '.')
      const esatta = ditte.find((d) => d.nome.toLowerCase() === chi.toLowerCase())
      if (ditte.length > 1 && !esatta) return 'Più ditte trovate, richiama con il nome esatto:\n' + ditte.map((d) => `- ${d.nome} (${AREE[d.area]})`).join('\n')
      const d = esatta || ditte[0]
      let qn = c.sb.from('note').select('id,testo,data,creata_il,mandante,sezione,contatto,risolto_il,area').eq('azienda_id', d.id)
        .is('eliminata_il', null).is('scartata_il', null).order('creata_il', { ascending: false }).limit(Math.min(Number(a.note) || 30, 80))
      if (c.area) qn = qn.eq('area', c.area)
      const [note, persone, cantieri] = await Promise.all([
        chk(qn),
        chk(c.sb.from('persone_aziende').select('ruolo,persone(id,nome,cognome,telefono,email)').eq('azienda_id', d.id)),
        chk(c.sb.from('cantieri').select('nome,stato,descrizione').eq('azienda_id', d.id).is('eliminata_il', null)),
      ]) as any[][]
      const n0 = c.fonte({ tipo: 'azienda', titolo: d.nome, area: d.area, data: null, link: `#/azienda/${d.id}` })
      const out = [`[${n0}] ${d.nome}${d.ragione_sociale && d.ragione_sociale !== d.nome ? ' (' + d.ragione_sociale + ')' : ''} — ${AREE[d.area]}`]
      if (d.email?.length) out.push('Email: ' + d.email.slice(0, 8).join(', ') + (d.email.length > 8 ? ` e altre ${d.email.length - 8}` : ''))
      if (persone.length) out.push('Persone: ' + persone.map((p) => `${[p.persone?.nome, p.persone?.cognome].filter(Boolean).join(' ')}${p.ruolo ? ' (' + p.ruolo + ')' : ''}${p.persone?.telefono ? ' tel ' + p.persone.telefono : ''}`).join('; '))
      if (cantieri.length) out.push('Cantieri: ' + cantieri.map((x) => `${x.nome}${x.descrizione ? ' ' + x.descrizione : ''}${x.stato ? ' [' + x.stato + ']' : ''}`).join('; '))
      out.push('NOTE (dalla più recente):')
      out.push(...note.map((x) => {
        const n = c.fonte({ tipo: 'nota', titolo: `${d.nome}${x.sezione ? ' · ' + x.sezione : ''}`, area: x.area, data: x.data || x.creata_il, link: `#/nota/${x.id}` })
        return `[${n}] ${giornoSolo(x.data || x.creata_il)} ${[x.mandante, x.sezione].filter(Boolean).join('/')}${x.risolto_il ? ' (risolto)' : ''}${x.contatto ? ' [' + x.contatto + ']' : ''}: ${corto(x.testo, 450)}`
      }))
      return out.join('\n')
    },
  },
  persona: {
    descrizione: 'Scheda di una persona: chi è, ditte, contatti, riassunto scritto dagli agenti (cose aperte, cosa chiedere, ultimo contatto, come parlarle), note recenti.',
    parametri: { nome: { type: 'string', description: 'Nome e/o cognome (anche parziale)' } },
    richiesti: ['nome'],
    fai: async (c, a) => {
      const parole = pulisciNome(a.nome).split(/\s+/).filter(Boolean)
      if (!parole.length) return 'Nome vuoto.'
      let q = c.sb.from('persone').select('id,nome,cognome,ruolo,telefono,email,compleanno').is('eliminata_il', null)
      for (const p of parole) q = q.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%`)
      const trovate = await chk(q.limit(12)) as any[]
      const ok = await personeDellArea(c, trovate.map((p) => p.id))
      const tutte = trovate.filter((p) => ok.has(p.id)).slice(0, 6)
      if (!tutte.length) return 'Nessuna persona con questo nome' + (c.area ? ` in ${AREE[c.area]}.` : '.')
      if (tutte.length > 1) {
        const ditte = await chk(c.sb.from('persone_aziende').select('persona_id,aziende(nome)').in('persona_id', tutte.map((p) => p.id))) as any[]
        return 'Più persone trovate, richiama con nome e cognome:\n' + tutte.map((p) => `- ${[p.nome, p.cognome].filter(Boolean).join(' ')} (${ditte.filter((d) => d.persona_id === p.id).map((d) => d.aziende?.nome).join(', ') || 'senza ditta'})`).join('\n')
      }
      const p = tutte[0]
      let qr = c.sb.from('persone_riassunti').select('*').eq('persona_id', p.id)
      if (c.area) qr = qr.eq('area', c.area)
      const [ditte, riassunti, legami] = await Promise.all([
        chk(c.sb.from('persone_aziende').select('ruolo,aziende(nome,area)').eq('persona_id', p.id)),
        chk(qr),
        chk(c.sb.from('note_persone').select('note(id,testo,area,data,creata_il,eliminata_il,scartata_il)').eq('persona_id', p.id)),
      ]) as any[][]
      const note = legami.map((l) => l.note).filter((n) => n && !n.eliminata_il && !n.scartata_il && (!c.area || n.area === c.area))
        .sort((x, y) => String(y.creata_il).localeCompare(String(x.creata_il))).slice(0, 25)
      const nome = [p.nome, p.cognome].filter(Boolean).join(' ')
      const n0 = c.fonte({ tipo: 'persona', titolo: nome, area: c.area, data: null, link: `#/persona/${p.id}` })
      const out = [`[${n0}] ${nome}${p.ruolo ? ` — ${p.ruolo}` : ''}`]
      const ditteViste = ditte.filter((d) => !c.area || d.aziende?.area === c.area)
      if (ditteViste.length) out.push('Ditte: ' + ditteViste.map((d) => `${d.aziende?.nome} (${AREE[d.aziende?.area]})`).join(', '))
      out.push([p.telefono && 'tel ' + p.telefono, p.email, p.compleanno && 'compleanno ' + giornoSolo(p.compleanno)].filter(Boolean).join(' · '))
      for (const r of riassunti) out.push(`RIASSUNTO ${AREE[r.area]} (agg. ${giornoSolo(r.aggiornato_il)}): chi è: ${r.chi_e || '-'} | ultimo contatto: ${r.ultimo_incontro || '-'} | cose aperte: ${r.cose_aperte || '-'} | da chiedere: ${r.da_chiedere || '-'} | come parlarle: ${r.consigli || '-'}`)
      out.push('NOTE RECENTI:', ...note.map((x) => {
        const n = c.fonte({ tipo: 'nota', titolo: nome, area: x.area, data: x.data || x.creata_il, link: `#/nota/${x.id}` })
        return `[${n}] ${giornoSolo(x.data || x.creata_il)} {${AREE[x.area] || 'Inbox'}} ${corto(x.testo, 400)}`
      }))
      return out.join('\n')
    },
  },
  leggi: {
    descrizione: 'Testo completo di una nota o di una mail già trovata, dal suo numero [n] (solo tipo nota o mail).',
    parametri: { numero: { type: 'integer', description: 'Il numero [n] della fonte' } },
    richiesti: ['numero'],
    fai: async (c, a) => {
      const f = c.fonti.find((x) => x.n === Number(a.numero))
      if (!f) return 'Numero sconosciuto: usa un numero già trovato.'
      if (f.link.startsWith('#/nota/')) {
        const [n] = await chk(c.sb.from('note').select('testo,area,data,creata_il,mandante,sezione,contatto,risolto_il,fonte,aziende(nome)')
          .eq('id', f.link.slice(7)).limit(1)) as any[]
        if (!n || (c.area && n.area !== c.area)) return 'Nota non trovata.'
        return `[${f.n}] ${giornoSolo(n.data || n.creata_il)} {${AREE[n.area] || 'Inbox'}} ${n.aziende?.nome || ''} ${[n.mandante, n.sezione].filter(Boolean).join('/')} (fonte ${n.fonte})${n.risolto_il ? ' — risolto' : ''}\n${corto(n.testo, 6000)}`
      }
      if (f.link.startsWith('#/mail/')) {
        const mid = decodeURIComponent(f.link.slice(7))
        const [m] = await chk(c.sb.from('posta').select('da,da_nome,a,oggetto,data,testo,cartella,area').eq('message_id', mid).limit(1)) as any[]
        if (!m || (c.area && m.area !== c.area)) return 'Mail non trovata.'
        return `[${f.n}] ${giorno(m.data)} ${m.cartella === 'inviata' ? 'INVIATA a ' + (m.a || []).join(', ') : 'da ' + (m.da_nome || '') + ' <' + m.da + '>'}\nOggetto: ${m.oggetto}\n\n${corto(m.testo, 6000)}`
      }
      return 'Questo numero non è una nota né una mail.'
    },
  },
}

export const definizioniStrumenti = () => Object.entries(STRUMENTI).map(([name, s]) => ({
  name, description: s.descrizione, input_schema: { type: 'object', properties: s.parametri, required: s.richiesti || [] },
}))

export async function usaStrumento(c: Contesto, nome: string, argomenti: Record<string, any>) {
  const s = STRUMENTI[nome]
  if (!s) return { testo: `Strumento sconosciuto: ${nome}`, errore: true }
  try {
    return { testo: await s.fai(c, argomenti || {}), errore: false }
  } catch (e) {
    return { testo: 'Errore: ' + String((e as Error)?.message || e).slice(0, 300), errore: true }
  }
}
