import './style.css'
import './wsv.css'

type Team = { id: string; name: string }
type Pairing = { a: string; b: string | null; court: number; result: 'a' | 'b' | 'draw' | null; scoreA?: number | null; scoreB?: number | null }
type Round = { pairings: Pairing[] }
type Tournament = { title: string; courts: number; teams: Team[]; rounds: Round[] }

const STORAGE_KEY = 'pickleball-swiss-v1'
let state: Tournament = load()
let activeTab = 'turnier'

function load(): Tournament {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try { return JSON.parse(raw) as Tournament } catch { /* use defaults */ }
  }
  return { title: 'Pickleball Turnier', courts: 4, teams: [], rounds: [] }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function escapeHtml(value: string) {
  const node = document.createElement('span')
  node.textContent = value
  return node.innerHTML
}

function getTeam(id: string) {
  return state.teams.find(team => team.id === id)
}

function previousPairs(teamId: string) {
  const pairs = new Set<string>()
  for (const round of state.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.a === teamId && pairing.b) pairs.add(pairing.b)
      if (pairing.b === teamId) pairs.add(pairing.a)
    }
  }
  return pairs
}

function stats() {
  const table = state.teams.map(team => ({
    id: team.id,
    name: team.name,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gamePoints: 0,
    buchholz: 0,
  }))

  for (const round of state.rounds) {
    for (const pairing of round.pairings) {
      if (!pairing.b) {
        continue
      }
      const a = table.find(row => row.id === pairing.a)
      const b = table.find(row => row.id === pairing.b)
      if (!a || !b) continue
      a.gamePoints += pairing.scoreA ?? 0
      b.gamePoints += pairing.scoreB ?? 0
      if (pairing.result === 'a') { a.points += 1; a.wins++; b.losses++ }
      else if (pairing.result === 'b') { b.points += 1; b.wins++; a.losses++ }
      else if (pairing.result === 'draw') { a.points += 0.5; b.points += 0.5; a.draws++; b.draws++ }
    }
  }

  for (const round of state.rounds) {
    for (const pairing of round.pairings) {
      if (!pairing.b) continue
      const a = table.find(row => row.id === pairing.a)
      const b = table.find(row => row.id === pairing.b)
      if (a) a.buchholz += b?.points ?? 0
      if (b) b.buchholz += a?.points ?? 0
    }
  }

  table.sort((x, y) => y.points - x.points || y.buchholz - x.buchholz || y.gamePoints - x.gamePoints || y.wins - x.wins || x.name.localeCompare(y.name, 'de'))
  return table
}

function rankingTeamIds() {
  return stats().map(row => row.id)
}

function pairingComplete(pairing: Pairing) {
  return pairing.b === null || (pairing.result !== null && pairing.scoreA != null && pairing.scoreB != null)
}

function availableTeamIds() {
  if (state.rounds.length === 0) return rankingTeamIds()

  const busy = new Set<string>()
  for (const round of state.rounds) {
    for (const pairing of round.pairings) {
      if (!pairingComplete(pairing)) {
        busy.add(pairing.a)
        if (pairing.b) busy.add(pairing.b)
      }
    }
  }
  return rankingTeamIds().filter(id => !busy.has(id))
}

