import assert from 'assert'
import calcRsi from '../src/calcRsi.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcRsi.mjs (Wilder RSI)
//  diff(i) = Close(i) - Close(i-1), up = max(diff,0), down = max(-diff,0), 自 i=1 起算
//  種子(opt.seed 預設 'sma'): avgGain = up[1..len] 之 SMA, avgLoss = down[1..len] 之 SMA
//  種子(opt.seed='first'): avgGain = up[1], avgLoss = down[1], 再以 Wilder 遞推至 len
//  遞推: avg = (avgPrev*(len-1) + x) / len
//  RS = avgGain / avgLoss, RSI = 100 - 100/(1+RS)
//  邊界(以 opt.eps 為零之判準, 預設 1e-12):
//    avgGain 與 avgLoss 皆視為零 → RSI = 50 (完全平盤)
//    僅 avgLoss 視為零 → RSI = 100 (一路上漲)
//    僅 avgGain 視為零 → RSI = 0 (一路下跌)
//  第一筆對應輸入索引 len, n < len+1 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
}

//參考實作: 逐根漲跌幅, 索引 0 無前一根故為 0
let refUpDowns = (cs) => {
    let ups = [0]
    let downs = [0]
    for (let i = 1; i < cs.length; i++) {
        let d = cs[i] - cs[i - 1]
        ups.push(d > 0 ? d : 0)
        downs.push(d < 0 ? -d : 0)
    }
    return { ups, downs }
}

//參考實作: 依 RSI 定義暴力算出各根之 { RSI, avgGain, avgLoss }, 自索引 len 起
let refRsis = (cs, len, opt = {}) => {
    let seed = opt.seed !== undefined ? opt.seed : 'sma'
    let eps = opt.eps !== undefined ? opt.eps : 1e-12
    if (cs.length < len + 1) {
        return []
    }
    let { ups, downs } = refUpDowns(cs)

    //種子
    let g = 0
    let l = 0
    if (seed === 'first') {
        g = ups[1]
        l = downs[1]
        for (let i = 2; i <= len; i++) {
            g = ((g * (len - 1)) + ups[i]) / len
            l = ((l * (len - 1)) + downs[i]) / len
        }
    }
    else {
        let sg = 0
        let sl = 0
        for (let i = 1; i <= len; i++) {
            sg += ups[i]
            sl += downs[i]
        }
        g = sg / len
        l = sl / len
    }

    //RSI 值
    let toRsi = (gg, ll) => {
        if (gg <= eps && ll <= eps) {
            return 50
        }
        if (ll <= eps) {
            return 100
        }
        if (gg <= eps) {
            return 0
        }
        return 100 - (100 / (1 + (gg / ll)))
    }

    //自索引 len 起逐根遞推
    let rs = [{ RSI: toRsi(g, l), rsiAvgGain: g, rsiAvgLoss: l }]
    for (let i = len + 1; i < cs.length; i++) {
        g = ((g * (len - 1)) + ups[i]) / len
        l = ((l * (len - 1)) + downs[i]) / len
        rs.push({ RSI: toRsi(g, l), rsiAvgGain: g, rsiAvgLoss: l })
    }
    return rs
}


