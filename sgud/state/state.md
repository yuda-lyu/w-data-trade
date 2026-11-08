# 現況(w-data-trade)

> 當前已開發功能之最新狀態;只記現況,不寫過程(過程見 `sgud/exp/experience.md`).規則見 `sgud/rule/rulebook.md`.
> 基準版本:1.0.33(`package.json`);本檔所述之週期表換算為 1.0.33 之後、尚未發布之變更.

## 功能

| 功能 | 狀態 | 規則 | 測試 |
|---|---|---|---|
| 21 個 `calc*` 之內建週期表(4hr K 線基準,每日 6 根)與輸出 | 完成;未給 `barsPerDay` 時與 1.0.33 逐位相同 | R-PER-01、R-PER-02 | `unit-calc*.test.mjs`(既有)、`unit-contract.test.mjs`、`unit-calcPeriods.test.mjs` 〈恆等〉 |
| `opt.barsPerDay` 週期表換算 | 完成:先乘後除、四捨五入(.5 進位)、不足 1 根剔除、全剔除 reject | R-PER-03、R-PER-04、R-PER-05 | `unit-resolvePeriods.test.mjs`、`unit-calcPeriods.test.mjs` 〈換算〉〈1hr K線之時間語意〉〈日K線與撞根數〉 |
| `opt.kp` 自訂週期表 | 完成:直接採用不換算,優先於 `barsPerDay` | R-PER-06 | 同上 〈opt.kp 直接採用〉 |
| 非預期輸入處置與 `opt.debug` 警告 | 完成:`opt` 類參數非預期視為未給(依跨套件規格 K3);`kp` 必須參數無效 throw | R-PER-08、R-PER-09、R-PER-10 | `unit-resolvePeriods.test.mjs` 〈輸入檢核〉〈opt.debug 警告〉 |
| `resolvePeriods` 聚合匯出 | 完成(`wdt.resolvePeriods`) | R-PER-11 | `unit-calcPeriods.test.mjs` |
| `dataConvert`/`dataCalibrate` 以 `optMethod` 取得週期換算 | 不改碼;已以測試釘住透傳;限制見規則 | R-PER-12 | `unit-calcPeriods.test.mjs` 〈dataConvert / dataCalibrate 經optMethod透傳〉 |
| README 與 JSDoc | 完成 | R-PER-13 | — |

## 最近一次驗證

- 全套 `npm test`:723 通過(既有 456 + 新增 267:`unit-resolvePeriods` 與 `unit-calcPeriods`),0 失敗.
- 恆等比對:1.0.33 tarball `src` 對現行 `src`,21 calc × 8 組序列 × 23 種 opt(含既有 opt 鍵),6072 組輸出逐位相同(含 529 組兩版皆拋錯且訊息相同);未改動之 6 檔(`dataConvert`、`dataCalibrate`、`calcOrig`、`caEma`、`pickValue`、`diviProt`)逐位元組相同.
- 變異:`resolvePeriods` 改為恆等、剔除改為 `x <= 1`、四捨五入改無條件捨去、先除後乘、單根型態停用、`mult` 亦換算、`barsPerDay` 非預期改拋錯、`opt.kp` 再換算、不剔除,皆使測試轉紅;`barsPerDay` 數字字串不轉數值(JS 乘除自動轉型)為等價變異,無法以可觀察行為區分.

## 已知缺口與待辦

- 無待辦.`docs/`、`dist/` 由發布流程產製,不在本次變更內.
- 限制(已載於 README 與規則):相鄰週期換算後可能同根數(不去重);`dataConvert` 輸出檔名不含 K 線週期;`dataCalibrate` 須以 `opt.params` 排除 `barsPerDay`.
- 既有、未處理:`calcMacd` 資料無效分支與 `dataConvert` 錯誤分支之除錯 `console.log`.