function generateRound() {
  if (state.teams.length < 2) return

  const remaining = [...availableTeamIds()]
  if (remaining.length < 2) {
    alert('Noch nicht genügend Teams sind spielfrei. Trage zuerst weitere Ergebnisse ein.')
    return
  }

  const pairings: Pairing[] = []

  if (remaining.length % 2 === 1) {
    const byByeCount = [...remaining].reverse().sort((x, y) => {
      const xCount = state.rounds.filter(r => r.pairings.some(p => p.a === x && p.b === null)).length
      const yCount = state.rounds.filter(r => r.pairings.some(p => p.a === y && p.b === null)).length
      return xCount - yCount
    })
    const by = byByeCount.find(id => !state.rounds.at(-1)?.pairings.some(p => p.a === id && p.b === null)) ?? byByeCount[0]
    remaining.splice(remaining.indexOf(by), 1)
    pairings.push({ a: by, b: null, court: 0, result: 'a' })
  }

  function match(ids: string[], start: number, matches: [string, string][]): [string, string][] | null {
    if (start >= ids.length) return matches
    const first = ids[start]
    const oldPairs = previousPairs(first)
    for (let i = start + 1; i < ids.length; i++) {
      const second = ids[i]
      if (oldPairs.has(second)) continue
      const rest = [...ids]
      rest.splice(i, 1)
      rest.splice(start, 1)
      const next = match(rest, 0, [...matches, [first, second]])
      if (next) return next
    }
    for (let i = start + 1; i < ids.length; i++) {
      const second = ids[i]
      const rest = [...ids]
      rest.splice(i, 1)
      rest.splice(start, 1)
      const next = match(rest, 0, [...matches, [first, second]])
      if (next) return next
    }
    return null
  }

  let matches = match(remaining, 0, [])
  if (!matches) {
    matches = []
    for (let i = 0; i < remaining.length; i += 2) matches.push([remaining[i], remaining[i + 1]])
  }

  let court = 1
  for (const [a, b] of matches) {
    pairings.push({ a, b, court: court <= state.courts ? court : ((court - 1) % state.courts) + 1, result: null, scoreA: null, scoreB: null })
    court++
  }
  state.rounds.push({ pairings })
  save()
  render()
}

function setResult(roundIndex: number, pairingIndex: number, result: Pairing['result']): void {
  const pairing = state.rounds[roundIndex].pairings[pairingIndex]
  pairing.result = result

  if (result === 'a') {
    pairing.scoreA = 11
    pairing.scoreB = 0
  } else if (result === 'b') {
    pairing.scoreA = 0
    pairing.scoreB = 11
  } else if (result === 'draw') {
    pairing.scoreA = 11
    pairing.scoreB = 11
  }

  save()
  render()
}

function setCourt(roundIndex: number, pairingIndex: number, court: number): void {
  state.rounds[roundIndex].pairings[pairingIndex].court = court
  save()
}

function setScore(roundIndex: number, pairingIndex: number, side: 'a' | 'b', value: string): void {
  const pairing = state.rounds[roundIndex].pairings[pairingIndex]
  const score = value === '' ? null : Math.max(0, Number.parseInt(value, 10) || 0)
  if (side === 'a') pairing.scoreA = score
  else pairing.scoreB = score
  save()
  render()
}

function addTeam() {
  const teamNumber = state.teams.length + 1
  const team = { id: uid(), name: `Team ${teamNumber}` }
  state.teams.push(team)
  activeTab = 'teams'
  save()
  render()

  const input = document.querySelector<HTMLInputElement>(`.team-input[data-team="${team.id}"]`)
  input?.focus()
  input?.select()
}

function removeTeam(id: string) {
  if (state.rounds.length) return
  state.teams = state.teams.filter(team => team.id !== id)
  activeTab = 'teams'
  save()
  render()
}

