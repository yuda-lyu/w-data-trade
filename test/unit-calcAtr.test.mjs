import assert from 'assert'
import calcAtr from '../src/calcAtr.mjs'
import { genOhlc, genFlat, genUp, genDown, genTimes, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcAtr.mjs
//  TR(i) = max(|H-L|, |H-Cprev|, |L-Cprev|), 自 i=1 起算(需前一根 Close)
//  ATR 種子 = TR[1..len] 之 SMA, 其後 Wilder 平滑: ATR = (ATRprev*(len-1) + TR) / len
//  第一筆對應輸入索引 len(需 len+1 根才算得出), n < len+1 時該期回傳 []
//  atrRatio = atr / close, close 為 0 時給 0
//  atrRatioMod = diviProt(atr, close + opt.plusClose), |分母| < 0.00001 時 clamp 至 ±0.00001
//  atrChange = (atr - atrPrev) / atrPrev, 第一筆無前值給 0
//  trRank = 最近 len 根 TR 中嚴格小於當根 TR 之比例
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
}

//參考實作: 逐根 True Range, 索引 0 無前一根故為 0
let refTrs = (arr) => {
    let ts = [0]
    for (let i = 1; i < arr.length; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let cp = arr[i - 1].Close
        ts.push(Math.max(Math.abs(h - l), Math.abs(h - cp), Math.abs(l - cp)))
    }
    return ts
}

//參考實作: Wilder 平滑, 種子取 xs[1..len] 之算術平均, 其後 v = (vPrev*(len-1) + xs[i]) / len
//回傳與輸入等長之陣列, 索引小於 len 處為 null
let refWilder = (xs, len) => {
    let ws = new Array(xs.length).fill(null)
    let sum = 0
    for (let i = 1; i <= len; i++) {
        sum += xs[i]
    }
    ws[len] = sum / len
    for (let i = len + 1; i < xs.length; i++) {
        ws[i] = ((ws[i - 1] * (len - 1)) + xs[i]) / len
    }
    return ws
}

//參考實作: 各根 ATR(自索引 len 起)
let refAtrs = (arr, len) => {
    if (arr.length < len + 1) {
        return []
    }
    return refWilder(refTrs(arr), len).slice(len)
}

//參考實作: trRank, 取最近 len 根 TR 中嚴格小於當根 TR 之比例
let refTrRanks = (arr, len) => {
    let ts = refTrs(arr)
    let rs = []
    for (let i = len; i < arr.length; i++) {
        let cnt = 0
        for (let j = Math.max(1, i - len + 1); j <= i; j++) {
            if (ts[j] < ts[i]) {
                cnt += 1
            }
        }
        rs.push(cnt / len)
    }
    return rs
}

//參考實作: diviProt 之下限保護, |分母| < 0.00001 時 clamp 至 ±0.00001
let refDiviProt = (u, d) => {
    let dd = d
    if (Math.abs(dd) < 0.00001) {
        dd = dd < 0 ? -0.00001 : 0.00001
    }
    return u / dd
}

//由 {H, L, C} 列造出 K 線, time 用共用層之 4hr 時間軸
let mkBars = (rows) => {
    let ts = genTimes(rows.length)
    return rows.map((r, i) => {
        return {
            time: ts[i],
            Open: r.C,
            High: r.H,
            Low: r.L,
            Close: r.C,
        }
    })
}


