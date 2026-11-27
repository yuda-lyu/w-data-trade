# w-data-trade
A tool for trade data.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-data-trade.svg?style=flat)](https://npmjs.org/package/w-data-trade) 
[![license](https://img.shields.io/npm/l/w-data-trade.svg?style=flat)](https://npmjs.org/package/w-data-trade) 
[![npm download](https://img.shields.io/npm/dt/w-data-trade.svg)](https://npmjs.org/package/w-data-trade) 
[![npm download](https://img.shields.io/npm/dm/w-data-trade.svg)](https://npmjs.org/package/w-data-trade) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-data-trade.svg)](https://www.jsdelivr.com/package/npm/w-data-trade)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-data-trade/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-data-trade
```

#### Example for MA:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-data-trade/blob/master/g.mjs)]
```alias
import wdt from 'w-data-trade'

//arr, 4hr K 線資料, calcMa 只取用 time 與指定欄位(此處為 Close)
let arr = [
    { time: '2020-01-01T00:00:00', Close: 7173.32 },
    { time: '2020-01-01T04:00:00', Close: 7195.23 },
    { time: '2020-01-01T08:00:00', Close: 7225.01 },
    { time: '2020-01-01T12:00:00', Close: 7209.83 },
    { time: '2020-01-01T16:00:00', Close: 7188.77 },
    { time: '2020-01-01T20:00:00', Close: 7200.85 },
    { time: '2020-01-02T00:00:00', Close: 7156.44 },
    { time: '2020-01-02T04:00:00', Close: 7130.02 },
]

//calcMa, 各期移動平均, 回傳 [{ period, len, vs }]
//len 為該期之根數, 期別標籤為根數 × 每根時長(預設每根 4hr, '1day' 即 6 根), 資料不足該期長度時 vs 為空陣列
wdt.calcMa(arr, 'Close')
    .then((rs) => {
        console.log(rs[0])
        // => {
        //   period: '1day',
        //   len: 6,
        //   vs: [
        //     { time: '2020-01-01T20:00:00', param: 7198.835 },
        //     { time: '2020-01-02T00:00:00', param: 7196.021666666667 },
        //     { time: '2020-01-02T04:00:00', param: 7185.153333333333 }
        //   ]
        // }
    })
    .catch((err) => {
        console.log(err)
    })

//opt.norm=true 時 param 改為「均線與現價之偏離比例」= (MA - 現價) / 現價
wdt.calcMa(arr, 'Close', { norm: true })
    .then((rs) => {
        console.log(rs[0].vs)
        // => [
        //   { time: '2020-01-01T20:00:00', param: -0.0002798280758522018 },
        //   { time: '2020-01-02T00:00:00', param: 0.0055309157439547936 },
        //   { time: '2020-01-02T04:00:00', param: 0.007732563630022398 }
        // ]
    })
    .catch((err) => {
        console.log(err)
    })

```

#### Example for other K-line intervals (opt.intervalSec, bar-count based):
Every `calc*` function except `calcOrig` and `calcDirChange` (a threshold table, see "Directional change" below) has a built-in period table whose values are bar counts: a parameter describes the pattern in bars, so the bar counts never change with the K-line interval. The labels of the built-in tables are written for 4hr K-lines (label span = bars × 4hr: `'4hr'` = 1 bar, `'12hr'` = 3 bars, `'1day'` = 6 bars, `'30day'` = 180 bars). Pass `opt.intervalSec` (seconds per bar) and each label is converted to the time span of its bar count × `opt.intervalSec`. With `opt.intervalSec` unset or 14400 the interval is 4hr, and the labels and the output are identical to the previous versions (the only difference is the `calcAts` fix under "Breaking changes and fix" below).
```alias
import wdt from 'w-data-trade'

//arr1d, 日 K 線資料(每根 86400 秒), 根數不變, 標籤依根數 × 每根時長換算('12hr' 之 3 根 => '3day')
wdt.calcRsi(arr1d, 'Close', { intervalSec: 86400 })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '3day:3', '4day:4', '5day:5', '6day:6', '12day:12', '24day:24', '42day:42' ]
    })

//arr1h, 1hr K 線資料(每根 3600 秒)
wdt.calcMa(arr1h, 'Close', { intervalSec: 3600 })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '6hr:6', '12hr:12', '1day:24', '42hr:42', '90hr:90', '180hr:180' ]
    })

//periodInfo, 由參數鍵名之期別與每根時長查回根數與時間跨度秒數, 跨週期以根數對應同一線型
console.log(wdt.periodInfo('3day', { intervalSec: 86400 }))
// => { period: '3day', bars: 3, spanSec: 259200 }
console.log(wdt.periodInfo('12hr'))
// => { period: '12hr', bars: 3, spanSec: 43200 }

//periodInfo 未給 intervalSec 時視為每根 4hr: 日線之標籤須給 intervalSec: 86400 才得正確根數
console.log(wdt.periodInfo('3day'))
// => { period: '3day', bars: 18, spanSec: 259200 }

//periodInfo 亦認 calcDirChange 之門檻標籤 `${N}pct`(N 為正整數, 無前導零), 回 0 根 0 秒(同 'none'), 與 intervalSec 無關
console.log(wdt.periodInfo('4pct', { intervalSec: 86400 }))
// => { period: '4pct', bars: 0, spanSec: 0 }

```
- `opt.intervalSec`: seconds per bar (4hr = 14400, 1hr = 3600, 15m = 900, 1day = 86400), a positive integer multiple of 60 up to 31536000 (365 days), a number or numeric string (the converted number is what is used). `null` and `undefined` mean not given; unset means 14400. A given value that is not valid is not replaced by the default (a wrong interval would silently give wrong labels, which are part of the parameter keys): the returned Promise rejects with `invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000`, before `opt.kp` and the period table are processed (so also when a valid `opt.kp` is given). `calcMa`, `calcEma` and `calcVec` convert their input data (`arr`, `key`) before they read the options, so for these three an invalid `arr` or `key` is reported before an invalid `opt.intervalSec`. `calcOrig` takes no `opt` (it has no period table), so an `opt.intervalSec` given to it is ignored.
- The bar counts are kept as they are, so the values are computed on the same number of bars at every interval (`len` and `vs` are identical to the output without `opt.intervalSec`, only `period` differs) and no period is dropped. Parameter tables (`calcKeltner`, `calcSupertrend`: `{ len, mult }`; `calcIchimoku`: `{ tenkan, kijun, senkouB }`) are kept as they are and their label follows the bar count the label stands for (`len`, or `senkouB` for `calcIchimoku`, which is the output `len`). `calcMacd` keeps its multipliers of (12, 26, 9). `calcCandle` and `calcKlr` (single bar) are labeled with the interval itself, for example `'1day'`.
- Label rule: the time span in seconds is written as `${N}day` when it is a whole number of days, otherwise `${N}hr` when it is a whole number of hours, otherwise `${N}m` (whole minutes). Every span has exactly one label, so two periods with different bar counts never get the same label at one interval. At 14400 every built-in label is reproduced (`'4hr'`, `'8hr'`, `'12hr'`, `'16hr'`, `'20hr'`, `'1day'`, `'2day'`, `'4day'`, `'7day'`, `'15day'`, `'30day'`). At 86400 every label is the 4hr label times 6: `'4hr'` → `'1day'`, `'12hr'` → `'3day'`, `'1day'` → `'6day'`, `'30day'` → `'180day'`.
- Warm-up: the bar counts are the same at every interval, so the first value of a period needs the same number of bars as on 4hr K-lines, for example `calcAdx` with `len` 180 starts at bar index 359, `calcIchimoku` with senkouB 180 at 269 and `calcMacd` with multiplier 6 at 208. On daily K-lines that is up to about one year of data before the first value. A period with too few bars returns an empty `vs`.
- `wdt.periodInfo(period, opt)` returns `{ period, bars, spanSec }` for the period label of a parameter key (only the label, which is the last `_`-separated part of the key, not the whole key) and `opt.intervalSec`; `'none'` (`calcOrig`) gives 0 bars and 0 seconds, and so does `'${N}pct'` (the threshold label of `calcDirChange`, see "Directional change" below; `N` a positive integer without leading zeros, for example `'4pct'`, `'10pct'`): it is returned as `{ period, bars: 0, spanSec: 0 }` at every `intervalSec` (an invalid `opt.intervalSec` still throws, as for `'none'`). `'0pct'`, `'01pct'`, `'4.5pct'`, `'pct'`, `'4PCT'`, with a sign or with spaces are not accepted and throw the message below. For the built-in period tables `bars` is the output `len`. `opt.intervalSec` defaults to 14400 (4hr), so give the interval of the key: without it `'3day'` gives 18 bars, with `intervalSec: 86400` it gives 3 bars. It applies only to labels made from the built-in period tables, not to labels of your own table `opt.kp` (those labels are used as given and their meaning is up to the caller, they need not equal bars × interval). A label that is not a standard label (see the label rule) or whose time span is not a whole multiple of the interval throws `invalid period: must be 'none' or a period label whose time span is a multiple of opt.intervalSec`.
- `spanLabelOf(sec)`, `spanSecOf(label)`, `chkIntervalSec(v)`, `INTERVAL_SEC_BASE` and `INTERVAL_SEC_MAX` are named exports of `w-data-trade/src/resolvePeriods.mjs`.

#### Breaking changes and fix: opt.barsPerDay removed, calcAts with a 1-bar period
`opt.barsPerDay` (bars per day; it converted the bar counts by time and dropped the periods shorter than one bar, so a daily K-line lost `'12hr'`, `'16hr'`, `'20hr'` and every period above 30 bars) is removed together with its conversion, its label helper `barLabelOf` and the constants `BARS_PER_DAY_BASE` and `BARS_PER_DAY_MAX`. A parameter describes a pattern in bars, so the bar counts are no longer converted; use `opt.intervalSec` to get labels that are the real time spans.
- A `barsPerDay` that is still passed is an unknown key of `opt`: it is ignored like any other unknown key (no conversion, no check, no warning), so the output is the same as without it, also when `opt.intervalSec` is given.
- A caller that passed `barsPerDay: 6` gets the same output as before. A caller that passed another value (for example `24` or `1`) now gets the built-in table and its labels unchanged (4hr labels, same bar counts) instead of the converted one: pass `intervalSec` (3600 or 86400) to get the labels of that interval, and rebuild what was stored under the old time-converted keys.
- `dataConvert` and `dataCalibrate` no longer compare `barsPerDay` with `intervalSec`.
- Fix: for a 1-bar period of `calcAts` (only possible with your own table, for example `opt.kp: { x: 1 }`; the built-in table starts at 3 bars) the first `atsChange` has no previous bar to compare with and is now `0`, as the first value of the other change fields (`atrChange`, `BBwidthChange`, `dcWidthChange`), instead of `NaN`. Periods of 2 bars or more are unchanged.

#### Example for your own period table (opt.kp):
```alias
//opt.kp, 自訂週期表(正整數根數), 標籤與根數皆原樣採用, 週期標籤即為輸出之 period
wdt.calcMa(arr, 'Close', { kp: { '3day': 18, '5day': 30 } })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '3day:18', '5day:30' ]
    })

