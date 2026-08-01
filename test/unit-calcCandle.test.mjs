import assert from 'assert'
import calcCandle from '../src/calcCandle.mjs'
import { genFlat, genTimes, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertRange } from './unit-setup.mjs'


//規格來源: src/calcCandle.mjs
//  kp: { '4hr': 1 } (K 線型態只看當下這根本身, 無 period 累積)
//  需至少 2 根 (engulfStrength 需前一根), 故輸出自輸入第 2 根 (index 1) 起算
//  range = High - Low; body = |Close - Open|
//  upperWick = High - max(Open,Close); lowerWick = min(Open,Close) - Low
//  bodyRatio = body / range;  upperWickRatio = upperWick / range;  lowerWickRatio = lowerWick / range
//  candleDir = (Close - Open) / range  (方向 + 強度, -1~+1)
//  以上四值於 range===0 時皆設為 0
//  engulfStrength: 令 signCurr=sign(Close-Open), signPrev=sign(prevClose-prevOpen), prevRange=prevHigh-prevLow
//    signCurr!==0 且 signPrev!==0 且 signCurr!==signPrev 且 prevRange>0 時, engulfStrength = signCurr × body/prevRange
//    否則 engulfStrength = 0
//  Open/High/Low/Close 非數值時 throw
let kp = {
    '4hr': 1,
}

//小工具: 依單根 OHLC 造出 {time,Open,High,Low,Close}
let bar = (time, o, h, l, c) => {
    return { time, Open: o, High: h, Low: l, Close: c }
}


