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
Every `calc*` function except `calcOrig` has a built-in period table whose values are bar counts: a parameter describes the pattern in bars, so the bar counts never change with the K-line interval. The labels of the built-in tables are written for 4hr K-lines (label span = bars × 4hr: `'4hr'` = 1 bar, `'12hr'` = 3 bars, `'1day'` = 6 bars, `'30day'` = 180 bars). Pass `opt.intervalSec` (seconds per bar) and each label is converted to the time span of its bar count × `opt.intervalSec`. With `opt.intervalSec` unset or 14400 the interval is 4hr, and the labels and the output are identical to the previous versions (the only difference is the `calcAts` fix under "Breaking changes and fix" below).
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

```
- `opt.intervalSec`: seconds per bar (4hr = 14400, 1hr = 3600, 15m = 900, 1day = 86400), a positive integer multiple of 60 up to 31536000 (365 days), a number or numeric string (the converted number is what is used). `null` and `undefined` mean not given; unset means 14400. A given value that is not valid is not replaced by the default (a wrong interval would silently give wrong labels, which are part of the parameter keys): the returned Promise rejects with `invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000`, before `opt.kp` and the period table are processed (so also when a valid `opt.kp` is given). `calcMa`, `calcEma` and `calcVec` convert their input data (`arr`, `key`) before they read the options, so for these three an invalid `arr` or `key` is reported before an invalid `opt.intervalSec`. `calcOrig` takes no `opt` (it has no period table), so an `opt.intervalSec` given to it is ignored.
- The bar counts are kept as they are, so the values are computed on the same number of bars at every interval (`len` and `vs` are identical to the output without `opt.intervalSec`, only `period` differs) and no period is dropped. Parameter tables (`calcKeltner`, `calcSupertrend`: `{ len, mult }`; `calcIchimoku`: `{ tenkan, kijun, senkouB }`) are kept as they are and their label follows the bar count the label stands for (`len`, or `senkouB` for `calcIchimoku`, which is the output `len`). `calcMacd` keeps its multipliers of (12, 26, 9). `calcCandle` and `calcKlr` (single bar) are labeled with the interval itself, for example `'1day'`.
- Label rule: the time span in seconds is written as `${N}day` when it is a whole number of days, otherwise `${N}hr` when it is a whole number of hours, otherwise `${N}m` (whole minutes). Every span has exactly one label, so two periods with different bar counts never get the same label at one interval. At 14400 every built-in label is reproduced (`'4hr'`, `'8hr'`, `'12hr'`, `'16hr'`, `'20hr'`, `'1day'`, `'2day'`, `'4day'`, `'7day'`, `'15day'`, `'30day'`). At 86400 every label is the 4hr label times 6: `'4hr'` → `'1day'`, `'12hr'` → `'3day'`, `'1day'` → `'6day'`, `'30day'` → `'180day'`.
- Warm-up: the bar counts are the same at every interval, so the first value of a period needs the same number of bars as on 4hr K-lines, for example `calcAdx` with `len` 180 starts at bar index 359, `calcIchimoku` with senkouB 180 at 269 and `calcMacd` with multiplier 6 at 208. On daily K-lines that is up to about one year of data before the first value. A period with too few bars returns an empty `vs`.
- `wdt.periodInfo(period, opt)` returns `{ period, bars, spanSec }` for the period label of a parameter key (only the label, which is the last `_`-separated part of the key, not the whole key) and `opt.intervalSec`; `'none'` (`calcOrig`) gives 0. For the built-in period tables `bars` is the output `len`. `opt.intervalSec` defaults to 14400 (4hr), so give the interval of the key: without it `'3day'` gives 18 bars, with `intervalSec: 86400` it gives 3 bars. It applies only to labels made from the built-in period tables, not to labels of your own table `opt.kp` (those labels are used as given and their meaning is up to the caller, they need not equal bars × interval). A label that is not a standard label (see the label rule) or whose time span is not a whole multiple of the interval throws `invalid period: must be 'none' or a period label whose time span is a multiple of opt.intervalSec`.
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