describe('calcAtr', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAtr(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊(需 len+1 根才有第一筆)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAtr(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('atr 須等於 TR 序列之 Wilder 平滑(種子為前 len 根 TR 之 SMA)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAtr(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'atr', refAtrs(arr, len), 1e-12, period)
        })
    })

    it('手算例: 5 根 K 線於 len=3 之 atr, atrRatio, atrChange, trRank', async function() {
        //H, L, C:
        //  i0: 12,  8, 10
        //  i1: 14,  9, 13   TR1 = max(|14-9|, |14-10|, |9-10|)  = 5
        //  i2: 15, 13, 14   TR2 = max(|15-13|, |15-13|, |13-13|) = 2
        //  i3: 16, 10, 11   TR3 = max(|16-10|, |16-14|, |10-14|) = 6
        //  i4: 13, 11, 12   TR4 = max(|13-11|, |13-11|, |11-11|) = 2
        //len=3 種子 atr(i3) = (5+2+6)/3 = 13/3
        //     遞推 atr(i4) = ((13/3)*2 + 2)/3 = 32/9
        let arr = mkBars([
            { H: 12, L: 8, C: 10 },
            { H: 14, L: 9, C: 13 },
            { H: 15, L: 13, C: 14 },
            { H: 16, L: 10, C: 11 },
            { H: 13, L: 11, C: 12 },
        ])
        let rrs = await calcAtr(arr, 'Close')

        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 2)

        let v0 = r3.vs[0]
        assert.strictEqual(v0.time, arr[3].time)
        assertNear(v0.atr, 13 / 3, 1e-12, '手算 atr(i3)')
        assertNear(v0.atrRatio, (13 / 3) / 11, 1e-12, '手算 atrRatio(i3)') //close=11
        assert.strictEqual(v0.atrChange, 0) //第一筆無前值
        assertNear(v0.trRank, 2 / 3, 1e-12, '手算 trRank(i3)') //窗 TR=[5,2,6], 當根 6, 小於者 2 個

        let v1 = r3.vs[1]
        assert.strictEqual(v1.time, arr[4].time)
        assertNear(v1.atr, 32 / 9, 1e-12, '手算 atr(i4)')
        assertNear(v1.atrRatio, (32 / 9) / 12, 1e-12, '手算 atrRatio(i4)') //close=12
        assertNear(v1.atrChange, ((32 / 9) - (13 / 3)) / (13 / 3), 1e-12, '手算 atrChange(i4)') // = -7/39
        assertNear(v1.trRank, 0, 1e-12, '手算 trRank(i4)') //窗 TR=[2,6,2], 當根 2, 無嚴格小於者

        //len=4: 種子 atr(i4) = (5+2+6+2)/4 = 15/4, 窗 TR=[5,2,6,2] 當根 2 → trRank=0
        let r4 = pickPeriod(rrs, '16hr')
        assert.strictEqual(r4.vs.length, 1)
        assertNear(r4.vs[0].atr, 15 / 4, 1e-12, '手算 atr(len=4)')
        assertNear(r4.vs[0].atrRatio, (15 / 4) / 12, 1e-12, '手算 atrRatio(len=4)')
        assertNear(r4.vs[0].trRank, 0, 1e-12, '手算 trRank(len=4)')

        //len=5: n=5 < len+1=6 → 空
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 0)
    })

    it('atrRatio 須等於 atr/close, atrChange 須等於 (atr-atrPrev)/atrPrev 且第一筆為 0', async function() {
        let arr = genOhlc(120)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcAtr(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let vs = pickPeriod(rrs, period).vs
            vs.forEach((v, i) => {
                assertNear(v.atrRatio, v.atr / cs[len + i], 1e-12, `${period} atrRatio 第 ${i} 筆`)
                if (i === 0) {
                    assert.strictEqual(v.atrChange, 0, `${period} 第一筆 atrChange 應為 0`)
                }
                else {
                    let atrPrev = vs[i - 1].atr
                    assertNear(v.atrChange, (v.atr - atrPrev) / atrPrev, 1e-12, `${period} atrChange 第 ${i} 筆`)
                }
            })
        })
    })

    it('trRank 須等於當根 TR 在最近 len 根 TR 中嚴格小於者之比例', async function() {
        let arr = genOhlc(120)
        let rrs = await calcAtr(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'trRank', refTrRanks(arr, len), 1e-12, period)
        })
    })

    it('opt.plusClose 使 atrRatioMod 之分母偏移為 close+plusClose', async function() {
        let arr = genOhlc(120)
        let cs = valuesOf(arr, 'Close')
        let plusClose = 25
        let rrs = await calcAtr(arr, 'Close', { plusClose })
        Object.entries(kp).forEach(([period, len]) => {
            let vs = pickPeriod(rrs, period).vs
            vs.forEach((v, i) => {
                assertNear(v.atrRatioMod, refDiviProt(v.atr, cs[len + i] + plusClose), 1e-12, `${period} atrRatioMod 第 ${i} 筆`)
                //未偏移之 atrRatio 不受 plusClose 影響
                assertNear(v.atrRatio, v.atr / cs[len + i], 1e-12, `${period} atrRatio 第 ${i} 筆`)
            })
        })
    })

    it('未給 plusClose 時 atrRatioMod 之分母即為 close', async function() {
        let arr = genOhlc(60)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcAtr(arr, 'Close')
        let len = kp['1day']
        pickPeriod(rrs, '1day').vs.forEach((v, i) => {
            assertNear(v.atrRatioMod, refDiviProt(v.atr, cs[len + i]), 1e-12, `atrRatioMod 第 ${i} 筆`)
        })
    })

    it('close 為 0 時 atrRatio 給 0, atrRatioMod 走 diviProt 下限保護', async function() {
        //每根 H=1, L=-1, C=0 → TR(i) = max(|1-(-1)|, |1-0|, |-1-0|) = 2, 故 atr 恆為 2
        //close=0 → atrRatio 依規格給 0; atrRatioMod = 2 / clamp(0) = 2 / 0.00001 = 200000
        let arr = mkBars([
            { H: 1, L: -1, C: 0 },
            { H: 1, L: -1, C: 0 },
            { H: 1, L: -1, C: 0 },
            { H: 1, L: -1, C: 0 },
            { H: 1, L: -1, C: 0 },
        ])
        let rrs = await calcAtr(arr, 'Close')
        pickPeriod(rrs, '12hr').vs.forEach((v, i) => {
            assertNear(v.atr, 2, 1e-12, `atr 第 ${i} 筆`)
            assert.strictEqual(v.atrRatio, 0, `atrRatio 第 ${i} 筆應為 0`)
            assertNear(v.atrRatioMod, 2 / 0.00001, 1e-9, `atrRatioMod 第 ${i} 筆`)
        })
    })

    it('定值序列之 TR 恆為 0, 故 atr, atrRatio, atrChange, trRank 皆為 0', async function() {
        let arr = genFlat(40, 100)
        let rrs = await calcAtr(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assert.strictEqual(v.atr, 0, `atr 第 ${i} 筆`)
            assert.strictEqual(v.atrRatio, 0, `atrRatio 第 ${i} 筆`)
            assert.strictEqual(v.atrChange, 0, `atrChange 第 ${i} 筆`)
            assert.strictEqual(v.trRank, 0, `trRank 第 ${i} 筆`)
        })
    })

    it('單調上升(無影線, 每根漲 step)之 TR 恆為 step, 故 atr 恆為 step', async function() {
        //無影線時第 i 根 H=Close(i), L=Close(i-1), Cprev=Close(i-1)
        //  → TR = max(step, step, 0) = step, 平滑後 atr 恆為 step
        let step = 2
        let arr = genUp(40, { step })
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcAtr(arr, 'Close')
        let len = kp['1day']
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assertNear(v.atr, step, 1e-12, `atr 第 ${i} 筆`)
            assertNear(v.atrRatio, step / cs[len + i], 1e-12, `atrRatio 第 ${i} 筆`)
            assertNear(v.atrChange, 0, 1e-12, `atrChange 第 ${i} 筆`)
            assertNear(v.trRank, 0, 1e-12, `trRank 第 ${i} 筆`) //TR 全等 → 無嚴格小於者
        })
    })

    it('單調下降(無影線, 每根跌 step)之 TR 恆為 step, 故 atr 恆為 step', async function() {
        //無影線時第 i 根 H=Close(i-1), L=Close(i), Cprev=Close(i-1)
        //  → TR = max(step, 0, step) = step
        let step = 2
        let arr = genDown(40, { step })
        let rrs = await calcAtr(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assertNear(v.atr, step, 1e-12, `atr 第 ${i} 筆`)
            assertNear(v.atrChange, 0, 1e-12, `atrChange 第 ${i} 筆`)
        })
    })

    it('atr 恆為非負, trRank 恆落在 [0,1]', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAtr(arr, 'Close')
        rrs.forEach((r) => {
            assertRange(r.vs, 'atr', 0, Infinity, r.period)
            assertRange(r.vs, 'trRank', 0, 1, r.period)
        })
    })

    it('資料筆數少於 len+1 時該期回傳空陣列', async function() {
        //最短之 len 為 3, 需 4 根, 故 3 根時各期皆空
        let arr = genOhlc(3)
        let rrs = await calcAtr(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('恰為 len+1 根時該期輸出 1 筆', async function() {
        let arr = genOhlc(4)
        let rrs = await calcAtr(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '12hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('High 非數值時須拋錯', async function() {
        let arr = genOhlc(20)
        arr[1].High = null
        await assert.rejects(async () => {
            await calcAtr(arr, 'Close')
        }, /invalid h/)
    })

    it('Low 非數值時須拋錯', async function() {
        let arr = genOhlc(20)
        arr[2].Low = 'x'
        await assert.rejects(async () => {
            await calcAtr(arr, 'Close')
        }, /invalid l/)
    })

    it('前一根 Close 非數值時須拋錯', async function() {
        let arr = genOhlc(20)
        arr[0].Close = undefined
        await assert.rejects(async () => {
            await calcAtr(arr, 'Close')
        }, /invalid cPrev/)
    })

})