describe('calcCandle', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let ts = genTimes(5)
        let arr = [
            bar(ts[0], 10, 12, 9, 11),
            bar(ts[1], 11, 13, 10, 12),
            bar(ts[2], 12, 15, 11, 13),
            bar(ts[3], 13, 14, 10, 10.5),
            bar(ts[4], 10.5, 11, 9, 9.5),
        ]
        let rrs = await calcCandle(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('時間軸自輸入第 2 根 (index 1) 起算並逐根對齊', async function() {
        let ts = genTimes(5)
        let arr = [
            bar(ts[0], 10, 12, 9, 11),
            bar(ts[1], 11, 13, 10, 12),
            bar(ts[2], 12, 15, 11, 13),
            bar(ts[3], 13, 14, 10, 10.5),
            bar(ts[4], 10.5, 11, 9, 9.5),
        ]
        let rrs = await calcCandle(arr, 'Close')
        let r = pickPeriod(rrs, '4hr')
        assertTimeAlign(r.vs, arr, 1)
    })

    it('手算例: O=10,H=14,L=8,C=12 之三比例與方向', async function() {
        // range=14-8=6, body=|12-10|=2, upperWick=14-12=2, lowerWick=10-8=2
        // bodyRatio=2/6=1/3, upperWickRatio=2/6=1/3, lowerWickRatio=2/6=1/3, candleDir=2/6=1/3
        let ts = genTimes(2)
        let arr = [
            bar(ts[0], 20, 22, 13, 15), // prev: 陰線 (pC-pO=15-20=-5)
            bar(ts[1], 10, 14, 8, 12), // curr
        ]
        let rrs = await calcCandle(arr, 'Close')
        let v = pickPeriod(rrs, '4hr').vs[0]
        assertNear(v.bodyRatio, 1 / 3, 1e-12, 'bodyRatio')
        assertNear(v.upperWickRatio, 1 / 3, 1e-12, 'upperWickRatio')
        assertNear(v.lowerWickRatio, 1 / 3, 1e-12, 'lowerWickRatio')
        assertNear(v.candleDir, 1 / 3, 1e-12, 'candleDir')
    })

    it('手算例: engulfStrength (雙根反向) = signCurr × body/prevRange', async function() {
        // prev: O=20,H=22,L=13,C=15 (陰線, prevRange=22-13=9)
        // curr: O=10,H=14,L=8,C=12 (陽線, body=2)
        // signCurr=+1, signPrev=-1, 反向且 prevRange>0 => engulfStrength = 1*(2/9) = 2/9
        let ts = genTimes(2)
        let arr = [
            bar(ts[0], 20, 22, 13, 15),
            bar(ts[1], 10, 14, 8, 12),
        ]
        let rrs = await calcCandle(arr, 'Close')
        let v = pickPeriod(rrs, '4hr').vs[0]
        assertNear(v.engulfStrength, 2 / 9, 1e-12, 'engulfStrength')
    })

    it('雙根同向時 engulfStrength = 0', async function() {
        // prev: O=5,H=9,L=4,C=8 (陽線), curr: O=10,H=14,L=8,C=12 (陽線), 同向
        let ts = genTimes(2)
        let arr = [
            bar(ts[0], 5, 9, 4, 8),
            bar(ts[1], 10, 14, 8, 12),
        ]
        let rrs = await calcCandle(arr, 'Close')
        let v = pickPeriod(rrs, '4hr').vs[0]
        assert.strictEqual(v.engulfStrength, 0)
    })

    it('定值 K 線 (range=0) 時四值皆為 0, engulfStrength 亦為 0', async function() {
        let arr = genFlat(5, 100)
        let rrs = await calcCandle(arr, 'Close')
        let vs = pickPeriod(rrs, '4hr').vs
        vs.forEach((v, i) => {
            assert.strictEqual(v.bodyRatio, 0, `第 ${i} 筆 bodyRatio`)
            assert.strictEqual(v.upperWickRatio, 0, `第 ${i} 筆 upperWickRatio`)
            assert.strictEqual(v.lowerWickRatio, 0, `第 ${i} 筆 lowerWickRatio`)
            assert.strictEqual(v.candleDir, 0, `第 ${i} 筆 candleDir`)
            assert.strictEqual(v.engulfStrength, 0, `第 ${i} 筆 engulfStrength`)
        })
    })

    it('不變式: 三比例皆屬 [0,1], candleDir 屬 [-1,1], 三比例合計為 1 且 |candleDir|=bodyRatio', async function() {
        let ts = genTimes(6)
        let arr = [
            bar(ts[0], 10, 12, 9, 11),
            bar(ts[1], 11, 13, 10, 12),
            bar(ts[2], 12, 15, 11, 13),
            bar(ts[3], 13, 14, 10, 10.5),
            bar(ts[4], 10.5, 11, 9, 9.5),
            bar(ts[5], 9.5, 16, 5, 15),
        ]
        let rrs = await calcCandle(arr, 'Close')
        let vs = pickPeriod(rrs, '4hr').vs
        assertRange(vs, 'bodyRatio', 0, 1, 'bodyRatio')
        assertRange(vs, 'upperWickRatio', 0, 1, 'upperWickRatio')
        assertRange(vs, 'lowerWickRatio', 0, 1, 'lowerWickRatio')
        assertRange(vs, 'candleDir', -1, 1, 'candleDir')
        vs.forEach((v, i) => {
            assertNear(v.bodyRatio + v.upperWickRatio + v.lowerWickRatio, 1, 1e-9, `第 ${i} 筆三比例合計`)
            assertNear(Math.abs(v.candleDir), v.bodyRatio, 1e-9, `第 ${i} 筆 |candleDir|=bodyRatio`)
        })
    })

    it('資料筆數少於 2 根時回傳空陣列', async function() {
        let ts = genTimes(1)
        let arr = [bar(ts[0], 10, 12, 9, 11)]
        let rrs = await calcCandle(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '4hr').vs.length, 0)
    })

    it('Open/High/Low/Close 為非數值時應 throw', async function() {
        let ts = genTimes(2)
        let base = bar(ts[0], 10, 12, 9, 11)
        let keys = ['Open', 'High', 'Low', 'Close']
        for (let key of keys) {
            let bad = bar(ts[1], 11, 13, 10, 12)
            bad[key] = 'not-a-number'
            let arr = [base, bad]
            await assert.rejects(calcCandle(arr, 'Close'), `${key} 非數值應 throw`)
        }
    })

})
