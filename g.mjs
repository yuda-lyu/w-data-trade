import wdt from './src/WDataTrade.mjs'


async function test() {

    //arr, 4hr K 線之示範資料, calcMa 只取用 time 與指定欄位(此處為 Close)
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
    //  len 為該期涵蓋之 K 線根數(1day = 6 根 4hr K 線), 資料不足該期長度時 vs 為空陣列
    //  vs 內每筆為 { time, param }, param 為自該根收盤往前 len 根之算術平均
    let rs = await wdt.calcMa(arr, 'Close')
    console.log(rs.map((v) => {
        return `${v.period}(len=${v.len}): ${v.vs.length} 筆`
    }))
    // => [
    //   '1day(len=6): 3 筆',
    //   '2day(len=12): 0 筆',
    //   '4day(len=24): 0 筆',
    //   '7day(len=42): 0 筆',
    //   '15day(len=90): 0 筆',
    //   '30day(len=180): 0 筆'
    // ]

    //1day 期之逐根均線值, 第一筆對應第 6 根(index 5)
    //  7198.835 = (7173.32+7195.23+7225.01+7209.83+7188.77+7200.85) / 6
    console.log(rs[0].vs)
    // => [
    //   { time: '2020-01-01T20:00:00', param: 7198.835 },
    //   { time: '2020-01-02T00:00:00', param: 7196.021666666667 },
    //   { time: '2020-01-02T04:00:00', param: 7185.153333333333 }
    // ]

    //opt.norm=true 時 param 改為「均線與現價之偏離比例」= (MA - 現價) / 現價
    //  -0.00027982... = (7198.835 - 7200.85) / 7200.85, 現價高於均線故為負
    let rsNorm = await wdt.calcMa(arr, 'Close', { norm: true })
    console.log(rsNorm[0].vs)
    // => [
    //   { time: '2020-01-01T20:00:00', param: -0.0002798280758522018 },
    //   { time: '2020-01-02T00:00:00', param: 0.0055309157439547936 },
    //   { time: '2020-01-02T04:00:00', param: 0.007732563630022398 }
    // ]

}
test()
    .catch((err) => {
        console.log('catch', err)
    })


//node g.mjs
