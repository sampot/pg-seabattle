# 海戰佈艦（pg-seabattle）

在 10×10 海域部署五艘船艦。支援人機對戰，或觀看藍軍／紅軍雙 AI 自動交火。

## 執行

遊戲僅使用 HTML、CSS 與 JavaScript，無需安裝或建置。正式執行環境由 Playgrounds 注入 `window.PG`。

```sh
npx --yes vitest run
```

一鍵開啟：https://play.samkuo.me/?open=sampot%2Fpg-seabattle

## 玩法

- **人機對戰：** 手動或自動布艦後點敵方海域開火；電腦命中後會追擊鄰近格。
- **AI 對 AI：** 雙方自動布艦並輪流交火，艦影皆可見；可暫停／繼續。觀戰勝負不計入最佳砲數。
- 最佳勝利砲數透過 `PG.kv` 的 `best-shots-v2` 儲存；同步失敗仍可繼續遊玩。
- 分頁進入背景時會暫停電腦回合與合成音效。

素材授權與來源見 [ATTRIBUTION.md](./ATTRIBUTION.md)。
