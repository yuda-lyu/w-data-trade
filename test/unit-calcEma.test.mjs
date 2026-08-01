import assert from 'assert'
import calcEma from '../src/calcEma.mjs'
import { genOhlc, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcEma.mjs 與其呼叫之 src/caEma.mjs
//  alpha = 2 / (len + 1)
//  第一筆為種子: EMA(len-1) = 前 len 筆之簡單平均(SMA), 該筆物件僅有 { time, param }
//  其後遞推: EMA(i) = value(i) * alpha + EMA(i-1) * (1 - alpha), 物件為 { time, value, diff, ratio, param }
//  diff = EMA - 現值, ratio = diff / 現值 (現值為 0 時給 0)
//  param 預設為 EMA 值; opt.norm=true 時改為 ratio
//  n < len 時該期回傳 []
let kp = {
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
    '15day': 90, // 15 days = 90 * 4 hours
    '30day': 180, // 30 days = 180 * 4 hours
}

//參考實作: 直接照 EMA 定義遞推, 種子取前 len 筆 SMA
//回傳陣列第 0 筆對應輸入索引 len-1
let refEma = (cs, len) => {
    if (cs.length < len) {
        return []
    }
    let alpha = 2 / (len + 1)
    let sum = 0
    for (let i = 0; i < len; i++) {
        sum += cs[i]
    }
    let e = sum / len
    let rs = [e]
    for (let i = len; i < cs.length; i++) {
        e = cs[i] * alpha + e * (1 - alpha)
        rs.push(e)
    }
    return rs
}


describe('calcEma', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(400)
        let rrs = await calcEma(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(400)
        let rrs = await calcEma(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('param 須符合 EMA 遞推 (種子為前 len 筆 SMA, alpha=2/(len+1))', async function() {
        let arr = genOhlc(400)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcEma(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'param', refEma(cs, len), 1e-12, period)
        })
    })

    it('第一筆為 SMA 種子(僅有 time 與 param), 其後各筆另有 value/diff/ratio', async function() {
        let arr = genOhlc(50)
        let cs = valuesOf(arr, 'Close')
        let len = kp['1day']
        let r = pickPeriod(await calcEma(arr, 'Close'), '1day')

        //第一筆: 種子為前 len 筆 SMA, 且不帶 value/diff/ratio
        let sma = cs.slice(0, len).reduce((a, b) => {
            return a + b
        }, 0) / len
        assertNear(r.vs[0].param, sma, 1e-12, '種子')
        assert.strictEqual(r.vs[0].value, undefined, '種子筆不應有 value')
        assert.strictEqual(r.vs[0].diff, undefined, '種子筆不應有 diff')
        assert.strictEqual(r.vs[0].ratio, undefined, '種子筆不應有 ratio')

        //其後各筆: value 即 EMA, param 同 value
        r.vs.slice(1).forEach((v, i) => {
            assert.strictEqual(typeof v.value, 'number', `第 ${i + 1} 筆應有 value`)
            assertNear(v.param, v.value, 1e-12, `第 ${i + 1} 筆 param 應等於 value`)
        })
    })

    it('diff 與 ratio 須為 EMA 與現值之差及其比值', async function() {
        let arr = genOhlc(50)
        let cs = valuesOf(arr, 'Close')
        let len = kp['1day']
        let r = pickPeriod(await calcEma(arr, 'Close'), '1day')
        r.vs.slice(1).forEach((v, i) => {
            let c = cs[i + len] //第 0 筆對應索引 len-1, 故 slice(1) 之第 i 筆對應索引 len+i
            assertNear(v.diff, v.value - c, 1e-12, `第 ${i + 1} 筆 diff`)
            assertNear(v.ratio, (v.value - c) / c, 1e-12, `第 ${i + 1} 筆 ratio`)
        })
    })

    it('手算例: 收盤 1..8 於 1day(len=6) 之 EMA 為 3.5, 4.5, 5.5', async function() {
        //手算: cs = [1,2,3,4,5,6,7,8], len=6, alpha = 2/(6+1) = 2/7, 1-alpha = 5/7
        //  種子(索引5) = (1+2+3+4+5+6)/6 = 21/6 = 3.5
        //  索引6 = 7*(2/7) + 3.5*(5/7) = 2 + 2.5 = 4.5
        //  索引7 = 8*(2/7) + 4.5*(5/7) = 16/7 + 22.5/7 = 38.5/7 = 5.5
        //  diff(索引6) = 4.5 - 7 = -2.5, ratio(索引6) = -2.5/7
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6, 7, 8])
        let rrs = await calcEma(arr, 'Close')
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 3)
        assertNearAll(r.vs, 'param', [3.5, 4.5, 5.5], 1e-12, '手算')
        assert.strictEqual(r.vs[0].time, arr[5].time)
        assert.strictEqual(r.vs[2].time, arr[7].time)
        assertNear(r.vs[1].diff, -2.5, 1e-12, '手算 diff')
        assertNear(r.vs[1].ratio, -2.5 / 7, 1e-12, '手算 ratio')

        //len 大於資料筆數之各期皆為空
        assert.strictEqual(pickPeriod(rrs, '2day').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '30day').vs.length, 0)
    })

    it('opt.norm=true 時 param 為 (EMA-現值)/現值', async function() {
        let arr = genOhlc(100)
        let cs = valuesOf(arr, 'Close')
        let len = kp['1day']
        let rrs = await calcEma(arr, 'Close', { norm: true })
        let r = pickPeriod(rrs, '1day')
        let emas = refEma(cs, len)
        let exps = emas.map((e, i) => {
            let c = cs[i + len - 1]
            return (e - c) / c
        })
        assertNearAll(r.vs, 'param', exps, 1e-12, '1day norm')
    })

    it('定值序列之 EMA 等於該定值', async function() {
        //定值 v 時: 種子 = v, 遞推 = v*alpha + v*(1-alpha) = v
        let arr = ohlcFromCloses(new Array(30).fill(50), { wick: 0 })
        let rrs = await calcEma(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.param, 50, 1e-12, '定值')
        })
    })

    it('資料筆數少於 len 時該期回傳空陣列', async function() {
        let arr = genOhlc(5)
        let rrs = await calcEma(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('可改用其他數值欄位計算 (key=Open)', async function() {
        let arr = genOhlc(50)
        let os = valuesOf(arr, 'Open')
        let rrs = await calcEma(arr, 'Open')
        assertNearAll(pickPeriod(rrs, '1day').vs, 'param', refEma(os, 6), 1e-12, 'Open')
    })

    it('指定欄位不存在時各期皆回傳空陣列', async function() {
        //pickValue 僅收 isNumber 之值, 欄位不存在則取樣結果為空
        let arr = genOhlc(50)
        let rrs = await calcEma(arr, 'NotExistKey')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('輸入非有效陣列或 key 非有效字串時拋錯', async function() {
        await assert.rejects(calcEma([], 'Close'), /invalid arr/)
        await assert.rejects(calcEma(genOhlc(10), ''), /invalid key/)
    })

})
