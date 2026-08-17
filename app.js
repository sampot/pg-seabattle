import {
  BOARD_SIZE,
  FLEET,
  allSunk,
  applyAiShot,
  autoPlace,
  chooseComputerShot,
  createBoard,
  fleetEntryState,
  placeShip,
  remainingShips,
  shoot,
} from "./game.js";

const $ = (id) => document.getElementById(id);
const BEST_KEY = "best-shots-v2";
const AI_STEP_MS = 420;
const platform = window.PG ?? {
  ready: Promise.resolve(),
  kv: {
    get: async () => null,
    put: async () => {},
  },
};

/** @type {"human" | "spectate"} */
let playMode = "human";
let playerBoard;
let enemyBoard;
let placingIndex;
let vertical;
let phase;
let turn;
let shots;
let bestShots = null;
let computerTimer = null;
let suspended = false;
let spectatePaused = false;
let muted = false;
let audioContext = null;

function setStatus(message, tone = "") {
  $("status").textContent = message;
  $("status").dataset.tone = tone;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function tone(frequency, duration, type = "sine", delay = 0) {
  if (muted) return;
  try {
    audioContext ??= new AudioContext();
    const start = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.13, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  } catch {
    // Audio is an enhancement; gameplay remains available when blocked.
  }
}

function playResult(result) {
  if (result === "miss") {
    tone(180, 0.16, "sine");
  } else if (result === "hit") {
    tone(110, 0.12, "square");
    tone(80, 0.2, "sawtooth", 0.08);
  } else if (result === "sunk") {
    tone(150, 0.13, "square");
    tone(95, 0.22, "sawtooth", 0.1);
    tone(55, 0.35, "sawtooth", 0.23);
  }
}

function clearTimer() {
  window.clearTimeout(computerTimer);
  computerTimer = null;
}

function coordinateLabel(row, col) {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function sideLabel(side) {
  if (playMode === "spectate") return side === "player" ? "藍軍" : "紅軍";
  return side === "player" ? "我方" : "敵軍";
}

function cellLabel(board, index, revealShips) {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const shipId = board.cells[index];
  const wasShot = board.shots[index];
  const ship = board.ships.find((candidate) => candidate.id === shipId);
  let state = "未知海域";
  if (wasShot) state = shipId ? "命中" : "未命中";
  else if (revealShips && ship) state = ship.name;
  return `${coordinateLabel(row, col)}，${state}`;
}

function createCell(board, index, revealShips, interactive) {
  const button = document.createElement("button");
  const shipId = board.cells[index];
  const wasShot = board.shots[index];
  const ship = board.ships.find((candidate) => candidate.id === shipId);
  button.type = "button";
  button.className = "cell";
  button.dataset.index = String(index);
  button.setAttribute("aria-label", cellLabel(board, index, revealShips));
  button.disabled = !interactive || wasShot;

  if (revealShips && shipId && !wasShot) {
    button.classList.add("ship");
  }
  if (wasShot && shipId) {
    button.classList.add("hit");
    button.innerHTML = `<span aria-hidden="true">✦</span>`;
  } else if (wasShot) {
    button.classList.add("miss");
    button.innerHTML = `<span aria-hidden="true">·</span>`;
  }
  if (ship?.sunk) button.classList.add("sunk");
  return button;
}

function addShipTokens(grid, board) {
  for (const ship of board.ships) {
    const token = document.createElement("div");
    token.className = `ship-token ${ship.vertical ? "vertical" : "horizontal"}${ship.sunk ? " is-sunk" : ""}`;
    token.style.setProperty("--row", ship.start.row);
    token.style.setProperty("--col", ship.start.col);
    token.style.setProperty("--length", ship.size);
    token.innerHTML = `<span class="ship-bow"></span><span class="ship-deck"></span><span class="ship-tower"></span>`;
    token.setAttribute("aria-hidden", "true");
    grid.append(token);
  }
}

function renderGrid(element, board, revealShips, interactive) {
  element.replaceChildren();
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
    element.append(createCell(board, index, revealShips, interactive));
  }
  if (revealShips) addShipTokens(element, board);
}

function fleetMarkup(board, hideUnhit) {
  return FLEET.map((type, index) => {
    const ship = board.ships[index];
    const sunk = ship?.sunk;
    const state = fleetEntryState(ship, { hideUnhit });
    return `<li class="${sunk ? "fleet-sunk" : ""}">
      <span class="fleet-shape" style="--length:${type.size}" aria-hidden="true"></span>
      <span>${type.name}</span><small>${state}</small>
    </li>`;
  }).join("");
}

function turnCaption() {
  if (phase === "over") return "戰役結束";
  if (playMode === "spectate") {
    if (spectatePaused) return "觀戰暫停";
    return turn === "player" ? "藍軍開火" : "紅軍開火";
  }
  return turn === "computer" ? "敵軍回合" : "你的回合";
}

function render() {
  const revealEnemy = playMode === "spectate";
  const canPlace = playMode === "human" && phase === "place";
  const canFire =
    playMode === "human" &&
    phase === "battle" &&
    turn === "player" &&
    !suspended;

  $("seas").classList.toggle("battle-mode", phase !== "place");
  $("seas").classList.toggle("spectate-mode", playMode === "spectate");
  $("mode-human").classList.toggle("is-active", playMode === "human");
  $("mode-ai").classList.toggle("is-active", playMode === "spectate");
  $("mode-human").setAttribute("aria-pressed", String(playMode === "human"));
  $("mode-ai").setAttribute("aria-pressed", String(playMode === "spectate"));

  renderGrid($("player-grid"), playerBoard, true, canPlace);
  renderGrid($("enemy-grid"), enemyBoard, revealEnemy, canFire);
  $("player-fleet").innerHTML = fleetMarkup(playerBoard, false);
  $("enemy-fleet").innerHTML = fleetMarkup(enemyBoard, !revealEnemy);

  $("player-title").textContent =
    playMode === "spectate" ? "藍軍海域" : "我方海域";
  $("enemy-title").textContent =
    playMode === "spectate" ? "紅軍海域" : "敵方海域";
  $("player-grid").setAttribute(
    "aria-label",
    playMode === "spectate" ? "藍軍海域" : "我方海域",
  );
  $("enemy-grid").setAttribute(
    "aria-label",
    playMode === "spectate" ? "紅軍海域" : "敵方海域",
  );

  const nextShip = FLEET[placingIndex];
  $("setup-panel").hidden = !(playMode === "human" && phase === "place");
  $("spectate-setup").hidden = !(playMode === "spectate" && phase === "place");
  $("battle-panel").hidden = phase === "place";
  $("placing").textContent = nextShip
    ? `待部署：${nextShip.name}（${nextShip.size} 格）`
    : "艦隊已部署";
  $("rotate").textContent = `方向：${vertical ? "直向" : "橫向"}`;
  $("battle-heading").textContent =
    playMode === "spectate"
      ? spectatePaused
        ? "觀戰已暫停"
        : "雙 AI 自動交火中"
      : "點選敵方海域發射砲彈";
  $("pause-spectate").hidden = playMode !== "spectate" || phase !== "battle";
  $("pause-spectate").textContent = spectatePaused ? "繼續觀戰" : "暫停觀戰";
  $("turn").textContent = turnCaption();
  $("shots").textContent = String(shots);
  $("best").textContent = bestShots == null ? "—" : String(bestShots);
  $("player-remaining").textContent = String(remainingShips(playerBoard));
  $("enemy-remaining").textContent = String(remainingShips(enemyBoard));
  $("mute").textContent = muted ? "開啟音效" : "關閉音效";
}

function scheduleAiStep() {
  clearTimer();
  if (suspended || spectatePaused || phase !== "battle") return;
  computerTimer = window.setTimeout(runAiStep, AI_STEP_MS);
}

function finishMatch(winner) {
  phase = "over";
  turn = "none";
  clearTimer();
  if (playMode === "spectate") {
    const label = winner === "player" ? "藍軍" : "紅軍";
    setStatus(`${label}獲勝！共發射 ${shots} 砲。`, "win");
    tone(392, 0.16, "triangle");
    tone(523, 0.2, "triangle", 0.16);
    tone(659, 0.35, "triangle", 0.34);
    render();
    return;
  }
  if (winner === "player") {
    setStatus(`勝利！你用 ${shots} 發砲彈擊沉敵方艦隊。`, "win");
    tone(392, 0.16, "triangle");
    tone(523, 0.2, "triangle", 0.16);
    tone(659, 0.35, "triangle", 0.34);
    void recordWin();
  } else {
    setStatus("我方艦隊全數沉沒。整補艦隊，再戰一局！", "loss");
    tone(130, 0.2, "sawtooth");
    tone(82, 0.45, "sawtooth", 0.2);
  }
  render();
}

function runAiStep() {
  computerTimer = null;
  if (phase !== "battle") return;
  if (suspended || spectatePaused) return;

  if (playMode === "spectate") {
    const shooter = turn === "player" ? "player" : "enemy";
    const targetBoard = turn === "player" ? enemyBoard : playerBoard;
    const outcome = applyAiShot(targetBoard);
    if (outcome.result === "none") {
      finishMatch(turn === "player" ? "enemy" : "player");
      return;
    }
    shots += 1;
    playResult(outcome.result);
    const where = coordinateLabel(outcome.target.row, outcome.target.col);
    const detail =
      outcome.result === "miss"
        ? "落空"
        : outcome.result === "sunk"
          ? `擊沉${outcome.ship.name}`
          : "命中";
    if (allSunk(targetBoard)) {
      setStatus(
        `${sideLabel(shooter)}砲擊 ${where}：${detail}。${sideLabel(shooter)}獲勝！`,
        "win",
      );
      finishMatch(shooter);
      return;
    }
    turn = turn === "player" ? "enemy" : "player";
    setStatus(
      `${sideLabel(shooter)}砲擊 ${where}：${detail}。${sideLabel(turn)}接戰。`,
      outcome.result,
    );
    render();
    scheduleAiStep();
    return;
  }

  // Human vs AI — computer replies against the player board.
  const target = chooseComputerShot(playerBoard);
  if (!target) {
    turn = "player";
    setStatus("敵軍無法射擊，輪到你了。", "ready");
    render();
    return;
  }
  const result = shoot(playerBoard, target.row, target.col);
  playResult(result.result);
  if (allSunk(playerBoard)) {
    finishMatch("enemy");
    return;
  }
  turn = "player";
  const detail =
    result.result === "miss"
      ? "落空"
      : result.result === "sunk"
        ? `擊沉我方${result.ship.name}`
        : "命中我方船艦";
  setStatus(
    `敵軍砲擊 ${coordinateLabel(target.row, target.col)}：${detail}。輪到你了。`,
    result.result,
  );
  render();
}

function beginHumanBattle(message) {
  placingIndex = FLEET.length;
  phase = "battle";
  turn = "player";
  spectatePaused = false;
  setStatus(message, "ready");
  render();
  const enemySea = $("enemy-grid").closest(".sea-card") ?? $("enemy-grid");
  enemySea.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("enemy-grid").focus({ preventScroll: true });
}

function beginSpectateBattle() {
  clearTimer();
  playerBoard = createBoard();
  enemyBoard = createBoard();
  autoPlace(playerBoard);
  autoPlace(enemyBoard);
  placingIndex = FLEET.length;
  phase = "battle";
  turn = "player";
  shots = 0;
  spectatePaused = false;
  setStatus("雙 AI 已布艦。藍軍先開火。", "ready");
  render();
  scheduleAiStep();
}

function reset() {
  clearTimer();
  playerBoard = createBoard();
  enemyBoard = createBoard();
  placingIndex = 0;
  vertical = false;
  phase = "place";
  turn = "player";
  shots = 0;
  spectatePaused = false;

  if (playMode === "spectate") {
    setStatus("選擇「開始觀戰」觀看藍軍與紅軍自動交火。", "ready");
    render();
    return;
  }

  autoPlace(enemyBoard);
  setStatus("部署五艘船艦，或使用自動布艦。", "ready");
  render();
}

function setPlayMode(nextMode) {
  if (playMode === nextMode && phase === "place") return;
  playMode = nextMode;
  reset();
}

function placeAt(index) {
  if (playMode !== "human" || phase !== "place") return;
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const ship = FLEET[placingIndex];
  if (!placeShip(playerBoard, row, col, ship, vertical)) {
    setStatus("放不下這艘船，請換一格或旋轉方向。", "warning");
    tone(120, 0.12, "square");
    return;
  }
  tone(360 + placingIndex * 45, 0.1, "triangle");
  placingIndex += 1;
  if (placingIndex === FLEET.length) {
    beginHumanBattle("艦隊就位。選擇敵方海域開火！");
    return;
  }
  setStatus(`${ship.name}部署完成。`, "ready");
  render();
}

async function recordWin() {
  if (bestShots != null && shots >= bestShots) return;
  bestShots = shots;
  render();
  try {
    await platform.kv.put(BEST_KEY, String(bestShots));
  } catch {
    showToast("最佳紀錄同步失敗，本局仍已完成。");
  }
}

function fireAt(index) {
  if (playMode !== "human") return;
  if (phase !== "battle" || turn !== "player" || suspended) return;
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const result = shoot(enemyBoard, row, col);
  if (result.result === "repeat" || result.result === "invalid") return;
  shots += 1;
  playResult(result.result);
  if (allSunk(enemyBoard)) {
    finishMatch("player");
    return;
  }

  turn = "computer";
  const detail =
    result.result === "miss"
      ? "落空。"
      : result.result === "sunk"
        ? `擊沉${result.ship.name}！`
        : "命中！";
  setStatus(
    `${coordinateLabel(row, col)} ${detail} 敵軍正在瞄準…`,
    result.result,
  );
  render();
  computerTimer = window.setTimeout(runAiStep, AI_STEP_MS);
}

function gridPointer(event) {
  const cell = event.target.closest(".cell");
  if (!cell || cell.disabled) return;
  const index = Number(cell.dataset.index);
  if (event.currentTarget.id === "player-grid") placeAt(index);
  else fireAt(index);
}

function suspend() {
  suspended = true;
  clearTimer();
  if (audioContext?.state === "running") void audioContext.suspend();
  render();
}

function resume() {
  if (!suspended) return;
  suspended = false;
  if (audioContext?.state === "suspended") void audioContext.resume();
  if (phase === "battle" && !computerTimer) {
    if (playMode === "spectate" && !spectatePaused) scheduleAiStep();
    else if (playMode === "human" && turn === "computer") {
      computerTimer = window.setTimeout(runAiStep, 300);
    }
  }
  render();
}

$("player-grid").addEventListener("pointerup", gridPointer);
$("enemy-grid").addEventListener("pointerup", gridPointer);
$("mode-human").addEventListener("pointerup", () => setPlayMode("human"));
$("mode-ai").addEventListener("pointerup", () => setPlayMode("spectate"));
$("rotate").addEventListener("pointerup", () => {
  vertical = !vertical;
  tone(300, 0.08, "triangle");
  render();
});
$("auto").addEventListener("pointerup", () => {
  if (playMode !== "human" || phase !== "place") return;
  playerBoard = createBoard();
  autoPlace(playerBoard);
  tone(420, 0.1, "triangle");
  tone(560, 0.14, "triangle", 0.1);
  beginHumanBattle("自動布艦完成。灰色艦影就是你的五艘船，向敵方開火！");
});
$("start-spectate").addEventListener("pointerup", () => {
  if (playMode !== "spectate") return;
  tone(420, 0.1, "triangle");
  beginSpectateBattle();
});
$("pause-spectate").addEventListener("pointerup", () => {
  if (playMode !== "spectate" || phase !== "battle") return;
  spectatePaused = !spectatePaused;
  if (spectatePaused) {
    clearTimer();
    setStatus("觀戰已暫停。", "ready");
  } else {
    setStatus(`${sideLabel(turn)}繼續交火。`, "ready");
    scheduleAiStep();
  }
  render();
});
$("new").addEventListener("pointerup", reset);
$("new-battle").addEventListener("pointerup", reset);
$("mute").addEventListener("pointerup", () => {
  muted = !muted;
  render();
  if (!muted) tone(440, 0.12, "triangle");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") suspend();
  else resume();
});
window.addEventListener("pagehide", suspend);
window.addEventListener("pageshow", resume);

await platform.ready;
try {
  const saved = Number(await platform.kv.get(BEST_KEY));
  if (Number.isFinite(saved) && saved > 0) bestShots = saved;
} catch {
  showToast("無法讀取最佳紀錄，仍可正常遊玩。");
}
reset();
