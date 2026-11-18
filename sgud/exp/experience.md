# 經驗(w-data-trade)

> 執行時之累積經驗,留給後續嘗試、執行、判斷.規則見 `sgud/rule/rulebook.md`,現況見 `sgud/state/state.md`.

## 週期表(`opt.intervalSec`、`opt.kp`;Gitea #104、#180)

1. **(作廢,僅留通則)** 原為 `opt.barsPerDay` 之換算寫成先乘後除:`(v × b) ÷ 6` 不可寫 `v × (b ÷ 6)`(後者把精確之 .5 算成 `.49999…` 而誤捨去,例:每日 13 根、27 根).通則:含四捨五入之比例換算先乘後除.`barsPerDay` 已於 #180 移除.
2. **恆等之驗證方式**:取舊版 `src` 與現行 `src` 對同一組合成序列逐一比對(`JSON.stringify` 相等,錯誤訊息亦同);單元測試以「1.0.33 輸出之 sha256 快照」釘住,快照不得以現行程式碼重產.#180 之比對腳本形狀:22 calc × 10 組序列(含各欄逐筆相異之偽亂數價格、近 0 之指數型序列、錯誤輸入、空陣列)× 13 種 opt;給 `intervalSec` 時比 `len`、`vs`、期別標籤;`dataConvert` 比回傳與寫出之檔.
3. **非預期之 opt 值走預設而不拋錯**(跨套件規格 K3):`kp: {}` 等一律當作未給.**例外 `opt.intervalSec`**(主控於 dspec §11 登記):給了而無效即拋,因為改用預設 4hr 會使標籤(即下游參數鍵名)靜默錯置.除錯時加 `opt.debug: true` 看 `opt.kp` 之警告.
4. **(作廢)** 原為 `barsPerDay` 下相鄰週期同根數(撞根數)之實測.根數為本下標籤與秒數一一對應,不會發生.
5. **`dataCalibrate` 與 `intervalSec`**:`opt.params` 預設為 `optMethodInit` 全部鍵,`intervalSec` 放入 `optMethodInit` 會被當成搜尋參數(0、±1e-4… 之候選皆無效,calc 以 reject 回應,該候選得 Infinity 而不入選,浪費評估次數);須以 `opt.params` 排除.`optMethodRef` 預設 `{}`,參考側不帶 `intervalSec`,同週期之參考資料須另給(`unit-calcPeriods` 釘住此限制).
6. **`dataConvert` 輸出檔名只含週期標籤**(`${cointpe}_${keyKind}_${keyIn}_${keyOut}_${method}_${period}.json`),不同 K 線週期之同標籤輸出同名(例:`'1day'` 於 4hr 為 6 根、於日線為 1 根),須分資料夾;以 `periodInfo` 查回根數.
7. **單根型態無特例**:根數為本下 `{ '4hr': 1 }` 與其他表同以 `relabel` 換算(每根 1day 為 `'1day'`),不再有「僅一期且值為 1」之判定.
8. **`calcMacd` 起算位置**為 `35 × len − 2`(`len` 為倍率),`-2` 不隨倍率等比;根數為本下倍率不隨每根時長變,首筆位置同 4hr.
9. **(作廢)** 原為 `barsPerDay` 下 `calcIchimoku` 各欄獨立四捨五入之掃描.根數為本下三參數原樣保留,不換算.
10. **既有、未處理**:`calcMacd` 之資料無效分支(`invalid data`)前有 4 行 `console.log` 除錯輸出,`dataConvert` 之拒絕分支亦有(#180 搬動檢核位置時原樣保留);屬既有除錯碼,本次未動.
11. **(作廢,見第 12 條)** 原載「檔案皆 CRLF」不實.

## 根數為本(`opt.intervalSec`;2026-11-18)

12. **換行為混用(各檔依發布版之換行,勿正規化)**:各 `calc*`、`resolvePeriods`、`periodInfo`、`WDataTrade`、README、`sgud/` 與 `unit-calcPeriods`、`unit-resolvePeriods`、`unit-intervalSec` 為 CRLF;`dataConvert`、`dataCalibrate`、`g.mjs` 與其餘測試檔(含 `unit-calcAts`)為 LF.改檔後以腳本逐檔統計 CRLF 與純 LF 行數(混用即錯);**勿對全庫正規化**(會把未改之檔變成差異).**勿以 `git archive HEAD` 取基準複本**:其換行與工作樹不同(本庫 `core.autocrlf=true`,工作樹之 LF 檔於封存中為 CRLF),以之為底套差異檔會失配;改以 `cp -r` 複製工作樹.Bash 工具內 `grep -c $'\r'` 不可靠(`$'\r'` 未展開時等於空樣式、計得全部行數),統計換行用 node 腳本.
13. **參數之性質盤點(時間性質:無)**:週期表之值(各 calc 之 `KP`)為根數;`calcMacd` 之 `KP` 為 (12,26,9) 之倍率(`fastPeriod`/`slowPeriod`/`signalPeriod` = 倍率 × 12/26/9 根);`calcIchimoku` 為 `{tenkan, kijun, senkouB}` 根數;`calcKeltner`、`calcSupertrend` 為 `{len(根數), mult(無因次)}`.內部回看皆為根數:各「Change」/`ADXslope`/`atsChange`/`BBwidthChange`/`dcWidthChange` 為 1 根差分,`engulfStrength` 看前 1 根,`calcCvd` 之 `SLOPE_N` = 3 根(與表之最短期同根數),`calcMfi` 之 `MFIdiv`、`calcObv` 之 `OBVslope`/`OBVdiv` 回看 len 根,`calcAtr` 之 `trRank` 取最近 len 根,Wilder 平滑 `(prev × (len−1) + x) ÷ len`、EMA `alpha = 2/(len+1)`、`calcKdj` 之 `kAlpha`/`dAlpha` = 1/3 皆為每根之遞推係數.無因次:`mult`、`calcBbpb` 之 `k`.數值尺度:`plusClose`、`subMid`、`plusMid`、`powMid`、`plusBandWidth`、`plusMiddle`、`plusCloudMid`、`plusTenkans`、`eps`、`diviProt` 之 1e-5 下限、`pickValue` 之 1e15 上限、`calcKdj` 之 seed 50.以上無一須知每根時長才能定義;給 `opt.intervalSec` 時 21 calc 之 vs 與不給時逐筆相同即其實證(`unit-intervalSec` 〈S1/S2〉、`unit-calcPeriods` 〈給intervalSec〉).
14. **`calcAts` 於 len = 1 之首筆(已修,R-PER-21)**:原讀 `atss[len − 2]`(= `atss[-1]`,undefined)使首筆 `atsChange` 為 NaN;現照同族「變化量」欄位(`atrChange`、`BBwidthChange`、`dcWidthChange`)之慣例,無前根可比時為 0.內建表最短 3 根,只在 `opt.kp` 給 1 根時發生(原相容選項 `barsPerDay` 使某期換算為 1 根亦會觸發,已移除).len ≥ 2 之首筆仍以前一根計算(測試釘住,避免過度修正為「首筆一律 0」).
15. **根數為本之暖機**:根數不隨每根時長變,首筆位置同 4hr:最長為 `calcAdx` len 180(首筆索引 359 = 2 × 180 − 1),其次 `calcIchimoku` senkouB 180(269)、`calcMacd` 倍率 6(208)、len 180 之各期(179～182).日線上約一年;資料起點若即為使用者之訓練期起點,長期別於訓練期前段無值.
16. **鍵數(使用端之下游套件內建目錄,34 個定義;提出端實測,本輪未能重現)**:每根 4hr 874 鍵;根數為本日線亦 874 鍵,各鍵根數與 4hr 相同,標籤為 4hr 標籤之 6 倍時間.(舊語意 `barsPerDay: 1` 者為 595 鍵,已隨選項移除;使用端以其建立之庫須重建.)
17. **eslint**:套件之 `.eslintrc.js` 會向上層目錄串接其他設定;在他人之工作樹內檢查時用 `--no-eslintrc -c .eslintrc.js --resolve-plugins-relative-to <裝有外掛之目錄>`.
18. **逐項處理之函數須於入口先檢全部項(V17)**:`dataConvert` 逐 method 計算並寫檔,若檢核散在迴圈內(`methods` 各元素、`deals`、`deal.nm`、calc 內之 `intervalSec`),前面之 method 已寫出檔案;各 method 給不同之 `intervalSec` 時,不同每根時長之序列會寫進同一夾.現於計算前一次檢全部(R-PER-22),迴圈內不再重複檢核.搬動檢核時須保持「何者會被檢核」不變:`deal.keyIn` 有指定而不在 `keysIn` 內之 deal 不會被處理,故不檢核(過嚴會拒絕修正前可通過之輸入);測試以此案及 `deal.keyIn` 判定相反之變異釘住.
19. **自訂週期表 `opt.kp` 之標籤原樣採用**:與 `opt.intervalSec` 同給時不換算,其標籤可能不等於根數 × 每根時長(例:自訂 `{ '1day': 6 }` 於每根 1day 時仍名 `1day` 而為 6 根),`periodInfo` 只適用於內建表.
20. **唯一性之斷言**:期別為物件之鍵,`new Set(keys).size === keys.length` 恆真(撞名時後者覆蓋前者而期數變少),須以期數或 len 清單斷言.
21. **移除選項之測試寫法(#180)**:被移除之鍵須測「視為未知鍵」——各種舊有效值、曾矛盾之值、非預期值,輸出同未給(單獨給、與 `intervalSec` 併給、與 `opt.kp` 併給)、`opt.debug` 不警告、具名匯出清單全等(防止殘留之 `barLabelOf` 等).只在「新版對新輸入」之斷言於舊碼下可能亦綠(舊碼忽略新鍵):弱斷言須補期望值(例:`intervalSec: '86400'` 之結果須逐項等於 `{ '6day': 6, … }`,而非只與 `intervalSec: 86400` 之結果相等),修前紅時逐案檢視通過者是否為守門案.
22. **變異之可偵測性**:`chkIntervalSec` 回傳值不轉型(`return v`)時,`relabel` 之乘法會自動把數字字串轉數,標籤輸出不變,須以 `chkIntervalSec('900') === 900` 之直接斷言才抓得到(`resolvePeriods` 層級之輸出無法區分);`RE_LABEL` 放寬接受前導零時,`'0day'` 等使 `spanLabelOf(0)` 拋錯而非讓 `spanSecOf` 回 null,以 `spanSecOf` 非標準寫法回 null 之案抓到.
23. **測試鑑別力之盲點(複審所指,已補)**:結構檢核(`methods` 元素、`deals`、`deal`)之測試須含「無效者在第 1 個」與「第 1 個 deal 無效」,否則 `each(methods.slice(1), …)` 一類之變異會存活;`dataConvert` 之正常輸出(z-score、回傳順序 keysIn × methods × deals、檔內容)須以非 avg 0 / std 1 之 `nm` 與獨立之期望值斷言(`unit-intervalSec` 〈S9 正常輸出〉).兩個無效值並存之優先順序(必須參數先於 opt;`opt.intervalSec` 先於 `opt.kp`;`calcMa`/`calcEma`/`calcVec` 先 `pickValue`)已以測試釘住.
