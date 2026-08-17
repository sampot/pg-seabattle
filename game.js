export const BOARD_SIZE = 10;
export const FLEET = [
  { name: "航空母艦", size: 5 },
  { name: "戰艦", size: 4 },
  { name: "巡洋艦", size: 3 },
  { name: "潛水艇", size: 3 },
  { name: "巡邏艇", size: 2 },
];

export function createBoard() {
  return {
    cells: Array(BOARD_SIZE * BOARD_SIZE).fill(0),
    shots: Array(BOARD_SIZE * BOARD_SIZE).fill(false),
    ships: [],
  };
}

const idx = (row, col) => row * BOARD_SIZE + col;
const inBounds = (row, col) =>
  row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

export function placeShip(board, row, col, shipType, vertical = false) {
  const type =
    typeof shipType === "number"
      ? { name: `船艦 ${board.ships.length + 1}`, size: shipType }
      : shipType;
  const cells = [];
  for (let offset = 0; offset < type.size; offset += 1) {
    const rr = row + (vertical ? offset : 0);
    const cc = col + (vertical ? 0 : offset);
    if (!inBounds(rr, cc) || board.cells[idx(rr, cc)]) return false;
    cells.push(idx(rr, cc));
  }
  const id = board.ships.length + 1;
  cells.forEach((cellIndex) => {
    board.cells[cellIndex] = id;
  });
  board.ships.push({
    id,
    name: type.name,
    size: type.size,
    cells,
    hits: 0,
    sunk: false,
    vertical,
    start: { row, col },
  });
  return true;
}

export function autoPlace(board, rng = Math.random) {
  for (const ship of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt += 1) {
      placed = placeShip(
        board,
        Math.floor(rng() * BOARD_SIZE),
        Math.floor(rng() * BOARD_SIZE),
        ship,
        rng() > 0.5,
      );
    }
    if (!placed) {
      for (let row = 0; row < BOARD_SIZE && !placed; row += 1) {
        for (let col = 0; col < BOARD_SIZE && !placed; col += 1) {
          for (const vertical of [false, true]) {
            if (placeShip(board, row, col, ship, vertical)) {
              placed = true;
              break;
            }
          }
        }
      }
    }
  }
  return board;
}

export function shoot(board, row, col) {
  if (!inBounds(row, col)) return { result: "invalid" };
  const cellIndex = idx(row, col);
  if (board.shots[cellIndex]) return { result: "repeat" };
  board.shots[cellIndex] = true;
  const id = board.cells[cellIndex];
  if (!id) return { result: "miss" };
  const ship = board.ships.find((candidate) => candidate.id === id);
  ship.hits += 1;
  ship.sunk = ship.hits === ship.size;
  return { result: ship.sunk ? "sunk" : "hit", ship };
}

export function remainingShips(board) {
  return board.ships.filter((ship) => !ship.sunk).length;
}

/** Fleet list label for one slot (player or fogged enemy). */
export function fleetEntryState(ship, { hideUnhit = false } = {}) {
  if (!ship) return "待部署";
  if (ship.sunk) return "沉沒";
  if (hideUnhit) return "偵測中";
  return "航行中";
}

export function allSunk(board) {
  return board.ships.length > 0 && remainingShips(board) === 0;
}

function openCell(board, row, col) {
  return inBounds(row, col) && !board.shots[idx(row, col)];
}

function targetCandidates(board) {
  for (const ship of board.ships.filter((candidate) => !candidate.sunk)) {
    const hits = ship.cells
      .filter((cellIndex) => board.shots[cellIndex])
      .map((cellIndex) => ({
        row: Math.floor(cellIndex / BOARD_SIZE),
        col: cellIndex % BOARD_SIZE,
      }));
    if (!hits.length) continue;

    if (hits.length > 1) {
      const rows = hits.map((hit) => hit.row);
      const cols = hits.map((hit) => hit.col);
      if (new Set(rows).size === 1) {
        const row = rows[0];
        const min = Math.min(...cols);
        const max = Math.max(...cols);
        return [
          { row, col: max + 1 },
          { row, col: min - 1 },
        ].filter((cell) => openCell(board, cell.row, cell.col));
      }
      const col = cols[0];
      const min = Math.min(...rows);
      const max = Math.max(...rows);
      return [
        { row: max + 1, col },
        { row: min - 1, col },
      ].filter((cell) => openCell(board, cell.row, cell.col));
    }

    const [{ row, col }] = hits;
    return [
      { row: row - 1, col },
      { row: row + 1, col },
      { row, col: col - 1 },
      { row, col: col + 1 },
    ].filter((cell) => openCell(board, cell.row, cell.col));
  }
  return [];
}

export function chooseComputerShot(board, rng = Math.random) {
  const targets = targetCandidates(board);
  if (targets.length) {
    return targets[Math.floor(rng() * targets.length)];
  }

  const checkerboard = [];
  const remainder = [];
  board.shots.forEach((wasShot, cellIndex) => {
    if (wasShot) return;
    const row = Math.floor(cellIndex / BOARD_SIZE);
    const col = cellIndex % BOARD_SIZE;
    const destination = (row + col) % 2 === 0 ? checkerboard : remainder;
    destination.push({ row, col });
  });
  const open = checkerboard.length ? checkerboard : remainder;
  return open.length ? open[Math.floor(rng() * open.length)] : null;
}

export function randomShot(board, rng = Math.random) {
  const shot = chooseComputerShot(board, rng);
  return shot ? { r: shot.row, c: shot.col } : null;
}

/** One AI firing step against `board`. */
export function applyAiShot(board, rng = Math.random) {
  const target = chooseComputerShot(board, rng);
  if (!target) return { result: "none", target: null, ship: null };
  const outcome = shoot(board, target.row, target.col);
  return { ...outcome, target };
}

/**
 * Headless blue vs red AI duel.
 * `blue` shoots at `red` first; winner is the side that sinks the other.
 */
export function simulateAiDuel(rng = Math.random, options = {}) {
  const blue = autoPlace(createBoard(), rng);
  const red = autoPlace(createBoard(), rng);
  let turn = "blue";
  let shots = 0;
  const maxShots = options.maxShots ?? 400;

  while (shots < maxShots) {
    const targetBoard = turn === "blue" ? red : blue;
    const outcome = applyAiShot(targetBoard, rng);
    if (outcome.result === "none") break;
    shots += 1;
    if (allSunk(targetBoard)) {
      return { winner: turn, shots, blue, red };
    }
    turn = turn === "blue" ? "red" : "blue";
  }

  return { winner: null, shots, blue, red };
}