function render() {
  const table = stats()
  const latestRound = state.rounds.length
  const roundsHtml = latestRound ? state.rounds.map((round, roundIndex) => `
          <article class="round-card ${roundIndex === state.rounds.length - 1 ? 'current-round' : ''}">
            <div class="round-head"><h3>Runde ${roundIndex + 1}</h3><span>${round.pairings.every(p => p.result !== null) ? 'Abgeschlossen' : 'Läuft'}</span></div>
            <div class="pairings">
              ${round.pairings.map((pairing, pairingIndex) => {
                const a = getTeam(pairing.a)
                const b = pairing.b ? getTeam(pairing.b) : null
                if (!b) return `<div class="pairing bye"><div class="court"><select disabled><option>Freilos</option></select></div><div class="team-name">${escapeHtml(a?.name ?? '')}</div><div class="bye-label">Freilos</div></div>`
                const courtOptions = Array.from({ length: state.courts }, (_, i) => `<option value="${i + 1}" ${pairing.court === i + 1 ? 'selected' : ''}>Platz ${i + 1}</option>`).join('')
                return `<div class="pairing">
                  <div class="court"><select class="court-select" data-round="${roundIndex}" data-pairing="${pairingIndex}" aria-label="Platz">${courtOptions}</select></div>
                  <div class="team-name ${pairing.result === 'a' ? 'winner' : ''}">${escapeHtml(a?.name ?? '')}</div>
                  <div class="score-and-result">
                    <div class="score-row">
                      <input class="score-input" type="number" min="0" data-score="a" data-round="${roundIndex}" data-pairing="${pairingIndex}" value="${pairing.scoreA ?? ''}" aria-label="Spielpunkte ${escapeHtml(a?.name ?? '')}" placeholder="0">
                      <span>:</span>
                      <input class="score-input" type="number" min="0" data-score="b" data-round="${roundIndex}" data-pairing="${pairingIndex}" value="${pairing.scoreB ?? ''}" aria-label="Spielpunkte ${escapeHtml(b?.name ?? '')}" placeholder="0">
                    </div>
                    <div class="result-buttons">
                      <button class="result ${pairing.result === 'a' ? 'selected' : ''}" data-result="a" data-round="${roundIndex}" data-pairing="${pairingIndex}">Sieg</button>
                      <button class="result draw ${pairing.result === 'draw' ? 'selected' : ''}" data-result="draw" data-round="${roundIndex}" data-pairing="${pairingIndex}">Remis</button>
                      <button class="result ${pairing.result === 'b' ? 'selected' : ''}" data-result="b" data-round="${roundIndex}" data-pairing="${pairingIndex}">Sieg</button>
                    </div>
                  </div>
                  <div class="team-name right ${pairing.result === 'b' ? 'winner' : ''}">${escapeHtml(b?.name ?? '')}</div>
                </div>`
              }).join('')}
            </div>
          </article>
        `).join('') : `<div class="empty"><div class="empty-icon">🏓</div><h3>Bereit für die erste Runde</h3><p>Lege Teams und Plätze fest und erstelle anschließend den Spielplan.</p></div>`

  const availableCount = availableTeamIds().length
  const canCreatePairings = availableCount >= 2

  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark">PS</span><div><strong>Swiss Pickle</strong><small>Turnierleiter</small></div></div>
      <div class="header-actions">
        <button class="icon-button" id="exportBtn" title="Turnier exportieren">↓</button>
        <button class="icon-button" id="importBtn" title="Turnier importieren">↑</button>
        <input id="importFile" type="file" accept="application/json" hidden>
        <button class="danger-ghost" id="resetBtn">Neues Turnier</button>
      </div>
    </header>

    <main>
      <section class="hero-card">
        <div>
          <span class="eyebrow">Aktives Turnier</span>
          <input class="title-input" id="titleInput" value="${escapeHtml(state.title)}" aria-label="Turniername">
        </div>
        <div class="stats-strip">
          <div><strong>${state.teams.length}</strong><span>Teams</span></div>
          <div><strong>${latestRound}</strong><span>Runden</span></div>
          <div><strong>${state.courts}</strong><span>Plätze</span></div>
        </div>
      </section>

      <nav class="tabs">
        <button class="tab ${activeTab === 'turnier' ? 'active' : ''}" data-tab="turnier">Turnier</button>
        <button class="tab ${activeTab === 'teams' ? 'active' : ''}" data-tab="teams">Teams</button>
        <button class="tab ${activeTab === 'tabelle' ? 'active' : ''}" data-tab="tabelle">Tabelle</button>
      </nav>

      <section class="tab-panel ${activeTab === 'turnier' ? 'active' : ''}" id="panel-turnier">
        <div class="section-heading">
          <div><span class="eyebrow">Spielplan</span><h2>${latestRound ? `Runde ${latestRound}` : 'Noch keine Runde'}</h2></div>
          <div class="live-actions"><span class="available-teams">${availableCount} Team${availableCount === 1 ? '' : 's'} spielfrei</span><button class="primary" id="nextRoundBtn" ${!canCreatePairings ? 'disabled' : ''}>${latestRound ? 'Paarungen ergänzen' : 'Erste Runde erstellen'} <span>→</span></button></div>
        </div>

        ${roundsHtml}
      </section>

      <section class="tab-panel ${activeTab === 'teams' ? 'active' : ''}" id="panel-teams">
        <div class="section-heading">
          <div><span class="eyebrow">Teilnehmer</span><h2>Teams verwalten</h2></div>
          ${!state.rounds.length ? `<button class="primary" id="addTeamBtn">+ Team hinzufügen</button>` : ''}
        </div>
        <div class="setup-grid">
          <div class="card"><label for="courtsInput">Anzahl Plätze</label><input id="courtsInput" type="number" min="1" max="100" value="${state.courts}" ${state.rounds.length ? 'disabled' : ''}></div>
          <div class="card"><label>Teams gesamt</label><strong class="big-number">${state.teams.length}</strong></div>
        </div>
        <div class="team-list">
          ${state.teams.map((team, index) => `<div class="team-row"><span class="team-index">${String(index + 1).padStart(2, '0')}</span><input class="team-input" data-team="${team.id}" value="${escapeHtml(team.name)}" ${state.rounds.length ? 'disabled' : ''}><button class="remove-team" data-remove="${team.id}" ${state.rounds.length ? 'disabled' : ''} title="Team entfernen">×</button></div>`).join('')}
        </div>
      </section>

      <section class="tab-panel" id="panel-tabelle">
        <div class="section-heading"><div><span class="eyebrow">Aktueller Stand</span><h2>Turniertabelle</h2></div></div>
        <div class="table-wrap">
          <table><thead><tr><th>#</th><th>Team</th><th>Punkte</th><th>Spielpunkte</th><th>Siege</th><th>Remis</th><th>Niederlagen</th><th>Buchholz</th></tr></thead>
          <tbody>${table.map((row, index) => `<tr><td><span class="rank ${index === 0 ? 'gold' : ''}">${index + 1}</span></td><td class="table-team">${escapeHtml(row.name)}</td><td class="points">${formatPoints(row.points)}</td><td class="game-points">${row.gamePoints}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${formatPoints(row.buchholz)}</td></tr>`).join('')}</tbody></table>
        </div>
      </section>
    </main>
  `

  bindEvents()
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      button.classList.add('active')
      activeTab = button.dataset.tab || 'turnier'
      document.querySelector(`#panel-${activeTab}`)?.classList.add('active')
    })
  })

  document.querySelector('#titleInput')?.addEventListener('input', event => {
    state.title = (event.target as HTMLInputElement).value
    save()
  })
  document.querySelector('#courtsInput')?.addEventListener('change', event => {
    state.courts = Math.max(1, Number((event.target as HTMLInputElement).value) || 1)
    save()
    render()
  })
  document.querySelector('#addTeamBtn')?.addEventListener('click', addTeam)
  document.querySelectorAll<HTMLInputElement>('.team-input').forEach(input => {
    input.addEventListener('input', () => {
      const team = getTeam(input.dataset.team!)
      if (team) { team.name = input.value || 'Team'; save() }
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => {
    button.addEventListener('click', () => removeTeam(button.dataset.remove!))
  })
  document.querySelector('#nextRoundBtn')?.addEventListener('click', generateRound)
  document.querySelectorAll<HTMLButtonElement>('[data-result]').forEach(button => {
    button.addEventListener('click', () => setResult(Number(button.dataset.round), Number(button.dataset.pairing), button.dataset.result as Pairing['result']))
  })
  document.querySelectorAll<HTMLSelectElement>('.court-select').forEach(select => {
    select.addEventListener('change', () => setCourt(Number(select.dataset.round), Number(select.dataset.pairing), Number(select.value)))
  })
  document.querySelectorAll<HTMLInputElement>('.score-input').forEach(input => {
    input.addEventListener('input', () => setScore(Number(input.dataset.round), Number(input.dataset.pairing), input.dataset.score as 'a' | 'b', input.value))
    input.addEventListener('change', () => setScore(Number(input.dataset.round), Number(input.dataset.pairing), input.dataset.score as 'a' | 'b', input.value))
  })
  document.querySelector('#exportBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${state.title || 'turnier'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  })
  document.querySelector('#importBtn')?.addEventListener('click', () => (document.querySelector('#importFile') as HTMLInputElement).click())
  document.querySelector('#importFile')?.addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as Tournament
      if (!Array.isArray(imported.teams) || !Array.isArray(imported.rounds)) throw new Error('Ungültiges Format')
      state = imported
      save()
      render()
    } catch { alert('Die Datei konnte nicht importiert werden.') }
  })
  document.querySelector('#resetBtn')?.addEventListener('click', () => {
    if (!confirm('Möchtest du das komplette Turnier zurücksetzen?')) return
    state = { title: 'Pickleball Turnier', courts: 4, teams: [], rounds: [] }
    save()
    render()
  })
}

render()
