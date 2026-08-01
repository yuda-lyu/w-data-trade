import assert from 'assert'
import calcOrig from '../src/calcOrig.mjs'
import { genOhlc, genTimes, valuesOf, pickPeriod, assertRrsShape } from './unit-setup.mjs'


//規格來源: src/calcOrig.mjs
//  逐筆對應輸入, 不做視窗/累積運算, 亦不篩選/檢查數值合法性
//  rs[i] = { time: arr[i].time, param: arr[i][key] }
//  rrs = [ { period: 'none', len: 0, vs: rs } ]  (固定單一區塊)
let kp = {
    none: 0,
}


describe('calcOrig', function() {

    it('回傳結構須符合單一 period=none, len=0', async function() {
        let arr = genOhlc(20)
        let rrs = await calcOrig(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('每筆皆逐一對應輸入 (time 與 param 皆原樣複製, 不篩選不轉換)', async function() {
        let arr = genOhlc(20)
        let rrs = await calcOrig(arr, 'Close')
        let vs = pickPeriod(rrs, 'none').vs
        let cs = valuesOf(arr, 'Close')
        assert.strictEqual(vs.length, arr.length)
        vs.forEach((v, i) => {
            assert.strictEqual(v.time, arr[i].time, `第 ${i} 筆 time`)
            assert.strictEqual(v.param, cs[i], `第 ${i} 筆 param`)
        })
    })

    it('手算例: close=[1,2,3] 逐筆原樣輸出', async function() {
        let ts = genTimes(3)
        let arr = [
            { time: ts[0], Close: 1 },
            { time: ts[1], Close: 2 },
            { time: ts[2], Close: 3 },
        ]
        let rrs = await calcOrig(arr, 'Close')
        let vs = pickPeriod(rrs, 'none').vs
        assert.deepStrictEqual(vs, [
            { time: ts[0], param: 1 },
            { time: ts[1], param: 2 },
            { time: ts[2], param: 3 },
        ])
    })

    it('可改用其他欄位 (key=Open)', async function() {
        let arr = genOhlc(10)
        let rrs = await calcOrig(arr, 'Open')
        let vs = pickPeriod(rrs, 'none').vs
        let os = valuesOf(arr, 'Open')
        vs.forEach((v, i) => {
            assert.strictEqual(v.param, os[i], `第 ${i} 筆`)
        })
    })

    it('不篩選非數值/缺欄位: 缺 key 欄位時 param 為 undefined 但該筆仍保留', async function() {
        let ts = genTimes(3)
        let arr = [
            { time: ts[0], Close: 1 },
            { time: ts[1] }, // 缺 Close
            { time: ts[2], Close: 'not-a-number' },
        ]
        let rrs = await calcOrig(arr, 'Close')
        let vs = pickPeriod(rrs, 'none').vs
        assert.strictEqual(vs.length, 3, '不篩選, 筆數應與輸入相同')
        assert.strictEqual(vs[0].param, 1)
        assert.strictEqual(vs[1].param, undefined)
        assert.strictEqual(vs[2].param, 'not-a-number')
    })

    it('空輸入時回傳空陣列', async function() {
        let rrs = await calcOrig([], 'Close')
        assert.strictEqual(pickPeriod(rrs, 'none').vs.length, 0)
    })

})
