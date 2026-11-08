# 經驗(w-data-trade)

> 執行時之累積經驗,留給後續嘗試、執行、判斷.規則見 `sgud/rule/rulebook.md`,現況見 `sgud/state/state.md`.

## 週期表換算(`opt.barsPerDay`、`opt.kp`;Gitea #104)

1. **先乘後除**:根數換算寫成 `(v × barsPerDay) ÷ 6`,不可寫 `v × (barsPerDay ÷ 6)`.後者於部分組合會把精確的 .5 算成 `.49999…` 而誤捨去(例:每日 13 根、27 根:`27 × (13/6)` 為 58.49999999999999,先乘後除為精確 58.5).常見每日根數(1、2、4、24、48、96、288)於 v ≤ 400 兩種寫法無差異,故差異只在少見組合出現;測試以每日 13 根釘住.
2. **恆等之驗證方式**:`npm pack w-data-trade@1.0.33` 取舊版 tarball 解包,以其 `src` 與現行 `src` 對同一組合成序列逐一比對(`JSON.stringify` 相等,錯誤訊息亦同);單元測試以「1.0.33 輸出之 sha256 快照」釘住,快照不得以現行程式碼重產.舊版 tarball 之 `src` 與修改前工作樹逐位元組相同(28 檔).
3. **非預期之 opt 值走預設而不拋錯**(跨套件規格 K3):`barsPerDay: 'abc'`、`0`、`Infinity`、`kp: {}` 等一律當作未給.使用端若拼錯 `barsPerDay`,會靜默改用 4hr 基準而得到時間語意錯誤之週期表,除錯時加 `opt.debug: true` 看警告.「全部週期皆剔除」不是輸入型別錯誤而是無從得出結果,仍以 reject 告知.
4. **相鄰週期同根數(撞根數)** 實測(1200 根合成序列,`barsPerDay` 為 1、2、4、24、48、96、288 時):
   - 1、24、48、96、288:**無**撞根數.
   - 2(12hr K 線):`'12hr'`、`'16hr'` 同為 1 根;`'20hr'`、`'1day'` 同為 2 根(各表含這些標籤者,共 30 組).
   - 4(6hr K 線):`'16hr'`、`'20hr'` 同為 3 根(15 組).
   - 其中輸出完全相同 42 組;其餘 3 組因 `mult` 不同,len 相同而輸出不同:`calcKeltner` 於 2 之 `'20hr'`、`'1day'`,`calcSupertrend` 於 2 之 `'20hr'`、`'1day'` 與於 4 之 `'16hr'`、`'20hr'`.
5. **`dataCalibrate` 與 `barsPerDay`**:`opt.params` 預設為 `optMethodInit` 全部鍵,`barsPerDay` 放入 `optMethodInit` 會被當成搜尋參數(0、±1e-4… 之候選,無意義);須以 `opt.params` 排除.`optMethodRef` 預設 `{}`,參考側不帶 `barsPerDay`,同週期之參考資料須另給.
6. **`dataConvert` 輸出檔名只含週期標籤**(`${cointpe}_${keyKind}_${keyIn}_${keyOut}_${method}_${period}.json`),不同 K 線週期之同標籤輸出同名,須分資料夾.
7. **單根型態之判定**看內建表(僅一期且值為 1),`opt.kp` 直接採用者不經此判定.內建表若新增「僅一期且值為 1」之 calc 會被視為單根型態而只改標籤,需留意.
8. **`calcMacd` 起算位置**為 `35 × len − 2`(`len` 為換算後倍率),`-2` 不隨週期等比,故 1hr K 線 `'4hr'` 期之首筆對應輸入索引 138(`35 × 4 − 2`),不是 4hr K 線 `'4hr'` 期首筆索引 33 之 4 倍(132).
9. **`calcIchimoku` 各欄獨立四捨五入**:`tenkan`、`kijun`、`senkouB` 各自換算.實測掃描 `barsPerDay` 0.01～60(間隔 0.01)與 61～86400(間隔 1),共 369070 個保留之期,皆維持 `tenkan < kijun < senkouB`(內建 kijun 約為 tenkan 之 2.8 倍以上、senkouB 為 kijun 之 2 倍,且 `tenkan` 須至少 1 根才保留);未額外處理.
10. **既有、未處理**:`calcMacd` 之資料無效分支(`invalid data`)前有 4 行 `console.log` 除錯輸出,`dataConvert` 之錯誤分支亦有;屬既有除錯碼,本次未動.
11. **工具**:CRLF——本套件檔案皆 CRLF(`.editorconfig`);以 Write 建立之新檔為 LF,須以腳本轉 CRLF,以 Edit 改既有檔時亦注意不混入 LF.