describe('calcRsi', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcRsi(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊(需 len+1 根才有第一筆)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcRsi(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('RSI 與平均漲跌須符合 Wilder 定義 (種子為 SMA, 其後遞推)', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcRsi(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refRsis(cs, len)
            assertNearAll(r.vs, 'RSI', exps.map((v) => {
                return v.RSI
            }), 1e-12, period)
            assertNearAll(r.vs, 'rsiAvgGain', exps.map((v) => {
                return v.rsiAvgGain
            }), 1e-12, period)
            assertNearAll(r.vs, 'rsiAvgLoss', exps.map((v) => {
                return v.rsiAvgLoss
            }), 1e-12, period)
        })
    })

    it('手算例: 收盤 [10,11,10.5,12,11,11.5] 於 len=3 之 RSI', async function() {
        //diff:  +1, -0.5, +1.5, -1, +0.5
        //up:     1,    0,  1.5,  0, 0.5
        //down:   0,  0.5,    0,  1,   0
        //種子(i3): avgGain = (1+0+1.5)/3 = 5/6, avgLoss = (0+0.5+0)/3 = 1/6
        //          RS = 5, RSI = 100 - 100/6 = 250/3
        //   (i4): avgGain = ((5/6)*2+0)/3 = 5/9, avgLoss = ((1/6)*2+1)/3 = 4/9
        //          RS = 5/4, RSI = 100 - 100/(9/4) = 500/9
        //   (i5): avgGain = ((5/9)*2+0.5)/3 = 29/54, avgLoss = ((4/9)*2+0)/3 = 16/54
        //          RS = 29/16, RSI = 100 - 100/(45/16) = 580/9
        let arr = ohlcFromCloses([10, 11, 10.5, 12, 11, 11.5])
        let rrs = await calcRsi(arr, 'Close')

        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 3)

        let v0 = r3.vs[0]
        assert.strictEqual(v0.time, arr[3].time)
        assertNear(v0.RSI, 250 / 3, 1e-12, '手算 RSI(i3)')
        assertNear(v0.rsiAvgGain, 5 / 6, 1e-12, '手算 avgGain(i3)')
        assertNear(v0.rsiAvgLoss, 1 / 6, 1e-12, '手算 avgLoss(i3)')
        assertNear(v0.rsiUp, 1.5, 1e-12, '手算 rsiUp(i3)')
        assertNear(v0.rsiDown, 0, 1e-12, '手算 rsiDown(i3)')

        let v1 = r3.vs[1]
        assertNear(v1.RSI, 500 / 9, 1e-12, '手算 RSI(i4)')
        assertNear(v1.rsiAvgGain, 5 / 9, 1e-12, '手算 avgGain(i4)')
        assertNear(v1.rsiAvgLoss, 4 / 9, 1e-12, '手算 avgLoss(i4)')
        assertNear(v1.rsiUp, 0, 1e-12, '手算 rsiUp(i4)')
        assertNear(v1.rsiDown, 1, 1e-12, '手算 rsiDown(i4)')

        let v2 = r3.vs[2]
        assertNear(v2.RSI, 580 / 9, 1e-12, '手算 RSI(i5)')
        assertNear(v2.rsiAvgGain, 29 / 54, 1e-12, '手算 avgGain(i5)')
        assertNear(v2.rsiAvgLoss, 16 / 54, 1e-12, '手算 avgLoss(i5)')
        assertNear(v2.rsiUp, 0.5, 1e-12, '手算 rsiUp(i5)')
        assertNear(v2.rsiDown, 0, 1e-12, '手算 rsiDown(i5)')

        //len=6: n=6 < len+1=7 → 空
        assert.strictEqual(pickPeriod(rrs, '1day').vs.length, 0)
    })

    it('rsiUp 與 rsiDown 須為當根收盤之漲幅與跌幅', async function() {
        let arr = genOhlc(120)
        let cs = valuesOf(arr, 'Close')
        let { ups, downs } = refUpDowns(cs)
        let rrs = await calcRsi(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let vs = pickPeriod(rrs, period).vs
            assertNearAll(vs, 'rsiUp', ups.slice(len), 1e-12, period)
            assertNearAll(vs, 'rsiDown', downs.slice(len), 1e-12, period)
        })
    })

    it('opt.seed=first 時種子改為首根漲跌再遞推至 len', async function() {
        //同上手算例, len=3, seed=first:
        //  avgGain: up[1]=1 → i2: (1*2+0)/3 = 2/3 → i3: ((2/3)*2+1.5)/3 = 17/18
        //  avgLoss: down[1]=0 → i2: (0*2+0.5)/3 = 1/6 → i3: ((1/6)*2+0)/3 = 1/9
        //  RS = (17/18)/(1/9) = 17/2, RSI = 100 - 100/(19/2) = 1700/19
        let arr = ohlcFromCloses([10, 11, 10.5, 12, 11, 11.5])
        let rrs = await calcRsi(arr, 'Close', { seed: 'first' })
        let v0 = pickPeriod(rrs, '12hr').vs[0]
        assertNear(v0.rsiAvgGain, 17 / 18, 1e-12, 'seed=first avgGain(i3)')
        assertNear(v0.rsiAvgLoss, 1 / 9, 1e-12, 'seed=first avgLoss(i3)')
        assertNear(v0.RSI, 1700 / 19, 1e-12, 'seed=first RSI(i3)')
    })

    it('opt.seed=first 之全序列須符合以首根為種子之遞推定義', async function() {
        let arr = genOhlc(120)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcRsi(arr, 'Close', { seed: 'first' })
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'RSI', refRsis(cs, len, { seed: 'first' }).map((v) => {
                return v.RSI
            }), 1e-12, period)
        })
    })

    it('opt.eps 為視為零之門檻: avgLoss 低於 eps 即判為一路上漲之 RSI=100', async function() {
        //同手算例 len=3: avgGain=5/6≈0.8333, avgLoss=1/6≈0.1667
        //  eps=0.2 → avgLoss<=eps 而 avgGain>eps → 依規格給 100
        let arr = ohlcFromCloses([10, 11, 10.5, 12, 11, 11.5])
        let rrs = await calcRsi(arr, 'Close', { eps: 0.2 })
        let v0 = pickPeriod(rrs, '12hr').vs[0]
        assert.strictEqual(v0.RSI, 100)
        //預設 eps 下同一筆為 250/3, 證明差異來自 eps
        let rrsDef = await calcRsi(arr, 'Close')
        assertNear(pickPeriod(rrsDef, '12hr').vs[0].RSI, 250 / 3, 1e-12, '預設 eps')
    })

    it('opt.eps 大於漲跌動能時兩者皆視為零, RSI 給 50', async function() {
        let arr = ohlcFromCloses([10, 11, 10.5, 12, 11, 11.5])
        let rrs = await calcRsi(arr, 'Close', { eps: 10 })
        pickPeriod(rrs, '12hr').vs.forEach((v, i) => {
            assert.strictEqual(v.RSI, 50, `第 ${i} 筆`)
        })
    })

    it('定值序列無漲跌動能, RSI 恆為 50', async function() {
        let arr = genFlat(40, 100)
        let rrs = await calcRsi(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assert.strictEqual(v.RSI, 50, `第 ${i} 筆`)
            assert.strictEqual(v.rsiAvgGain, 0, `第 ${i} 筆 avgGain`)
            assert.strictEqual(v.rsiAvgLoss, 0, `第 ${i} 筆 avgLoss`)
        })
    })

    it('單調上升序列之 avgLoss 為 0, RSI 恆為 100 且 avgGain 恆為 step', async function() {
        let step = 3
        let arr = genUp(40, { step })
        let rrs = await calcRsi(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assert.strictEqual(v.RSI, 100, `第 ${i} 筆`)
            assertNear(v.rsiAvgGain, step, 1e-12, `第 ${i} 筆 avgGain`)
            assert.strictEqual(v.rsiAvgLoss, 0, `第 ${i} 筆 avgLoss`)
        })
    })

    it('單調下降序列之 avgGain 為 0, RSI 恆為 0 且 avgLoss 恆為 step', async function() {
        let step = 3
        let arr = genDown(40, { step })
        let rrs = await calcRsi(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assert.strictEqual(v.RSI, 0, `第 ${i} 筆`)
            assert.strictEqual(v.rsiAvgGain, 0, `第 ${i} 筆 avgGain`)
            assertNear(v.rsiAvgLoss, step, 1e-12, `第 ${i} 筆 avgLoss`)
        })
    })

    it('RSI 恆落在 [0,100], 平均漲跌與單根漲跌恆為非負', async function() {
        let arr = genOhlc(200)
        let rrs = await calcRsi(arr, 'Close')
        rrs.forEach((r) => {
            assertRange(r.vs, 'RSI', 0, 100, r.period)
            assertRange(r.vs, 'rsiAvgGain', 0, Infinity, r.period)
            assertRange(r.vs, 'rsiAvgLoss', 0, Infinity, r.period)
            assertRange(r.vs, 'rsiUp', 0, Infinity, r.period)
            assertRange(r.vs, 'rsiDown', 0, Infinity, r.period)
        })
    })

    it('資料筆數少於 len+1 時該期回傳空陣列', async function() {
        //最短之 len 為 3, 需 4 根, 故 3 根時各期皆空
        let arr = genOhlc(3)
        let rrs = await calcRsi(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('恰為 len+1 根時該期輸出 1 筆', async function() {
        let arr = genOhlc(4)
        let rrs = await calcRsi(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '12hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('Close 非數值時須拋錯', async function() {
        let arr = genOhlc(20)
        arr[3].Close = null
        await assert.rejects(async () => {
            await calcRsi(arr, 'Close')
        }, /invalid c/)
    })

})
