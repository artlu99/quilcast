// ogre mode: five taps in a row on the big pfp on /u/borodutch turn the app into a swamp (the looks live in style.css under [data-ogre])
export const OGRE_FID = 1356
const KEY = 'quilcast:ogre'
const root = document.documentElement
const on = () => 'ogre' in root.dataset
const set = (v: boolean) => (v ? (root.dataset.ogre = '') : delete root.dataset.ogre)
try {
  set(localStorage.getItem(KEY) === '1')
} catch {}

let taps = 0
let timer = 0

/** Count a tap on the pfp. Taps more than half a second apart start over. */
export function ogreTap(el: Element) {
  clearTimeout(timer)
  const left = 5 - ++taps
  hit(el, left ? String(left) : on() ? 'ogre mode off' : 'OGRE MODE!')
  if (!left) {
    taps = 0
    set(!on())
    try {
      localStorage.setItem(KEY, on() ? '1' : '')
    } catch {}
    return
  }
  timer = setTimeout(() => (taps = 0), 500)
}

// a number that floats up off the pfp and fades, like damage over a mob in a game
function hit(el: Element, text: string) {
  const r = el.getBoundingClientRect()
  const s = document.createElement('span')
  s.className = 'hit'
  s.textContent = text
  s.style.left = `${r.left + r.width / 2 + Math.random() * 24 - 12}px`
  s.style.top = `${r.top}px`
  s.onanimationend = () => s.remove()
  document.body.append(s)
}
