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
//len 為該期涵蓋之 K 線根數(1day = 6 根 4hr K 線), 資料不足該期長度時 vs 為空陣列
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

#### Example for other K-line intervals (opt.barsPerDay, opt.kp):
Every `calc*` function except `calcOrig` has a built-in period table written for 4hr K-lines (6 bars per day): the period labels (`'1day'`, `'12hr'`, ...) are time spans and the values are bar counts. Pass `opt.barsPerDay` (bars per day) to calculate on another K-line interval with the same labels.
```alias
import wdt from 'w-data-trade'

//arr1h, 1hr K 線資料(每日 24 根), 各期標籤維持時間語意('1day' 仍是一天), 根數依比例換算('1day' => 24 根)
wdt.calcMa(arr1h, 'Close', { barsPerDay: 24 })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '1day:24', '2day:48', '4day:96', '7day:168', '15day:360', '30day:720' ]
    })

//arr1d, 日 K 線資料(每日 1 根), 換算後不足 1 根之週期('12hr'、'16hr'、'20hr')被剔除
wdt.calcRsi(arr1d, 'Close', { barsPerDay: 1 })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '1day:1', '2day:2', '4day:4', '7day:7' ]
    })

//opt.kp, 自訂週期表(正整數根數), 直接採用不換算, 週期標籤即為輸出之 period
wdt.calcMa(arr, 'Close', { kp: { '3day': 18, '5day': 30 } })
    .then((rs) => {
        console.log(rs.map((v) => `${v.period}:${v.len}`))
        // => [ '3day:18', '5day:30' ]
    })

```
- `opt.barsPerDay`: bars per day of the K-line interval (4hr = 6, 1hr = 24, 30m = 48, 15m = 96, 5m = 288, 1day = 1), a number or numeric string greater than 0 and at most 86400. Unset or `6` keeps the built-in table, and the output is identical to the output without this option.
- Conversion: the bar count of each period (for parameter tables `len`, `tenkan`, `kijun`, `senkouB`; multipliers such as `mult` are not scaled) is multiplied by `barsPerDay / 6` and rounded half up. A period shorter than one bar (below 1 before rounding) is dropped. If every period is dropped the returned Promise rejects with `invalid opt.barsPerDay: must keep at least one period of at least 1 bar`.
- `calcMacd` uses the bar count as a multiplier of its (12, 26, 9) periods, so it is scaled the same way: on 1hr K-lines `'4hr'` has `len` 4, meaning a fast period of 48 bars, which is the same 48 hours as `len` 1 (12 bars) on 4hr K-lines.
- `calcCandle` and `calcKlr` (single-bar tables) are not scaled, only the label changes to the K-line interval, for example `'4hr'` becomes `'1hr'`, `'30m'` or `'1day'`.
- Neighbouring periods may get the same bar count after rounding. The labels are kept as they are and never merged, so a label always means the same time span. For example with `barsPerDay: 2` (12hr K-lines) `'12hr'` and `'16hr'` are both 1 bar and `'20hr'` and `'1day'` are both 2 bars, and with `barsPerDay: 4` (6hr K-lines) `'16hr'` and `'20hr'` are both 3 bars. This does not happen with `barsPerDay` 1, 24, 48, 96 or 288. Their outputs are identical, except for `calcKeltner` and `calcSupertrend` where `mult` differs, so filter duplicates in your own code if you do not want them.
- `opt.kp`: your own period table, used as given and never scaled (also when `barsPerDay` is given). Values are positive integer bar counts, or for the parameter tables `{ len, mult }` (`calcKeltner`, `calcSupertrend`) and `{ tenkan, kijun, senkouB }` (`calcIchimoku`).
- An unexpected `opt.barsPerDay` or `opt.kp` (for example `0`, `-1`, `'abc'`, `Infinity`, a non-integer bar count) is treated as not given and the default is used, no error is thrown. Set `opt.debug` to `true` to get one warning per key and process, printed with `console.warn` or passed to `opt.funLog(msg, { fn, reason, key })` when it is a function. The warning never contains the given value.
- `wdt.resolvePeriods(kp, opt)` is the function that all calc functions use to get their period table from the built-in table and `opt`.

#### dataConvert and dataCalibrate with other K-line intervals:
`methods[i].optMethod` of `dataConvert` and `optMethodInit` / `optMethodRef` of `dataCalibrate` are passed to the calc function unchanged, so put `barsPerDay` there.
```alias
//dataConvert, 1hr K 線
let methods = [
    {
        method: 'ma',
        deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }],
        optMethod: { barsPerDay: 24 },
    },
]

//dataCalibrate, 以 opt.params 排除 barsPerDay(預設會搜尋 optMethodInit 全部鍵), 參考側 optMethodRef 亦須給
let rs = await wdt.dataCalibrate(calcFn, arrSrc, arrRef, ['param'], { barsPerDay: 24, plusClose: 0 }, { params: ['plusClose'], optMethodRef: { barsPerDay: 24 } })
```
- The output file names of `dataConvert` contain the period label only (for example `..._ma_1day.json`), so the same label on different K-line intervals gives the same file name. Use a different output folder for each interval.
- `dataCalibrate` searches every key of `optMethodInit` unless `opt.params` is given, so list the keys to search in `opt.params` and leave `barsPerDay` out. The reference side uses `opt.optMethodRef` (default `{}`), so give `barsPerDay` there too when the reference data has the same interval.