```
- `opt.kp`: your own period table, used as given (labels and values) and never converted (also when `opt.intervalSec` is given). Its labels are your own names and their meaning is up to you: they need not equal bars × interval, and `wdt.periodInfo` does not apply to them. Values are positive integer bar counts, or for the parameter tables `{ len, mult }` (`calcKeltner`, `calcSupertrend`) and `{ tenkan, kijun, senkouB }` (`calcIchimoku`).
- An unexpected `opt.kp` (for example `{}`, `{ a: 0 }`, `{ a: 'abc' }`, a non-integer bar count) is treated as not given and the built-in table is used, no error is thrown (unlike `opt.intervalSec`, see above). Set `opt.debug` to `true` to get one warning per key and process, printed with `console.warn` or passed to `opt.funLog(msg, { fn, reason, key })` when it is a function. The warning never contains the given value.
- `wdt.resolvePeriods(kp, opt)` is the function that all calc functions use to get their period table from the built-in table and `opt` (`opt.intervalSec`, `opt.kp`).

#### dataConvert and dataCalibrate with other K-line intervals:
`methods[i].optMethod` of `dataConvert` and `optMethodInit` / `optMethodRef` of `dataCalibrate` are passed to the calc function unchanged, so put `intervalSec` there.
```alias
//dataConvert, 日 K 線, 輸出檔名之期別為換算後之標籤(例: ..._ma_6day.json 為 6 根)
let methods = [
    {
        method: 'ma',
        deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }],
        optMethod: { intervalSec: 86400 },
    },
]

