export const FLEET = [5, 4, 3, 3, 2];

export function createBoard() {
  return { cells: Array(100).fill(0), shots: Array(100).fill(false), ships: [] };
}

const idx = (r, c) => r * 10 + c;

export function placeShip(b, r, c, size, vertical = false) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const rr = r + (vertical ? i : 0);
    const cc = c + (vertical ? 0 : i);
    if (rr > 9 || cc > 9 || b.cells[idx(rr, cc)]) return false;
    cells.push(idx(rr, cc));
  }
  const id = b.ships.length + 1;
  cells.forEach((i) => {
    b.cells[i] = id;
  });
  b.ships.push({ id, size, cells, hits: 0, sunk: false });
  return true;
}

export function autoPlace(b, rng = Math.random) {
  for (const size of FLEET) {
    let placed = false;
    for (let n = 0; n < 200 && !placed; n++) {
      placed = placeShip(
        b,
        Math.floor(rng() * 10),
        Math.floor(rng() * 10),
        size,
        rng() > 0.5,
      );
    }
    if (!placed) {
      for (let r = 0; r < 10 && !placed; r++) {
        for (let c = 0; c < 10 && !placed; c++) {
          for (const vertical of [false, true]) {
            if (placeShip(b, r, c, size, vertical)) {
              placed = true;
              break;
            }
          }
        }
      }
    }
  }
  return b;
}

export function shoot(b, r, c) {
  const i = idx(r, c);
  if (b.shots[i]) return { result: "repeat" };
  b.shots[i] = true;
  const id = b.cells[i];
  if (!id) return { result: "miss" };
  const ship = b.ships.find((s) => s.id === id);
  ship.hits++;
  ship.sunk = ship.hits === ship.size;
  return { result: ship.sunk ? "sunk" : "hit", ship };
}

export function allSunk(b) {
  return b.ships.length > 0 && b.ships.every((s) => s.sunk);
}

export function randomShot(b, rng = Math.random) {
  const open = b.shots.map((v, i) => (!v ? i : -1)).filter((i) => i >= 0);
  const i = open[Math.floor(rng() * open.length)];
  return i == null ? null : { r: Math.floor(i / 10), c: i % 10 };
}
