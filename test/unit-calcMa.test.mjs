import assert from 'assert'
import calcMa from '../src/calcMa.mjs'
import { genOhlc, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcMa.mjs
//  MA(len) = 最近 len 根之算術平均, 第一筆對應輸入索引 len-1
//  param 預設為 MA 值; opt.norm=true 時改為 (MA - 現值) / 現值 (現值為 0 時給 0)
//  n < len 時該期回傳 []
let kp = {
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
    '15day': 90, // 15 days = 90 * 4 hours
    '30day': 180, // 30 days = 180 * 4 hours
}

//參考實作: 直接照定義暴力計算移動平均
let refMa = (cs, len) => {
    let rs = []
    for (let i = len - 1; i < cs.length; i++) {
        let sum = 0
        for (let j = i - len + 1; j <= i; j++) {
            sum += cs[j]
        }
        rs.push(sum / len)
    }
    return rs
}


describe('calcMa', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMa(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMa(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('param 須等於最近 len 根收盤價之算術平均', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcMa(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'param', refMa(cs, len), 1e-12, period)
        })
    })

    it('手算例: 收盤 1..6 之 6 根平均為 3.5, 且僅 1day 有輸出', async function() {
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6])
        let rrs = await calcMa(arr, 'Close')
        let r1 = pickPeriod(rrs, '1day')
        assert.strictEqual(r1.vs.length, 1)
        assertNear(r1.vs[0].param, 3.5, 1e-12, '1day')
        assert.strictEqual(r1.vs[0].time, arr[5].time)
        assert.strictEqual(pickPeriod(rrs, '2day').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '30day').vs.length, 0)
    })

    it('opt.norm=true 時 param 為 (MA-現值)/現值', async function() {
        let arr = genOhlc(100)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcMa(arr, 'Close', { norm: true })
        let len = kp['1day']
        let r = pickPeriod(rrs, '1day')
        let mas = refMa(cs, len)
        let exps = mas.map((ma, i) => {
            let c = cs[i + len - 1]
            return (ma - c) / c
        })
        assertNearAll(r.vs, 'param', exps, 1e-12, '1day norm')
    })

    it('定值序列之 MA 等於該定值', async function() {
        let arr = ohlcFromCloses(new Array(30).fill(50), { wick: 0 })
        let rrs = await calcMa(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.param, 50, 1e-12, '定值')
        })
    })

    it('資料筆數少於 len 時該期回傳空陣列', async function() {
        let arr = genOhlc(5)
        let rrs = await calcMa(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('可改用其他數值欄位計算 (key=Open)', async function() {
        let arr = genOhlc(50)
        let os = valuesOf(arr, 'Open')
        let rrs = await calcMa(arr, 'Open')
        assertNearAll(pickPeriod(rrs, '1day').vs, 'param', refMa(os, 6), 1e-12, 'Open')
    })

})
