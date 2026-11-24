# 現況(w-data-trade)

> 當前已開發功能之最新狀態;只記現況,不寫過程(過程見 `sgud/exp/experience.md`).規則見 `sgud/rule/rulebook.md`.
> 基準版本:1.0.57(`package.json`);Gitea #209(方向改變法 `calcDirChange`、`periodInfo` 認 `${N}pct`)為 1.0.57 之後、尚未發布之變更;Gitea #180(週期表改為根數為本、移除 `opt.barsPerDay`、`dataConvert` 入口檢核、`calcAts` 首筆)之驗證紀錄見下(其對照基準為當時之 1.0.49).

## 功能

| 功能 | 狀態 | 規則 | 測試 |
|---|---|---|---|
| 21 個 `calc*` 之內建週期表(值為根數,標籤以每根 4hr 寫定)與輸出 | 完成;未給 `opt.intervalSec`(或為 14400)時與 1.0.33/1.0.49 逐位相同(唯一例外:`calcAts` len = 1 之首筆,見下) | R-PER-01、R-PER-02 | `unit-calc*.test.mjs`(既有)、`unit-contract.test.mjs`、`unit-calcPeriods.test.mjs` 〈恆等〉、`unit-intervalSec.test.mjs` |
| 根數為本 `opt.intervalSec`(每根秒數) | 完成:根數不變、不剔除;期別標籤 = 根數 × 每根秒數之時間跨度(每根 1day:`'4hr'`→`'1day'`、`'12hr'`→`'3day'`、`'1day'`→`'6day'`、`'30day'`→`'180day'`);給了而無效即拋(K3 之例外,主控已登記);給時 `len`、`vs` 與未給逐筆相同 | R-PER-14、R-PER-16、R-PER-20 | `unit-intervalSec.test.mjs` 〈S1/S2〉〈S4〉、`unit-calcPeriods.test.mjs` 〈給intervalSec〉 |
| 期別標籤規則 `spanLabelOf`/`spanSecOf` | 完成:整日 `day`、否則整小時 `hr`、否則 `m`;非整分鐘 throw;標籤與秒數一一對應 | R-PER-15 | `unit-intervalSec.test.mjs` 〈S2 標籤規則〉 |
| `periodInfo(period, { intervalSec })` | 完成:回傳 `{ period, bars, spanSec }`,對內建表 bars 即 len;未給 intervalSec 視為 4hr;只收期別標籤;只適用於內建表(不適用於 `opt.kp` 之標籤);`'none'` 與 `${N}pct`(`^[1-9][0-9]*pct$`,`calcDirChange` 之門檻標籤)回 0 根 0 秒;聚合匯出 `wdt.periodInfo` | R-PER-11、R-PER-19 | `unit-intervalSec.test.mjs` 〈S7〉、〈S6 自訂表之標籤由呼叫端自負其義〉 |
| `opt.barsPerDay` | **已移除**(無時間換算、無一致性檢核、無警告;`barLabelOf`、`BARS_PER_DAY_BASE`、`BARS_PER_DAY_MAX` 不再匯出);傳入視為未知鍵,輸出同未給;README 載明 Breaking changes | R-PER-03～R-PER-05、R-PER-07(已移除)、R-PER-17 | `unit-resolvePeriods.test.mjs` 〈已移除之opt.barsPerDay〉、`unit-calcPeriods.test.mjs` 〈恆等〉、`unit-intervalSec.test.mjs` 〈S5〉 |
| `opt.kp` 自訂週期表 | 完成:標籤與值皆原樣採用(標籤由呼叫端自負其義),優先於 `opt.intervalSec` 之換算 | R-PER-06、R-PER-18 | 同上 〈opt.kp 直接採用〉、`unit-intervalSec.test.mjs` 〈S6〉 |
| 非預期輸入處置與 `opt.debug` 警告 | 完成:`opt.kp` 非預期視為未給(依跨套件規格 K3,`opt.debug` 時警告);`kp` 必須參數與 `opt.intervalSec` 給了而無效 throw | R-PER-08～R-PER-10、R-PER-16 | `unit-resolvePeriods.test.mjs` 〈輸入檢核〉〈opt.debug 警告〉、`unit-intervalSec.test.mjs` 〈S4〉 |
| `resolvePeriods`、`periodInfo` 聚合匯出 | 完成 | R-PER-11 | `unit-calcPeriods.test.mjs`、`unit-resolvePeriods.test.mjs`、`unit-intervalSec.test.mjs` |
| `dataConvert` 全部檢核先於任何計算與寫檔 | 完成:`keysIn` 各元素、`methods` 各元素與各 deal、各 `optMethod.intervalSec` 於 `funAddKeysIn` 與 calc 之前檢核,任一無效 ⇒ 拒且輸出夾為空;既有訊息字面不變;各 method 之 `intervalSec` 須相同,否則 `invalid methods[i].optMethod.intervalSec: must be the same in every method`(`i` 為第一個不一致者) | R-PER-12、R-PER-22 | `unit-intervalSec.test.mjs` 〈S8〉〈S9〉 |
| `dataCalibrate` 之 `intervalSec` 入口檢核 | 完成:`optMethodInit`、`opt.optMethodRef` 之 `intervalSec` 給了而無效 ⇒ 未呼叫 `calcFn` 即拒;預設 `opt.params` 仍為 `optMethodInit` 全部鍵(須自行排除 `intervalSec`) | R-PER-12 | `unit-intervalSec.test.mjs` 〈S8〉、`unit-calcPeriods.test.mjs` 〈dataConvert / dataCalibrate 經optMethod透傳intervalSec〉 |
| `calcAts` 首筆 `atsChange`(len = 1) | 完成:無前根可比為 0(原為 NaN);len ≥ 2 不變 | R-PER-21 | `unit-calcAts.test.mjs` 〈len = 1〉〈len = 2〉 |
| README 與 JSDoc | 完成(根數為本;Breaking changes and fix 一節載明 `barsPerDay` 移除與 `calcAts` 修正;敘述據實:`dataConvert` 只比對各 method 所給之 `optMethod.intervalSec`) | R-PER-13 | — |
| 方向改變法 `calcDirChange`(只用收盤、因果;`dirState`、`dirRetrace`、`dirRun`、`dirAge`;內建門檻表 4、6、8、10%,標籤 `${pct}pct`、`len` 0、`pct`) | 完成(1.0.57 之後、尚未發布;Gitea #209):門檻與 K 線週期無關(`opt.intervalSec` 只檢核);`opt.kp` 沿用 `resolvePeriods`(只收正整數百分比,值為物件者拒);`Close` 須為正之有限數;`periodInfo` 認其標籤 `${N}pct`(R-PER-19);`dataConvert` 照常可用;既有 22 個 calc 與其餘匯出之輸出逐位不變(`periodInfo` 對既有輸入之回傳與拒絕訊息亦不變) | R-DIR-01～R-DIR-06、R-PER-19 | `unit-calcDirChange.test.mjs`、`unit-contract.test.mjs`、`unit-intervalSec.test.mjs` 〈S7 Npct〉 |

## 最近一次驗證(2026-11-18,Gitea #180 修正輪,對工作樹起始之 1.0.49)

- 全套 `npx mocha --no-parallel "test/*.test.mjs"` 與 `npm test`(`--parallel`):630 通過、0 失敗(1.0.49 為 723;移除 `barsPerDay` 之換算測試後淨減).
- 修前紅:新測試(`unit-intervalSec`、`unit-resolvePeriods`、`unit-calcPeriods`、`unit-calcAts`)於 1.0.49 之 `src` 下 182 案中 129 案紅、53 案綠(綠者為守門案:`opt.kp` 原樣採用 21 案、必須參數檢核、14400 與未給相同、`calcAts` len = 2、`dataConvert` 正常寫檔對照等).
- 變異 64 項全數轉紅:提案 32 項中與 `barsPerDay` 無關者 27 項(標籤規則 7、`intervalSec` 檢核 6、`opt.kp`/複製/鍵序 4、`periodInfo` 5、`dataConvert` 3、`dataCalibrate` 2)、恆等 2;主控裁定:`barsPerDay` 移除 6、`intervalSec` 無效即拋 7、V19 訊息 4、`calcAts` len = 1 共 4、V17 入口檢核 14(其中 1 項於補「同 method 多個 deal 之順序」測試後轉紅).
- 等價對拍(工作樹起始之 `src` 複本 = HEAD 內容,對現行 `src`;合成資料):22 calc × 10 組序列 × 13 種 opt 共 2860 組逐位相同(含 625 組兩版皆 reject 且訊息相同;另 9 組為 `calcAts` len = 1 之預期差異:舊 NaN、新 0,其餘欄位相同);`intervalSec` 14400 與 `'14400'` 5702 組與舊版未給相同;`intervalSec` 60/900/3600/43200/86400/604800 共 17106 組 `len`、`vs` 與舊版未給逐筆相同、只有 `period` 不同(73926 個期別標籤改變且符合規則);`barsPerDay`(24/1/6/0.01/'abc'/0)17106 組與未給相同;`dataConvert` 52 組(106 檔)與 `dataCalibrate` 5 組與舊版相同(另 2 組為預期差異:第 2 個 method 無效,舊版已寫前面 method 之檔、新版不寫,拒絕訊息相同).去註解後之程式碼比對:22 個 calc 檔僅 `calcAts` 不同,21 個 KP 表內容 0 差異.
- 工具:`eslint`(`.eslintrc.js`)對 `src/*.mjs`、`test/*.mjs`、`g.mjs` 0 問題;自有套件使用界線掃描(L0e)必修 0、待判讀 0.
- 等價對拍(工作樹起始之 `src` 複本對現行 `src`;合成資料):22 calc × 10 組序列 × 13 種 opt 共 2860 組逐位相同(含 625 組兩版皆 reject 且訊息相同;另 9 組為 `calcAts` len = 1 之預期差異:舊 NaN、新 0,其餘欄位相同);`intervalSec` 14400 與 `'14400'` 5702 組與舊版未給相同;`intervalSec` 60/900/3600/43200/86400/604800 共 17106 組 `len`、`vs` 與舊版未給逐筆相同、只有 `period` 不同(73926 期標籤變動且符合規則);`barsPerDay`(24/1/6/0.01/'abc'/0)17106 組與未給相同;`dataConvert` 52 組(106 檔)與 `dataCalibrate` 5 組與舊版相同(另 2 組為預期差異:第 2 個 method 無效,舊版已寫前面 method 之檔、新版不寫,拒絕訊息相同).
- 工具:`eslint`(`.eslintrc.js`)0 問題(改動之 14 檔);自有套件使用界線掃描(L0e)必修 0、待判讀 0.
- 真實交易所資料之實證(日線標籤、鍵數、暖機)為提出端實測,本輪無該資料,未重現(以合成資料之 sha256 與逐位對拍代之).
- 下游:曾傳入 `barsPerDay` 之呼叫端須改傳 `intervalSec`(傳入 `barsPerDay` 現視為未知鍵而忽略,輸出同未給);由主控另派.

## 最近一次驗證(2026-11-24,Gitea #209:方向改變法 `calcDirChange` 與 `periodInfo` 認 `${N}pct`,對 1.0.57)

- 全套 `npm test`(`--parallel`):656 通過、0 失敗、0 略過,連跑 5 次皆同(1.0.57 為 630;新增 `unit-calcDirChange` 16 案、`unit-contract` 之 `calcDirChange` 6 案、`unit-intervalSec` 之 `Npct` 4 案).`npm pack` 發布包解開之目錄(自建 `node_modules`、不建目錄連結、掛模組解析守門):656 通過、0 失敗,連跑 3 次.含 `unit-calcDirChange` 與 `unit-intervalSec` 二檔之 `--parallel` 連跑 20 次皆 95 通過.
- 修前紅:(a) 1.0.57 之 `src` 配新測試:`unit-calcDirChange` 因模組不存在整檔不載入;`unit-contract` 139 案中 7 案紅(皆為 `calcDirChange` 之案)、132 案綠;`unit-intervalSec` 2 案紅(`Npct` 之回傳與接受集合;另 2 案為守門案,於 1.0.57 亦綠:拒絕寫法、無效 `intervalSec` 先拋).(b) 最終 `src` 但 `periodInfo` 還原為 1.0.57:3 案紅(`unit-calcDirChange` 1、`unit-intervalSec` 2).
- 變異(本套件無變異工具,手動植入於鏡像根,跑 `unit-calcDirChange`、`unit-contract`、`unit-intervalSec`、`unit-calcPeriods`、`unit-resolvePeriods`;錨點須恰中 1 次,否則判失敗;無摘要者判未判定):58 項,紅 54、存活 4,存活者皆為等價變異(起始兩條件之檢查次序互換、`lc > ext` 改 `>=`、換向判定不用 `else`、`Close` 不檢 `isNumber`).含:四處門檻之等號(起始漲、起始跌、漲中換跌、跌中換漲)、轉折點之取法、換向時 `ext` 不改記、創新高不更新、`dirRetrace`/`dirRun` 正負號、`dirAge` 起算與不歸 0、偷看下一根(2 種非因果)、線性門檻、`Close` 檢核 3 種、`opt.intervalSec` 檢核 2 種、改經 `resolvePeriods(KP, opt)`、確認前亦輸出、`len` 與 `pct` 之值、`opt.kp` 之物件值不拒;`periodInfo` 16 項(不認 pct、認 0pct 或前導零、認小數、大小寫不分、無起首或結尾錨、`spanSec`/`bars` 非 0、判斷先於 `opt.intervalSec` 檢核、只認多位數、容許尾端空白或換行、以尾綴判定、多行旗標、可無數字、認正負號、限制位數)全紅.「跌中換漲之等號」於初跑存活(草案之等號案只覆蓋三處),補 `[up, 1, up]` 一案後轉紅.
- 既有輸出之逐位比對(1.0.57 之 `src` 對最終 `src`,合成資料各欄逐筆相異,雜湊整個輸出樹):54,097 鍵——22 個 calc(聚合匯出與直接匯入兩路)× 8 組序列(含溢價指數型、3 根、1 根、空陣列、含無效 `Close`、`null`)× 2 個 `key` × 各種 opt(含無效 `intervalSec`、`opt.kp`、`opt.debug`、各 calc 之既有 opt 鍵與 12 種值)共 15,552 鍵,另 `resolvePeriods` 2,644、`periodInfo` 格狀 19,903(每鍵跨 25 種 opt)、`spanSecOf` 13,287、`spanLabelOf` 738、`chkIntervalSec` 23、`pickValue` 36、`diviProt` 1,040、`caEma` 300、`dataConvert` 538(回傳與整個輸出夾之檔名清單與每檔內容 269 組)、`dataCalibrate` 3、聚合匯出與行程 `cwd` 樹等 33:53,793 鍵逐位相同,304 鍵為預期之差異(檔案清單與聚合匯出之鍵恰多 `calcDirChange`;`periodInfo` 對 302 個 `^[1-9][0-9]*pct$` 之標籤由拋錯改為回 0 根 0 秒),非預期 0.工具以 8 項變異自驗(多寫一檔、少寫一檔、改一個數字、`cwd` 多寫、`-0`、拒絕訊息、警告文字、物件鍵序)皆判為不同,基準跑兩次逐位相同.
- `periodInfo` 接受集合(n 0～300 × 單位 day、hr、m、pct、PCT、Pct、pcts、p、%、無 × 前綴 無、0、00、+、-、空白):1.0.57 收 363 格(皆時間跨度標籤)、新版收 663 格(+300 個 `Npct`,即 n 1～300、無前綴),其餘 17,760 格不變(363 格原本即收、17,397 格仍拒);另 33 個雜項輸入(`none` 之變形、空白、全形、非字串、既有標籤、`1000000pct`、40 位數之 `Npct` 等)中只有該 2 個 `Npct` 改為收,其餘不變.1.0.57 已收者之回傳與已拒者之訊息逐位相同.
- 工具:eslint(`.eslintrc.js`)對 `src/*.mjs`、`test/*.mjs`、`g.mjs` 0 問題;自有套件使用界線掃描(L0e)掃描 40 檔必修 0、待判讀 0;private-guard CLEAN;`@example` 實跑之值與 JSDoc、README 相同.
- 獨立複審(sonnet,唯讀):因果性 7,500 次截斷比對 0 差異;與獨立撰寫之參考實作(6 組隨機漫步 × 4 門檻、3,000 組格點、邊界構造)0 差異;`periodInfo` 55 種標籤 × 27 種 opt 差異僅 75 組(皆 `Npct` × 有效 `intervalSec`);缺陷 5 項皆為文件類(狀態檔未更新、`RE_PCT` 行數、「先出現之極值已確認」之理由敘述、非陣列 `arr` 之敘述、`opt.debug` 警告文字),已修.

## 已知缺口與待辦

- `docs/`、`dist/` 由發布流程產製,不在本次變更內.
- `calcDirChange`:`opt.kp` 只收正整數百分比(小數門檻須另寫檢核);`opt.kp` 之值為物件時拒(跨套件規格 K3「非預期視為未給」之例外,R-DIR-03 已載,規格庫尚未登記);`opt.debug` 警告文字沿用 `resolvePeriods`(提及參數物件,於 `calcDirChange` 實為拒絕),且 `opt.kp` 之警告每個行程只一次(與其他 calc 共用同一鍵);對拍工具(`cmp`/`cmpdiff`/變異腳本)為暫存,未入庫(`test/tools/` 尚無).
- 限制(已載於 README 與規則):`dataConvert` 輸出檔名不含 K 線週期(同一標籤於不同週期為不同根數,須分資料夾);`dataCalibrate` 須以 `opt.params` 排除 `intervalSec`;根數為本下長期別之暖機根數同 4hr(日線約一年,見經驗第 15 條);`dataConvert` 之各 method 一致性只比對所給之 `optMethod.intervalSec`(不讀 `arrOhlc`、`interval`;不讀選項之 `calcOrig` 亦須給同值).
- `calcMa`、`calcEma`、`calcVec` 先轉換輸入資料(`pickValue`)再取週期表,故 `arr`/`key` 無效時先以其訊息拒絕,不先報 `opt.intervalSec` 無效(其餘 18 個 calc 先報);已載於 README 與 R-PER-16.
- 〈另見〉2(#180):`dataConvert` 之 `interval` 參數只檢核、未使用(`dataConvert.mjs` 之 `isestr(interval)`),也不與 `intervalSec` 核對;輸出檔名不含 K 線週期.不在 #180 範圍,未改.
- 〈另見〉3(#180):既有之除錯輸出 `calcMacd`(資料無效分支前 4 行 `console.log`)、`dataConvert`(各拒絕分支內之 `console.log`),不在 #180 範圍,未改.
