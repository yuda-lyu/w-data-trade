# 回饋(w-data-trade)

> 任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;只增不改(處置結果另記一列,寫明承接哪一列).回饋是紀錄與提案,實際修改仍走全域設定 §5.2、§13 之通報管道.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-18 | 全域技能 | role-command-windows(Bash 工具內之 `$'\r'`) | Git Bash 工具內 `grep -c $'\r' <檔>` 不可靠:`$'\r'` 未被展開時樣式為空,計得全部行數,看似「全檔皆 CRLF」;換行種類之統計與「同檔換行是否混用」之檢查須以 node 腳本(分別計 `\r\n` 與純 `\n`)為準.建議於該技能「路徑與檔案 I/O」或「Git Bash 雷區」補一條 | #180 之工作:先以 `grep -c $'\r'` 誤判換行,後改以 node 腳本實測(`dataConvert`、`dataCalibrate`、`g.mjs` 與多數測試為 LF,其餘為 CRLF) |
| 2026-11-18 | 全域技能 | role-coder-for-test(修前紅之判讀) | 「修前紅」時須逐案檢視「通過之案」是否為守門案:被移除或新增之選項於舊碼被忽略時,凡「新輸入之結果等於另一組新輸入之結果」之斷言(例:`intervalSec: '86400'` 等於 `intervalSec: 86400`)於舊碼下亦綠,無鑑別力;須補獨立之期望值.建議於 §1 或 §2 補一條及其典型錯誤形狀 | #180 修前紅執行(1.0.49 之 `src` 對新測試:175 案中 54 綠),逐案檢視後補強 2 案(`unit-resolvePeriods` 〈不剔除〉〈intervalSec為數字字串〉) |
| 2026-11-18 | 全域技能 | role-command-windows(以 patch 套用差異檔前之基準複本) | `git archive HEAD` 所得複本之換行與工作樹可能不同(本庫 `core.autocrlf=true`,工作樹為 LF 之檔於封存中為 CRLF),以之為底套「以發布版為基準產生之差異檔」會失配;取基準複本應以 `cp -r` 複製工作樹.建議於該技能補一條,並建議主控於派工提示詞之「以 patch 套用」處寫明 | #180 之工作:以 `git archive` 取複本套差異檔時 `dataConvert`、`dataCalibrate` 二檔 hunk 失配(`.rej`);改以 `cp -r` 工作樹後全數套用 |
| 2026-11-24 | 自有套件 | w-data-trade(`resolvePeriods` 之 `opt.kp` 警告文字) | `warnInvalid` 之描述固定為「positive integers or objects whose len, tenkan, kijun and senkouB …」,`calcDirChange` 沿用時文字誤導(該函式之值為物件者實為拒絕);另 `warned` 以 `opt.kp` 為鍵全行程共用,先被他 calc 警告過則 `calcDirChange` 不再警告.建議 `resolvePeriods` 增選用之描述參數(不改既有 calc 之輸出),或 `calcDirChange` 自帶檢核與警告 | #209 獨立複審缺陷 5;`src/resolvePeriods.mjs` 之 `warnInvalid` 與 `opt.kp` 區塊 |
| 2026-11-24 | 全域技能 | role-coder-for-validate(L3 對拍工具,references/對拍工具.md) | 每輪對拍(#180、#209)皆重寫工具.建議附可重用之範本或 `scripts/` 下可參數化之版本:摘要 = 鍵 → 雜湊,涵蓋輸出樹與行程 `cwd` 樹,序列化含 `-0`、`NaN`、鍵序、錯誤訊息與 `console` 輸出;預期之差異以規則判定而非手列;附 8 項變異自驗(多寫一檔、少寫一檔、改一個數字、`cwd` 多寫、`-0`、訊息、警告文字、鍵序)與「基準跑兩次須逐位相同」之確定性檢查;註明「基準對基準」會因「應不同而相同」之預期差異規則報錯,確定性須直接比鍵 | #209:`cmp`/`cmpdiff` 約 54,097 鍵、1 分鐘/次,8 項變異皆判為不同、基準兩次 0 鍵不同 |
| 2026-11-24 | 全域技能 | role-coder-for-test(references/sandbox-run.md 之解析守門用法) | 先 `export NODE_OPTIONS=--import=<守門>` 再起 `quiet-run` 或 `npm`,守門即套用於這些工具行程本身,其解析到沙箱之外即拋錯(實測 `quiet-run` 啟動即拋).守門之環境變數須只給 mocha 子行程(包裝程式以 `spawnSync` 之 `env` 傳入);並以兩個探測測試檔(一檔解析沙箱外、一檔於另一 worker)確認 `--parallel` 之 worker 內亦觸發.建議補一條與包裝程式範例 | #209 發布包解開目錄之全套:先 export 失敗,改以包裝程式後 `--parallel` 之 2 檔 3 案探測皆觸發,全套 656 通過 |
| 2026-11-24 | 全域技能 | role-coder-for-test §10(變異之對稱處) | 草案之等號變異僅列三處(起始漲、起始跌、漲中換跌),對稱之「跌中換漲」於延伸變異時存活,暴露測試缺口;建議 §10 補:規則有對稱兩側者,兩側各做一項變異並各有一案(含等號、極值更新、正負號) | #209 變異 D03b 初跑存活,補 `[up, 1, up]` 一案後轉紅 |
