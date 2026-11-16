// Guardia del push (hook PreToolUse di Claude Code, impostato in %USERPROFILE%\.claude\settings.json, solo PowerShell|Bash).
// Prima di un "git push" scarica le novità da GitHub: se lassù ci sono modifiche che qui mancano
// (per esempio di Cowork su gestionale-gc), il push si ferma e Claude deve fare prima "git pull".
// Vale per tutte le cartelle. Se la guardia stessa si guasta non blocca il lavoro: scrive l'errore e lascia passare.
import { execFileSync } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'

const PUSH = /\bgit\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)?push\b/i

function rispondi(decisione, motivo) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decisione, permissionDecisionReason: motivo },
  }))
  process.exit(0)
}

// Cartella in cui gira il push: git -C <cartella>, oppure l'ultimo cd/Set-Location prima del push, oppure la cartella di lavoro.
function cartellaDelPush(cmd, cwd) {
  let dir = cwd
  for (const pezzo of cmd.split(/;|&&|\n/)) {
    const cd = pezzo.match(/^\s*(?:cd|Set-Location|sl|pushd|Push-Location)\s+(?:-Path\s+|-LiteralPath\s+)?["']?([^"';]+?)["']?\s*$/i)
    if (cd) { dir = isAbsolute(cd[1]) ? cd[1] : resolve(dir, cd[1]); continue }
    const push = pezzo.match(/\bgit\s+(?:-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+)?push\b/i)
    if (push) {
      const c = push[1] || push[2] || push[3]
      return c ? (isAbsolute(c) ? c : resolve(dir, c)) : dir
    }
  }
  return null
}

function controllaPush(nome, input, cwd) {
  if (nome !== 'PowerShell' && nome !== 'Bash') return
  const cmd = String(input.command || '')
  if (!PUSH.test(cmd)) return
  const dir = cartellaDelPush(cmd, cwd)
  if (!dir) return
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 25000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    git('fetch', '--quiet')
  } catch {
    rispondi('ask', `Non riesco a controllare GitHub prima del push (${dir}): niente rete o cartella sbagliata. Vuoi fare il push lo stesso?`)
  }
  let indietro = 0
  try { indietro = Number(git('rev-list', '--count', 'HEAD..@{u}')) || 0 } catch { return } // ramo senza collegamento: git stesso lo dirà
  if (indietro > 0) {
    rispondi('deny', `Push fermato: su GitHub ci sono ${indietro} modifiche che qui non ci sono (forse di Cowork). ` +
      'Prima fai "git pull" in un comando a parte (e controlla che non ci siano conflitti), poi il push.')
  }
}

let dati = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { dati += c })
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(dati.replace(/^﻿/, '') || '{}')
    controllaPush(e.tool_name || '', e.tool_input || {}, e.cwd || process.cwd())
    process.exit(0)
  } catch (err) {
    process.stderr.write(`Guardia del push: errore interno (${err && err.message}); azione lasciata passare.\n`)
    process.exit(1)
  }
})
