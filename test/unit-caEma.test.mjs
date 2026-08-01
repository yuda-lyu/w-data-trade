import assert from 'assert'
import caEma from '../src/caEma.mjs'
import { genTimes, genOhlc, genFlat, genUp, valuesOf, assertNear } from './unit-setup.mjs'


//規格來源: src/caEma.mjs
//  caEma(vs, len, opt): 指數移動平均, vs 為 [{time, value}]
//  alpha = 2 / (len + 1)
//  種子 ema0 = 前 len 筆 value 之算術平均 (SMA), 對應輸出第 0 筆, time = vs[len-1].time
//  第 0 筆物件僅有 {time, param} (無 value/diff/ratio, 為既有現象, 不視為需修正之 bug)
//  第 1 筆起 (輸入索引 len..n-1): ema = value*alpha + emaPrev*(1-alpha)
//    物件為 {time, value: ema, diff: ema-現值, ratio: diff/現值 (現值為0時給0), param}
//  opt.norm=true 時 param 改為 (EMA-現值)/現值 (即以上 ratio / 第0筆之 ratioDiffEma)
//  n < len 時回傳 []
//  len 非數值時 throw


//參考實作: 依 EMA 數學定義暴力計算, 不引用 src 內部函式與結構
//  回傳每個輸出點之 { time, ema }, 索引 0 為種子 (SMA), 之後逐點遞迴
let refEmaPoints = (vs, len) => {
    let n = vs.length
    if (n < len) {
        return []
    }
    let sum = 0
    for (let i = 0; i < len; i++) {
        sum = sum + vs[i].value
    }
    let seed = sum / len
    let pts = [{ time: vs[len - 1].time, ema: seed }]
    let prev = seed
    for (let i = len; i < n; i++) {
        let cur = vs[i].value * (2 / (len + 1)) + prev * (1 - 2 / (len + 1))
        pts.push({ time: vs[i].time, ema: cur })
        prev = cur
    }
    return pts
}

//由 close 陣列與時間陣列組出 vs=[{time,value}], 不依賴 pickValue
let toVs = (times, values) => {
    let vs = []
    for (let i = 0; i < values.length; i++) {
        vs.push({ time: times[i], value: values[i] })
    }
    return vs
}