//dataCalibrate, 以 opt.params 排除 intervalSec(預設會搜尋 optMethodInit 全部鍵), 參考側 optMethodRef 亦須給
let rs = await wdt.dataCalibrate(calcFn, arrSrc, arrRef, ['param'], { intervalSec: 86400, plusClose: 0 }, { params: ['plusClose'], optMethodRef: { intervalSec: 86400 } })
```
- `dataConvert` checks everything before any calculation (including `opt.funAddKeysIn` and the calc functions) and before any file is written; if anything is invalid it rejects and writes nothing. The checks are: every element of `keysIn` is a string; every element of `methods` is an object whose `method` is a string that exists in `kp` and whose `deals` is a non-empty array; every deal that will be processed (no `keyIn`, or its `keyIn` is in `keysIn`) has a string `keyOut` and an object `nm`; and `optMethod.intervalSec` of every method. The messages of these checks are the same as before (`invalid m[...]`, `invalid m.method[...]`, `invalid m.method[...] in kp`, `invalid m.deals[...]`, `invalid deal.keyOut[...]`, `invalid deal.nm[...]`, `invalid keyIn[...]`); an invalid `intervalSec` gives the message of the calc function.
- All methods of one call must use the same `optMethod.intervalSec` (unset counts as 14400, a numeric string equals the number), otherwise it rejects with `invalid methods[i].optMethod.intervalSec: must be the same in every method` (`i` is the index of the first method that differs from the earlier ones), so values computed with different intervals are not written into one folder by mistake. This compares only the values given in `optMethod.intervalSec`: it cannot know the real interval of `arrOhlc` or of the `interval` argument, and a method whose function ignores options (for example `calcOrig`) still has to carry the same value. Options that a function in `kp` adds by itself (a wrapper that merges its own `intervalSec`) are not seen by this check.
- `dataCalibrate` checks `intervalSec` of `optMethodInit` and `opt.optMethodRef` the same way before any calculation (`calcFn` is not called when it is invalid). Without `intervalSec` both behave as before.
- The output file names of `dataConvert` contain the period label (for example `..._ma_6day.json`) but not the K-line interval. With `opt.intervalSec` a label means the real time span, and the same label can stand for different bar counts on different intervals (for example `'1day'` is 6 bars at 4hr and 1 bar at 1day), so use a different output folder for each interval. Use `wdt.periodInfo` to get the bar count of a label.
- `dataCalibrate` searches every key of `optMethodInit` unless `opt.params` is given, so list the keys to search in `opt.params` and leave `intervalSec` out. The reference side uses `opt.optMethodRef` (default `{}`), so give `intervalSec` there too when the reference data has the same interval.

#### dataConvert: per-period normalization constants and period statistics:
`deal.nm.byPeriod` (optional) gives each period its own `avg` and `std`; the returned rows also carry quantiles and per-period statistics.
```alias
//keys of byPeriod are period labels (the `period` of each calc result); a period with its own key uses its avg and std, the others use nm.avg and nm.std
let methods = [
    {
        method: 'ma',
        deals: [{ keyOut: 'param', nm: { avg: 0, std: 1, byPeriod: { '1day': { avg: 99.9, std: 2.4 }, '2day': { avg: 99.8, std: 3.1 } } } }],
        optMethod: {},
    },
]
let rs = await wdt.dataConvert('demo', 'BTCUSDT', '4hr', 'price', 'ohlc', methods, arr, kp, fdOut, { keysIn: ['Close'] })
//rs[0]: { method, keyIn, keyOut, avg, std, min, max, n, median, q25, q75, periods }
//rs[0].periods[i]: { period, len, n, avg, std, min, max, median, q25, q75 } of the normalized series of that period
```
- `byPeriod` is `null` / `undefined` (not given) or a plain object (an empty object is allowed) whose values are objects with a finite number `avg` and a finite number `std` greater than 0 (numeric strings and BigInt are rejected). It is checked before any calculation and before any file is written, together with the other checks; an invalid one rejects with `invalid deal.nm.byPeriod: must be an object of { avg, std } with a finite avg and a finite std > 0` (the given value is not in the message) and nothing is written. A deal whose `keyIn` is given but is not in `keysIn` is not processed and therefore not checked. Only own enumerable keys count, so a period named `toString` is not affected by inherited keys. The keys and values of `byPeriod` are read once, during the check, and the normalization uses the values read then (a getter that returns something else on a later read, or a change made after the check, has no effect); a read that throws counts as invalid.
- Without `byPeriod` the files written and the existing fields of the returned rows (`method`, `keyIn`, `keyOut`, `avg`, `std`, `min`, `max`) are the same as before. The added fields are appended after them.
- `n` is the number of values that are not `NaN` (the values `avg` and `std` use), `median`, `q25` and `q75` are the type 7 quantiles (sorted `x`, `h = (n − 1) × q`, `x[⌊h⌋] + (h − ⌊h⌋) × (x[⌊h⌋ + 1] − x[⌊h⌋])`) of the flattened series after normalization. `Infinity` and `-Infinity` are counted in `n`; a quantile between a finite value and an infinite one is that infinity, and between `-Infinity` and `Infinity` it is `NaN`. A period with `n` 0 has `null` in all its statistics (the existing `min` and `max` of the row stay `undefined` for no value, as before); `std` is `null` when `n` is 1. Calling with `nm: { avg: 0, std: 1 }` and `denyOutput: true` gives the statistics of the raw values of every period, from which per-period constants can be made (for example `avg` and `std`, or `median` and `(q75 − q25) / 1.349`).
- `periods[i].period` is the label of the period, so rows from different `intervalSec` differ in these labels even when everything else is equal.

#### Example for directional change (calcDirChange, a threshold table instead of bar counts):
```alias
//calcDirChange, 方向改變法: 只用收盤, 逐根只看到當根; 自至今之極值反向達門檻(對數報酬 θ = ln(1 + 門檻% / 100))即確認換向
wdt.calcDirChange(arr, 'Close')
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}:${v.pct}`))
        // => [ '4pct:0:4', '6pct:0:6', '8pct:0:8', '10pct:0:10' ]
        console.log(Object.keys(rs[0].vs[0]))
        // => [ 'time', 'dirState', 'dirRetrace', 'dirRun', 'dirAge' ]
    })

//門檻與 K 線週期無關: 給 intervalSec 時只檢核, 標籤與輸出皆不變
wdt.calcDirChange(arr1d, 'Close', { intervalSec: 86400 })
    .then((rs) => {
        console.log(rs.map((v) => v.period))
        // => [ '4pct', '6pct', '8pct', '10pct' ]
    })

//opt.kp, 自訂門檻表(值為門檻百分比之正整數)
wdt.calcDirChange(arr, 'Close', { kp: { '5pct': 5, '12pct': 12 } })
```
- Definition (close only, causal: the value of a bar uses only that bar and the bars before it): `lc = ln(Close)`, `θ = ln(1 + pct / 100)`. Before the first confirmation the highest and the lowest `lc` so far are kept; `lc − lowest ≥ θ` confirms up (+1), otherwise `highest − lc ≥ θ` confirms down (−1) (with `θ > 0` both cannot hold on the same bar: if they did, the highest and the lowest would be at least `2θ` apart and the bar of the later of the two extremes would already be `θ` away from the earlier one, so it would have confirmed on that bar or before). In an up direction `ext` is the highest `lc` since the confirmation; `ext − lc ≥ θ` switches to down and `ext` becomes this bar's `lc`; otherwise a new high updates `ext` (the test is computed as `ext − lc ≥ θ`; in floating point it can differ from `lc ≤ ext − θ` at the 1-ulp boundary, the former is the rule). The down direction is symmetric (`lc − ext ≥ θ` switches to up). The turning point (`pivot`) of a confirmation is the lowest (highest) `lc` so far for the first confirmation up (down), and the `ext` before the switch for every later one.
- Output of each bar (all known after that bar): `dirState` the confirmed direction (+1 / −1); `dirRetrace` the retracement from `ext` against the direction in units of `θ` (up `(ext − lc) / θ`, down `(lc − ext) / θ`; in `[0, 1)`, 0 at the extreme, near 1 just before a switch); `dirRun` the log return from `pivot` in the direction in units of `θ` (up `(lc − pivot) / θ`, down `(pivot − lc) / θ`; at least 1 on the bar of the confirmation, always above 0); `dirAge` the bars since the last confirmation (0 on that bar). Bars before the first confirmation have no value (the first element of `vs` is the bar of the first confirmation); a threshold that is never reached gives an empty `vs`.
- The built-in table is `{ '4pct': 4, '6pct': 6, '8pct': 8, '10pct': 10 }` (values are threshold percentages). The labels are `${pct}pct`, not time spans: they are the same at every K-line interval and `opt.intervalSec` is only checked (an invalid value rejects with the message of the other calc functions). `wdt.periodInfo('4pct')` returns `{ period: '4pct', bars: 0, spanSec: 0 }` (the same as `len`, and as `'none'`) for any `${N}pct` label, so code that maps a label to a bar count needs no special case for these keys; this holds for the labels of the built-in table, a label of your own `opt.kp` is used as given (see above). `len` is always 0 (no bar window) and `pct` is the threshold percentage of each element.
- `dataConvert` reads only `period` and `vs`, so it works as with the other calc functions: the output file name carries the label and the output key, for example `price_ohlc_Close_dirState_dirChange_4pct.json` for the method name `dirChange` and `keyOut: 'dirState'` (the keys are `dirState`, `dirRetrace`, `dirRun` and `dirAge`).
- `opt.kp` is your own threshold table, used as given; its values are positive integer percentages (a numeric string is converted). An unexpected `opt.kp` (not an object, `{}`, a value that is not a positive integer) is treated as not given (same as the period tables, with the `opt.debug` warning; the warning text is the one shared with the period tables, which also mentions parameter objects, but a value that is an object is rejected here, see below); a value that is an object rejects with `invalid opt.kp: must be an object of positive integer percentages`.
- Every `Close` must be a positive finite number, otherwise the returned Promise rejects with `invalid arr: must have a positive finite Close in every element`. One invalid `Close` rejects the whole call, also when it is after the last confirmation. `key` is not used (always `Close`). `null`, `undefined` and `{}` (size 0) are taken as no data and give empty `vs` for every threshold; any other value that is not an array of objects (for example a string) has no valid `Close` to read and rejects with the same message.

