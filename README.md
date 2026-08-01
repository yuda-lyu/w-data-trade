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
