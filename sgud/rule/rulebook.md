# 規則帳本(w-data-trade)

> **藍圖**:以規則為單位記程式碼須長成什麼樣,附盤點指令、站點全集與對應測試.現況見 `sgud/state/state.md`,累積經驗見 `sgud/exp/experience.md`.
> 本套件僅有 unit 測試(`test/unit-*.test.mjs`),全跑約 2 秒;無 e2e,故無〈改動範圍 → e2e 檔〉對照表.

## 索引

| 類 | 條號 | 節 |
|---|---|---|
| 週期表換算(`opt.barsPerDay`、`opt.kp`) | R-PER-01～R-PER-13 | §1 |

## 1. 週期表換算(使用端需求,Gitea #104)

**定位**:各 `calc*`(`calcOrig` 除外,共 21 個)之內建週期表 `KP` 以 4hr K 線寫死(每日 6 根),週期標籤為時間語意(`'1day'`、`'12hr'`…),值為根數.`resolvePeriods(kp, opt)`(`src/resolvePeriods.mjs`)依 `opt.barsPerDay` 或 `opt.kp` 取得實際週期表,使同一組標籤與參數可用於其他 K 線週期.

| 條號 | 規則 | 盤點與站點 | 測試 |
|---|---|---|---|
| R-PER-01 | 各 calc 內建表寫成模組內 `let KP = {…}`(內容與鍵序同 1.0.33,不得改動),`caXs(arr\|vs, opt = {})` 首行 `let kp = resolvePeriods(KP, opt)`,其後一律迭代 `kp`.新增有週期表之 calc 依此寫法 | `Grep "resolvePeriods\(KP, opt\)" src` 須 21 站;`Grep "^    let kp = \{" src`(行首四空白,排除 JSDoc 範例)須 0 站;21 站名單見 `test/unit-calcPeriods.test.mjs` 之 `SNAP` | `unit-calcPeriods` 〈恆等〉21 案 |
| R-PER-02 | **恆等**:`opt.barsPerDay` 未給、為 6(數值或數字字串)或為非預期之值,以及 `opt.kp` 未給或非預期時,輸出須與 1.0.33 逐位相同(`JSON.stringify` 相等,錯誤訊息亦同).`calcOrig`、`dataConvert`、`dataCalibrate`、`caEma`、`pickValue`、`diviProt` 程式碼不動 | 證據腳本:取 1.0.33 tarball 解包後之 `src`,對 21 個 calc × 8 組合成序列 × 23 種 opt(含各 calc 既有 opt 鍵)逐一比對 | `unit-calcPeriods` 〈恆等〉(以 1.0.33 輸出之 sha256 快照釘住);快照不得以現行程式碼重產 |
| R-PER-03 | **換算**:各期根數 = `(v × barsPerDay) ÷ 6`(先乘後除,避免浮點誤差使 .5 邊界誤捨去),四捨五入(.5 進位);換算前不足 1 根(`< 1`,恰為 1 保留)之期剔除.全部剔除時 reject(訊息 `invalid opt.barsPerDay: must keep at least one period of at least 1 bar`,不含傳入之值) | `src/resolvePeriods.mjs` 之 `scale`、`x < 1` | `unit-resolvePeriods` 〈等比換算與四捨五入〉〈剔除與全剔除〉;`unit-calcPeriods` 〈換算〉(21 calc × 7 種每日根數,另 `calcMa`、`calcMacd` 手算對照)、〈全部週期皆不足1根〉 |
| R-PER-04 | **參數物件**:只換算 `SCALE_KEYS`(`len`、`tenkan`、`kijun`、`senkouB`),其餘欄位(如 `mult`)原樣;任一根數欄不足 1 根即剔除該期.輸出之 `len`:`calcKeltner`、`calcSupertrend` 為 `len`,`calcIchimoku` 為 `senkouB` | 內建參數表:`calcKeltner`、`calcSupertrend`(`{len, mult}`)、`calcIchimoku`(`{tenkan, kijun, senkouB}`) | `unit-resolvePeriods` 〈參數物件〉;`unit-calcPeriods` 〈calcKeltner/calcSupertrend/calcIchimoku〉 |
| R-PER-05 | **單根型態**:內建表僅一期且根數為 1(`calcCandle`、`calcKlr`)不換算,只把標籤改為 `barLabelOf(barsPerDay)`(整日 `Nday`、整小時 `Nhr`、整分鐘 `Nm`、其餘 `Ns`) | `Grep "'4hr': 1,\s*\}" src` 僅此二站 | `unit-resolvePeriods` 〈單根型態〉、〈常數與標籤〉;`unit-calcPeriods` 〈全部週期皆不足1根〉(單根型態不剔除) |
| R-PER-06 | **`opt.kp`**:直接採用不換算,優先於 `barsPerDay`;值為正整數(數字字串轉數值)或參數物件(根數欄為正整數);結果為新物件 | — | `unit-resolvePeriods` 〈opt.kp 直接採用〉;`unit-calcPeriods` 〈opt.kp 直接採用〉21 案 |
| R-PER-07 | **撞根數不去重**:相鄰週期換算後同根數者全保留,標籤維持時間語意(README 載明;常見每日根數下之撞根數清單見經驗檔) | — | `unit-resolvePeriods` 〈相鄰週期換算後同根數者保留〉;`unit-calcPeriods` 〈日K線與撞根數〉 |
| R-PER-08 | **輸入檢核**(跨套件規格〈輸入參數之檢測機制〉):`kp`(內建表,必須參數)非非空物件或值非正整數/物件即 throw `invalid kp: must be a non-empty object` / `invalid kp[<標籤>]: must be a positive integer or an object`;`opt.barsPerDay`(有效數字,大於 0 至多 86400,數字字串轉數值)、`opt.kp` 為 opt 類參數,**非預期之輸入視為未給、改用預設,不拋錯**;`opt` 非物件視為 `{}`;輸入不被改寫 | 判定一律用 wsemi 之 `isenum`、`iseint`(不用 `isnum`、`cdbl`、`Number()` 直接轉) | `unit-resolvePeriods` 〈輸入檢核〉〈opt.kp 直接採用〉 |
| R-PER-09 | **失敗通道**:各 calc 為 async,`resolvePeriods` 之 throw 於 calc 內成為 reject(不同步 throw);訊息為固定詞彙,不含傳入之值 | — | `unit-calcPeriods` 〈全部週期皆不足1根〉(21 calc 斷言 reject 與訊息) |
| R-PER-10 | **`opt.debug`**:`opt.debug === true`(非布林視為 false)時,上列「視為未給」另輸出警告 `[w-data-trade resolvePeriods] invalid <鍵>: must be <描述>, using default <預設>`;出口為 `opt.funLog(msg, { fn, reason, key })`(函數),否則 `console.warn`;每個鍵每個行程一次;出口拋錯一律忽略;不含傳入之值 | `resetWarned()` 僅供測試 | `unit-resolvePeriods` 〈opt.debug 警告〉 |
| R-PER-11 | **匯出**:`resolvePeriods` 依 helper 慣例(同 `pickValue`、`diviProt`、`caEma`)掛入 `src/WDataTrade.mjs` 聚合匯出;`barLabelOf`、`BARS_PER_DAY_BASE`、`BARS_PER_DAY_MAX`、`SCALE_KEYS`、`resetWarned` 為 `src/resolvePeriods.mjs` 之具名匯出,不入聚合(聚合每檔只掛預設匯出) | — | `unit-calcPeriods` 〈聚合匯出含resolvePeriods〉 |
| R-PER-12 | **`dataConvert`/`dataCalibrate` 不改碼**:`methods[i].optMethod`、`optMethodInit`、`optMethodRef` 原樣傳入 calc,併入 `barsPerDay` 即生效.限制:`dataConvert` 輸出檔名只含週期標籤,不同 K 線週期須分資料夾;`dataCalibrate` 預設搜尋 `optMethodInit` 全部鍵,須以 `opt.params` 排除 `barsPerDay`,並於 `optMethodRef` 另給 | — | `unit-calcPeriods` 〈dataConvert / dataCalibrate 經optMethod透傳〉 |
| R-PER-13 | **文件**:各 calc JSDoc 於 `[opt={}]` 後列 `opt.barsPerDay`、`opt.kp`、`opt.debug`、`opt.funLog`;README 載明用法、換算規則、單根型態、撞根數、`opt.kp`、非預期輸入與 `opt.debug`、`dataConvert`/`dataCalibrate` 之用法與限制 | `Grep "opt.barsPerDay" src` 須 21 calc + `resolvePeriods` | (文件,無測試) |