#### Example for feature calcs (calcMomz, calcVolx, calcDown, calcFlow):
These four use the same built-in period table as `calcCvd` (bar counts 3, 4, 5, 6, 12, 24, 42, 90, 180; labels `'12hr'` … `'30day'`), so `opt.intervalSec` and `opt.kp` work as described above. Every value uses only the current bar and the bars before it (causal). A period starts at the first bar for which every output field can be computed (`s0` below, an index of the input) and goes on to the last bar; fewer than `s0 + 1` bars give an empty `vs`. All outputs are finite numbers (a degenerate case, for example a zero denominator, gives the defined value stated with the field below instead of `NaN` or `Infinity`). Every element of `arr` is checked, one invalid element rejects the whole call, and the message never contains the given value.
```alias
//calcMomz, 以波動標準化之動能、速度、加速度、已漲之幅、效率比(讀 key 欄位)
wdt.calcMomz(arr, 'Close', { volLen: 30 })
    .then((rs) => {
        console.log(Object.keys(rs[0].vs[0]))
        // => [ 'time', 'momZ', 'vel', 'acc', 'ext', 'er' ]
    })

//calcVolx, 波動之延伸(讀 Open、High、Low、Close; key 不使用)
wdt.calcVolx(arr, 'Close', { longMult: 4, vrLag: 6, vovLen: 6, eps: 1e-12 })

//calcDown, 下跌之統計(讀 key 欄位與 Volumn)
wdt.calcDown(arr, 'Close', { volLen: 30, crashK: 1.5 })

//calcFlow, 累積主動買賣量之水準、速度、加速度(讀 Volumn、TakerBuyBaseAssetVolume; key 不使用)
wdt.calcFlow(arr, 'Close', { scaleWin: 90, scaleMin: 30 })

```
- Notation: `lc = ln(value)`, `r(i) = lc(i) − lc(i−1)`, `W(i, m)` the `m` bars ending at bar `i` (the current bar included), `len` the bar count of the period, `σ(i)` the population standard deviation of `r` over `W(i, volLen)` (0 when all values are equal; see "Zero volatility" below).
- `calcMomz` reads the field `key` (positive finite numbers). Fields (bar `i`, period `len`; `len` must be an integer of at least 2): `momZ = (lc(i) − lc(i−len)) / (σ(i) √len)`; `vel` = least-squares slope of `lc` over `W(i, len)` per bar `/ σ(i)`; `acc = vel(i) − vel(i−len)`; `ext = (lc(i) − lowest lc in W(i, len)) / (σ(i) √len)`; `er = |lc(i) − lc(i−len)| / Σ|r|` over `W(i, len)` (0 when the sum is 0). `momZ`, `vel` and `ext` are 0 when `σ(i)` is 0. `s0 = len + max(len − 1, volLen)`. Option `opt.volLen` (integer of at least 2, default 30).
- `calcVolx` reads `Open`, `High`, `Low` and `Close` (positive finite numbers; `key` is not used). With `pk = (lh − ll)² / (4 ln 2)`, `gk = 0.5 (lh − ll)² − (2 ln 2 − 1)(lc − lo)²`, `rs = (lh − lc)(lh − lo) + (ll − lc)(ll − lo)`, `tr = max(lh, lc(i−1)) − min(ll, lc(i−1))` (`lo`, `lh`, `ll`, `lc` the logs of open, high, low, close) and `lnv(x) = 0.5 ln(max(x, eps))`: `rv = lnv(mean of r²)`, `park`, `gk`, `rs` = `lnv` of the mean of `pk`, `gk`, `rs`; `rvRatio = rv − lnv(mean of r² over W(i, len × longMult))`; `chop = log10(Σtr / (highest lh − lowest ll)) / log10(len)` (0 when the range is not positive); `downShare` = share of `r²` of the bars with `r < 0` (0.5 when the sum of `r²` is 0); `jumpShare = 1 − (π/2) mean(|r(j)||r(j−1)|) / mean(r²)` (0 when the denominator is 0); `varRatio = mean((lc(j) − lc(j−vrLag))²) / (vrLag × mean(r²))` (1 when the denominator is 0); `volOfVol` = standard deviation over `W(i, len)` of `u(j) = lnv(mean of r² over W(j, vovLen))`. `len` must be an integer of at least 2. `s0 = max(len × longMult, len + 1, len + vrLag − 1, len + vovLen − 1)`. Options: `opt.longMult`, `opt.vrLag`, `opt.vovLen` (integers of at least 2; defaults 4, 6, 6), `opt.eps` (a finite number above 0; default 1e-12).
- `calcDown` reads the field `key` and `Volumn` (a finite number of at least 0). `downBars` = number of bars with `r < 0` in `W(i, len)` divided by `len`; `downVol` = volume of those bars divided by the volume of `W(i, len)` (0.5 when the volume is not above 0); `crashN` = number of bars `j` in `W(i, len)` with `σ(j) > 0` and `r(j) / σ(j) ≤ −crashK` (`σ(j)` includes the return of bar `j` itself). `s0 = len + volLen − 1`. Options: `opt.volLen` (integer of at least 2, default 30), `opt.crashK` (a finite number above 0, default 1.5).
- `calcFlow` reads `Volumn` and `TakerBuyBaseAssetVolume` (`0 ≤ TakerBuyBaseAssetVolume ≤ Volumn × (1 + 1e-9)`; `key` is not used). The volume scale `s(j)` is the mean volume of the bars before bar `j` (up to `scaleWin` bars, at least `scaleMin`; the current bar is not included); `buy = TakerBuyBaseAssetVolume / s`, `sell = (Volumn − TakerBuyBaseAssetVolume) / s`, `net = buy − sell` (both 0 when `s ≤ 0`). `M` is the mean over `W(i, len)` of `buy`, `sell`, `net`, and for `share` the sum of `(2 × TakerBuyBaseAssetVolume − Volumn)` divided by the sum of `Volumn` over `W(i, len)` (0 when the sum is not above 0). Each of the four gives the level `L = M(i)`, the velocity `V = M(i) − M(i−len)` and the acceleration `A = M(i) − 2 M(i−len) + M(i−2 len)`: `buyL`, `buyV`, `buyA`, `sellL`, …, `shareA` (12 fields). `s0 = scaleMin + 3 len − 1`. Options: `opt.scaleWin` (integer of at least 1, default 90), `opt.scaleMin` (integer from 1 to `scaleWin`; default the smaller of 30 and `scaleWin`).
- Options (`opt.volLen`, `opt.crashK`, `opt.longMult`, `opt.vrLag`, `opt.vovLen`, `opt.eps`, `opt.scaleWin`, `opt.scaleMin`): a number or a numeric string (converted, then used as a number); `null` and `undefined` mean not given. An unexpected value (below the minimum, not an integer where an integer is needed, not finite, not a number or numeric string, a boolean, an object, `scaleMin` above `scaleWin`) is treated as not given and the default is used, without an error; with `opt.debug: true` one warning per option key and process is given, for example `[w-data-trade calcMomz] invalid opt.volLen: must be an integer >= 2, using default 30` (to `opt.funLog` when it is a function, otherwise `console.warn`; the warning never contains the given value). These options are bar counts or dimensionless multiples and do not change with `opt.intervalSec`.
- `opt.kp` of these calcs takes positive integers (at least 2 for `calcMomz` and `calcVolx`, which need two points for a slope and `log10(len)`). Not an object, `{}` and a value that is not a positive integer are treated as not given (built-in table, see above). A value that is an object (a parameter object of another calc), or `1` for `calcMomz` and `calcVolx`, is rejected with `invalid opt.kp: must be an object of positive integers` (`… of integers >= 2` for `calcMomz` and `calcVolx`) instead of being replaced by the built-in table, because the table is the set of periods you asked for. An invalid `opt.intervalSec` rejects as for the other calcs.
- `key` of `calcMomz` and `calcDown` must be a non-empty string, otherwise the Promise rejects with `invalid key: must be a non-empty string` (before `opt` and `arr` are examined).
- Zero volatility: `σ` is taken as 0 when all `r` in the window are equal, and also when `σ ≤ 1e-12` (a perfectly geometric series has `r` that differ only by floating-point rounding, `σ` about 1e-17; without this limit `momZ` would be about 1e13 and every falling bar would count in `crashN`). `σ ≤ 1e-12` means the returns of the window agree to about 12 digits, which is not how a real price series looks.
- `calcVolx` rejects a bar whose high and low do not contain the open and the close (`Low ≤ Open, Close ≤ High`, so also `High ≥ Low`) with `invalid arr: must have Low <= Open, Close <= High in every element`: for a consistent bar `gk` and `rs` are never negative, and an inconsistent one would let their mean fall to the `eps` floor, which gives the extreme value `0.5 ln(eps)` (about −13.8). `jumpShare` is not truncated: it is in `(−∞, 1]`, negative when the bipower variation is larger than the realized variance (an estimation error), and for short windows (`len` up to 5) it can be a large negative number; take `max(0, jumpShare)` if you need a non-negative share.
- Warm-up with the built-in table: the first value of the longest period (`'30day'`, `len` 180) needs 721 bars for `calcVolx`, 570 for `calcFlow`, 360 for `calcMomz` and 210 for `calcDown` (the number of bars is `s0 + 1`); the shortest period (`'12hr'`, `len` 3) needs 13, 39, 34 and 33 (in the same order). The cost is a direct sum over each window (not a running sum, to keep the rounding of the definition): measured on synthetic data with all nine periods, about 5 to 22 ms per calc for 2,971 bars and 30 to 170 ms for 20,000 bars.
- These calcs only compute extra features from the K-line fields. They are not claimed to be effective factors or predictors; whether a feature helps is for the user to test.