describe('caEma', function() {

    it('手算例: [1,2,3,4] len=2', function() {
        //手算: alpha=2/3
        //種子 ema0=(1+2)/2=1.5, 對應 time=第2筆(索引1)
        //第3筆(索引2, value=3): ema=3*2/3+1.5*1/3=2+0.5=2.5
        //第4筆(索引3, value=4): ema=4*2/3+2.5*1/3=2.6666...+0.8333...=3.5
        let times = genTimes(4)
        let vs = toVs(times, [1, 2, 3, 4])
        let rs = caEma(vs, 2)
        assert.strictEqual(rs.length, 3)
        assert.strictEqual(rs[0].time, times[1])
        assertNear(rs[0].param, 1.5, 1e-12, '種子')
        assert.strictEqual(rs[1].time, times[2])
        assertNear(rs[1].value, 2.5, 1e-12, '第2點')
        assertNear(rs[1].param, 2.5, 1e-12, '第2點 param')
        assertNear(rs[1].diff, 2.5 - 3, 1e-12, '第2點 diff')
        assertNear(rs[1].ratio, (2.5 - 3) / 3, 1e-12, '第2點 ratio')
        assert.strictEqual(rs[2].time, times[3])
        assertNear(rs[2].value, 3.5, 1e-12, '第3點')
        assertNear(rs[2].param, 3.5, 1e-12, '第3點 param')
    })

    it('第 0 筆物件僅含 {time, param}, 第 1 筆起含 {time, value, diff, ratio, param} (既有現象)', function() {
        let times = genTimes(4)
        let vs = toVs(times, [1, 2, 3, 4])
        let rs = caEma(vs, 2)
        assert.deepStrictEqual(Object.keys(rs[0]).sort(), ['param', 'time'])
        assert.deepStrictEqual(Object.keys(rs[1]).sort(), ['diff', 'param', 'ratio', 'time', 'value'])
        assert.deepStrictEqual(Object.keys(rs[2]).sort(), ['diff', 'param', 'ratio', 'time', 'value'])
    })

    it('n < len 時回傳空陣列', function() {
        let times = genTimes(3)
        let vs = toVs(times, [1, 2, 3])
        assert.deepStrictEqual(caEma(vs, 5), [])
    })

    it('n === len 時只回傳種子這一筆 (無後續遞迴點)', function() {
        let times = genTimes(2)
        let vs = toVs(times, [1, 2])
        let rs = caEma(vs, 2)
        assert.strictEqual(rs.length, 1)
        assertNear(rs[0].param, 1.5, 1e-12)
        assert.strictEqual(rs[0].time, times[1])
    })

    it('len 非數值時 throw', function() {
        let times = genTimes(4)
        let vs = toVs(times, [1, 2, 3, 4])
        assert.throws(() => {
            caEma(vs, '2')
        }, /len is not a number/)
        assert.throws(() => {
            caEma(vs, undefined)
        }, /len is not a number/)
    })

    it('逐點比對合成資料之 EMA 數值 (len=5, 非 norm)', function() {
        let arr = genOhlc(100)
        let ts = valuesOf(arr, 'time')
        let cs = valuesOf(arr, 'Close')
        let vs = toVs(ts, cs)
        let len = 5
        let rs = caEma(vs, len)
        let refs = refEmaPoints(vs, len)
        assert.strictEqual(rs.length, refs.length)
        assertNear(rs[0].param, refs[0].ema, 1e-9, '種子')
        assert.strictEqual(rs[0].time, refs[0].time)
        for (let i = 1; i < rs.length; i++) {
            assertNear(rs[i].value, refs[i].ema, 1e-9, `第${i}點 value`)
            assertNear(rs[i].param, refs[i].ema, 1e-9, `第${i}點 param`)
            assert.strictEqual(rs[i].time, refs[i].time)
        }
    })

    it('opt.norm=true 時 param 為 (EMA-現值)/現值, 逐點比對', function() {
        let arr = genOhlc(100)
        let ts = valuesOf(arr, 'time')
        let cs = valuesOf(arr, 'Close')
        let vs = toVs(ts, cs)
        let len = 5
        let rs = caEma(vs, len, { norm: true })
        let refs = refEmaPoints(vs, len)

        //第 0 筆: 現值為 vs[len-1].value
        let cur0 = vs[len - 1].value
        let expParam0 = cur0 !== 0 ? (refs[0].ema - cur0) / cur0 : 0
        assertNear(rs[0].param, expParam0, 1e-9, '種子 norm')

        //第 1 筆起: 現值為 vs[len-1+i].value
        for (let i = 1; i < rs.length; i++) {
            let cur = vs[len - 1 + i].value
            let expParam = cur !== 0 ? (refs[i].ema - cur) / cur : 0
            assertNear(rs[i].param, expParam, 1e-9, `第${i}點 norm`)
        }
    })

    it('norm=false (預設) 時 param 與 value 相等 (第 1 筆起)', function() {
        let arr = genOhlc(60)
        let ts = valuesOf(arr, 'time')
        let cs = valuesOf(arr, 'Close')
        let vs = toVs(ts, cs)
        let rs = caEma(vs, 6)
        for (let i = 1; i < rs.length; i++) {
            assert.strictEqual(rs[i].param, rs[i].value)
        }
    })

    it('定值序列之 EMA 恆等於該定值', function() {
        let arr = genFlat(30, 50)
        let ts = valuesOf(arr, 'time')
        let cs = valuesOf(arr, 'Close')
        let vs = toVs(ts, cs)
        let rs = caEma(vs, 6)
        rs.forEach((v) => {
            assertNear(v.param, 50, 1e-9, '定值 EMA')
        })
    })

    it('單調遞增序列之 EMA 亦嚴格遞增 (凸組合不變式)', function() {
        let arr = genUp(50, { start: 100, step: 2 })
        let ts = valuesOf(arr, 'time')
        let cs = valuesOf(arr, 'Close')
        let vs = toVs(ts, cs)
        let rs = caEma(vs, 4)
        //第0筆用 param (即 ema0), 第1筆起用 value, 串成同一序列驗證嚴格遞增
        let series = [rs[0].param]
        for (let i = 1; i < rs.length; i++) {
            series.push(rs[i].value)
        }
        for (let i = 1; i < series.length; i++) {
            assert.ok(series[i] > series[i - 1], `第${i}點應嚴格大於前一點: ${series[i]} vs ${series[i - 1]}`)
        }
    })

    it('現值為 0 時 ratio/norm-param 依規格給 0 (避免除以 0)', function() {
        let times = genTimes(3)
        //第0筆(種子)之現值為 vs[len-1].value, 令其為 0
        let vs = toVs(times, [5, 0, 10])
        let rs = caEma(vs, 2, { norm: true })
        //種子: ema0=(5+0)/2=2.5, 現值=vs[1].value=0 => 依規格 ratioDiffEma 預設 0, param=0
        assertNear(rs[0].param, 0, 1e-12, '現值為0時 norm param 應為0')
        //第2點(索引2, value=10): ema=10*2/3+2.5*1/3=6.6666...+0.8333...=7.5, 現值=10非0, 正常計算
        assertNear(rs[1].value, 7.5, 1e-9)
        let expRatio = (7.5 - 10) / 10
        assertNear(rs[1].param, expRatio, 1e-9)
    })

    it('可改用其他數值欄位來源 (以 Volumn 序列驗證與參考實作一致)', function() {
        let arr = genOhlc(40)
        let ts = valuesOf(arr, 'time')
        let vols = valuesOf(arr, 'Volumn')
        let vs = toVs(ts, vols)
        let len = 4
        let rs = caEma(vs, len)
        let refs = refEmaPoints(vs, len)
        assertNear(rs[0].param, refs[0].ema, 1e-9)
        for (let i = 1; i < rs.length; i++) {
            assertNear(rs[i].value, refs[i].ema, 1e-9)
        }
    })

})
