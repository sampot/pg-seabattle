import { describe, expect, it } from "vitest";
import {
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
  simulateAiDuel,
} from "./game.js";

describe("海戰佈艦", () => {
  it("提供五艘有名稱與長度的艦隊", () => {
    expect(FLEET.map((ship) => ship.size)).toEqual([5, 4, 3, 3, 2]);
    expect(new Set(FLEET.map((ship) => ship.name)).size).toBe(5);
  });

  it("船不能越界或重疊", () => {
    const board = createBoard();

    expect(placeShip(board, 0, 8, FLEET[1], false)).toBe(false);
    expect(placeShip(board, 0, 0, FLEET[1], false)).toBe(true);
    expect(placeShip(board, 0, 0, FLEET[2], true)).toBe(false);
    expect(board.ships[0]).toMatchObject({
      name: "戰艦",
      size: 4,
      vertical: false,
      start: { row: 0, col: 0 },
    });
  });

  it("自動佈艦即使遇到固定亂數仍會放完整艦隊", () => {
    const board = createBoard();

    autoPlace(board, () => 0.37);

    expect(board.ships).toHaveLength(FLEET.length);
    expect(board.ships.flatMap((ship) => ship.cells)).toHaveLength(17);
    expect(new Set(board.ships.flatMap((ship) => ship.cells)).size).toBe(17);
  });

  it("命中、擊沉、重複射擊與勝利都可辨識", () => {
    const board = createBoard();
    placeShip(board, 1, 1, { name: "巡邏艇", size: 2 }, false);

    expect(shoot(board, -1, 0).result).toBe("invalid");
    expect(shoot(board, 1, 1).result).toBe("hit");
    expect(shoot(board, 1, 1).result).toBe("repeat");
    expect(shoot(board, 9, 9).result).toBe("miss");
    expect(shoot(board, 1, 2)).toMatchObject({
      result: "sunk",
      ship: { name: "巡邏艇" },
    });
    expect(allSunk(board)).toBe(true);
    expect(remainingShips(board)).toBe(0);
  });

  it("電腦命中後優先攻擊相鄰格且不重複射擊", () => {
    const board = createBoard();
    placeShip(board, 4, 4, { name: "巡洋艦", size: 3 }, false);
    shoot(board, 4, 4);
    shoot(board, 3, 4);
    shoot(board, 5, 4);
    shoot(board, 4, 3);

    expect(chooseComputerShot(board, () => 0)).toEqual({ row: 4, col: 5 });

    shoot(board, 4, 5);
    const next = chooseComputerShot(board, () => 0);
    expect(board.shots[next.row * 10 + next.col]).toBe(false);
    expect(next).toEqual({ row: 4, col: 6 });
  });

  it("艦隊清單在未放置／航行／沉沒／迷霧狀態有正確文案", () => {
    expect(fleetEntryState(null)).toBe("待部署");
    expect(fleetEntryState({ sunk: false }, { hideUnhit: true })).toBe("偵測中");
    expect(fleetEntryState({ sunk: false })).toBe("航行中");
    expect(fleetEntryState({ sunk: true })).toBe("沉沒");
  });

  it("AI 單步射擊會標記目標並回傳結果", () => {
    const board = createBoard();
    placeShip(board, 9, 8, { name: "巡邏艇", size: 2 }, false);

    const miss = applyAiShot(board, () => 0);
    expect(miss).toMatchObject({
      result: "miss",
      target: { row: 0, col: 0 },
    });
    expect(board.shots[0]).toBe(true);

    const huntBoard = createBoard();
    placeShip(huntBoard, 4, 4, { name: "巡洋艦", size: 3 }, false);
    shoot(huntBoard, 4, 4);
    const hit = applyAiShot(huntBoard, () => 0.99);
    expect(hit).toMatchObject({
      result: "hit",
      target: { row: 4, col: 5 },
    });
  });

  it("AI 對 AI 模擬會自動布艦並分出勝負", () => {
    let seed = 17;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const match = simulateAiDuel(rng);
    expect(match.winner).toMatch(/^(blue|red)$/);
    expect(match.shots).toBeGreaterThan(10);
    expect(match.blue.ships).toHaveLength(FLEET.length);
    expect(match.red.ships).toHaveLength(FLEET.length);
    expect(allSunk(match.winner === "blue" ? match.red : match.blue)).toBe(
      true,
    );
    expect(allSunk(match.winner === "blue" ? match.blue : match.red)).toBe(
      false,
    );
  });
});