import assert from 'assert'
import calcKeltner from '../src/calcKeltner.mjs'
import { genOhlc, genFlat, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcKeltner.mjs
//  TR(i) = max(|High-Low|, |High-Close(i-1)|, |Low-Close(i-1)|), 自 i=1 起算, TR(0)=0
//  ATR 種子 = TR(1..len) 之 SMA, 對應索引 len; 其後 Wilder 遞推 ATR = (ATR_prev*(len-1) + TR(i)) / len
//  EMA 種子 = Close(0..len-1) 之 SMA (對應索引 len-1), alpha = 2/(len+1)
//    先遞推一步至索引 len: EMA = Close(len)*alpha + 種子*(1-alpha), 其後 EMA = Close*alpha + EMA_prev*(1-alpha)
//  middle = EMA(Close, len)
//  upper = middle + mult*ATR, lower = middle - mult*ATR, bandWidth = upper-lower = 2*mult*ATR
//  kcPctB = (Close - lower) / bandWidth, bandWidth 為 0 時給 0.5
//  kcWidth = bandWidth / middle, middle 為 0 時給 0
//  kcWidthMod = diviProt(bandWidth, middle + plusMiddle)
//  第一筆對應輸入索引 len (EMA 與 ATR 皆就緒), n < len+1 時該期回傳 []
//  (len, mult) 配對: 錨點 1day=(6,2) 對應 Linda Raschke 標準, 經典 k=2 區間 1.5~3
let kp = {
    '12hr': { len: 3, mult: 1.5 },
    '16hr': { len: 4, mult: 1.5 },
    '20hr': { len: 5, mult: 1.5 },
    '1day': { len: 6, mult: 2 },
    '2day': { len: 12, mult: 2 },
    '4day': { len: 24, mult: 2 },
    '7day': { len: 42, mult: 2.5 },
    '15day': { len: 90, mult: 2.5 },
    '30day': { len: 180, mult: 3 },
}

//kp 之 period → len 對照 (供 assertRrsShape 使用)
let kpLen = {}
Object.entries(kp).forEach(([period, cfg]) => {
    kpLen[period] = cfg.len
})

//參考實作: src/diviProt.mjs 之保護規則
//  |分母| < 0.00001 時 clamp 至 ±0.00001 (保留符號, 分母為 0 視為正向)
let refDiviProt = (u, d) => {
    let dd = d
    if (Math.abs(dd) < 0.00001) {
        dd = dd < 0 ? -0.00001 : 0.00001
    }
    return u / dd
}

//參考實作: 直接照 Keltner 通道定義計算 (EMA 中軌 + Wilder ATR 通道)
let refKeltner = (arr, len, mult, opt = {}) => {
    let plusMiddle = opt.plusMiddle !== undefined ? opt.plusMiddle : 0
    let n = arr.length
    let rs = []
    if (n < len + 1) {
        return rs
    }

    //TR
    let trs = [0]
    for (let i = 1; i < n; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let cPrev = arr[i - 1].Close
        trs.push(Math.max(Math.abs(h - l), Math.abs(h - cPrev), Math.abs(l - cPrev)))
    }

    //ATR: 種子為 TR(1..len) 之平均, 之後 Wilder 遞推
    let atrs = []
    for (let i = 0; i < n; i++) {
        if (i < len) {
            atrs.push(null)
        }
        else if (i === len) {
            let sum = 0
            for (let j = 1; j <= len; j++) {
                sum += trs[j]
            }
            atrs.push(sum / len)
        }
        else {
            atrs.push((atrs[i - 1] * (len - 1) + trs[i]) / len)
        }
    }

    //EMA: 種子為 Close(0..len-1) 之平均 (置於索引 len-1), 之後標準 EMA 遞推
    let alpha = 2 / (len + 1)
    let emas = []
    for (let i = 0; i < n; i++) {
        if (i < len - 1) {
            emas.push(null)
        }
        else if (i === len - 1) {
            let sum = 0
            for (let j = 0; j < len; j++) {
                sum += arr[j].Close
            }
            emas.push(sum / len)
        }
        else {
            emas.push(arr[i].Close * alpha + emas[i - 1] * (1 - alpha))
        }
    }

    for (let i = len; i < n; i++) {
        let c = arr[i].Close
        let middle = emas[i]
        let upper = middle + mult * atrs[i]
        let lower = middle - mult * atrs[i]
        let bandWidth = upper - lower
        rs.push({
            time: arr[i].time,
            kcPctB: bandWidth !== 0 ? (c - lower) / bandWidth : 0.5,
            kcWidth: middle !== 0 ? bandWidth / middle : 0,
            kcWidthMod: refDiviProt(bandWidth, middle + plusMiddle),
        })
    }
    return rs
}


describe('calcKeltner', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcKeltner(arr, 'Close')
        assertRrsShape(rrs, kpLen)
    })

    it('各期時間軸自第 len 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcKeltner(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, cfg.len)
        })
    })

    it('各 keyOut 須符合 Keltner 通道定義, 且各期 mult 須符合 kp 配對表', async function() {
        let arr = genOhlc(200)
        let rrs = await calcKeltner(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refKeltner(arr, cfg.len, cfg.mult);
            ['kcPctB', 'kcWidth', 'kcWidthMod'].forEach((key) => {
                assertNearAll(r.vs, key, exps.map((v) => {
                    return v[key]
                }), 1e-9, `${period} mult=${cfg.mult}`)
            })
        })
    })

    it('手算例: 收盤 [10,12,14,16] 於 len=3,mult=1.5 之 middle=14, ATR=2', async function() {
        //手算 (無影線 K 線, Open=前根 Close, High=max(O,C), Low=min(O,C)):
        //  各根 (O,H,L,C) = (10,10,10,10) (10,12,10,12) (12,14,12,14) (14,16,14,16)
        //  TR(1)=max(|12-10|,|12-10|,|10-10|)=2, TR(2)=2, TR(3)=2
        //  ATR 種子 = (2+2+2)/3 = 2, 對應索引 3
        //  EMA 種子 = (10+12+14)/3 = 12, alpha = 2/4 = 0.5
        //  middle = 16*0.5 + 12*0.5 = 14
        //  upper = 14 + 1.5*2 = 17, lower = 14 - 3 = 11, bandWidth = 6
        //  kcPctB = (16-11)/6 = 5/6, kcWidth = 6/14 = 3/7, kcWidthMod = diviProt(6,14) = 3/7
        let arr = ohlcFromCloses([10, 12, 14, 16], { wick: 0 })
        let rrs = await calcKeltner(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[3].time)
        assertNear(r.vs[0].kcPctB, 5 / 6, 1e-12, '手算 kcPctB')
        assertNear(r.vs[0].kcWidth, 3 / 7, 1e-12, '手算 kcWidth')
        assertNear(r.vs[0].kcWidthMod, 3 / 7, 1e-12, '手算 kcWidthMod')
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('手算例: 續加一根收盤 18 之 EMA/ATR 遞推 (middle=16, ATR=2)', async function() {
        //手算: 收盤 [10,12,14,16,18], len=3, mult=1.5
        //  第 4 根 (O,H,L,C) = (16,18,16,18), TR(4) = max(2,2,0) = 2
        //  ATR = (ATR_prev*(3-1) + TR)/3 = (2*2+2)/3 = 2
        //  EMA = 18*0.5 + 14*0.5 = 16
        //  upper = 16+3 = 19, lower = 13, bandWidth = 6
        //  kcPctB = (18-13)/6 = 5/6, kcWidth = 6/16 = 0.375
        let arr = ohlcFromCloses([10, 12, 14, 16, 18], { wick: 0 })
        let rrs = await calcKeltner(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 2)
        assertNear(r.vs[1].kcPctB, 5 / 6, 1e-12, '手算 kcPctB')
        assertNear(r.vs[1].kcWidth, 0.375, 1e-12, '手算 kcWidth')
        assertNear(r.vs[1].kcWidthMod, 0.375, 1e-12, '手算 kcWidthMod')
    })

    it('手算例: 收盤等於中軌 (EMA) 時 kcPctB 為 0.5', async function() {
        //手算: 收盤 [10,12,14,12], len=3, mult=1.5
        //  EMA 種子 = (10+12+14)/3 = 12, middle = 12*0.5 + 12*0.5 = 12 = 末根收盤
        //  TR(1)=2, TR(2)=2, TR(3)=max(|14-12|,|14-14|,|12-14|)=2 → ATR = 2
        //  上下軌對稱於 middle → kcPctB = (12-9)/6 = 0.5, kcWidth = 6/12 = 0.5
        let arr = ohlcFromCloses([10, 12, 14, 12], { wick: 0 })
        let rrs = await calcKeltner(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assertNear(r.vs[0].kcPctB, 0.5, 1e-12, '收盤等於中軌')
        assertNear(r.vs[0].kcWidth, 0.5, 1e-12, '手算 kcWidth')
    })

    it('opt.plusMiddle 須偏移 kcWidthMod 之分母 (middle+plusMiddle)', async function() {
        let opt = { plusMiddle: 25 }
        let arr = genOhlc(120)
        let rrs = await calcKeltner(arr, 'Close', opt)
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refKeltner(arr, cfg.len, cfg.mult, opt)
            assertNearAll(r.vs, 'kcWidthMod', exps.map((v) => {
                return v.kcWidthMod
            }), 1e-9, period)
        })
        //plusMiddle 只影響 kcWidthMod, 不影響 kcPctB/kcWidth
        let rrs0 = await calcKeltner(arr, 'Close')
        let vs0 = pickPeriod(rrs0, '1day').vs
        pickPeriod(rrs, '1day').vs.forEach((v, i) => {
            assert.strictEqual(v.kcPctB, vs0[i].kcPctB, `第 ${i} 筆 kcPctB`)
            assert.strictEqual(v.kcWidth, vs0[i].kcWidth, `第 ${i} 筆 kcWidth`)
        })
    })

    it('plusMiddle 為預設 0 時 kcWidthMod 等同 kcWidth', async function() {
        //註解: kcWidthMod = bandWidth/(middle+plusMiddle), plusMiddle=0 且 |middle| 遠離 diviProt 底限時同 kcWidth
        let arr = genOhlc(100)
        let rrs = await calcKeltner(arr, 'Close')
        pickPeriod(rrs, '2day').vs.forEach((v, i) => {
            assertNear(v.kcWidthMod, v.kcWidth, 1e-12, `第 ${i} 筆`)
        })
    })

    it('退化: 定值序列之 ATR 為 0, kcPctB 給 0.5 且各寬度為 0', async function() {
        //TR 恆為 0 → ATR=0 → bandWidth=0 → kcPctB 取 0.5 分支; kcWidth=0; kcWidthMod=diviProt(0,middle)=0
        let arr = genFlat(30, 100)
        let rrs = await calcKeltner(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.strictEqual(vs.length, 24)
        vs.forEach((v, i) => {
            assert.strictEqual(v.kcPctB, 0.5, `第 ${i} 筆 kcPctB`)
            assert.strictEqual(v.kcWidth, 0, `第 ${i} 筆 kcWidth`)
            assert.strictEqual(v.kcWidthMod, 0, `第 ${i} 筆 kcWidthMod`)
        })
    })

    it('手算例: middle 為 0 時 kcWidth 給 0, kcWidthMod 走 diviProt 底限', async function() {
        //手算: 收盤 [-1,-2,-3,2], len=3, mult=1.5
        //  各根 (O,H,L,C) = (-1,-1,-1,-1) (-1,-1,-2,-2) (-2,-2,-3,-3) (-3,2,-3,2)
        //  TR(1)=max(1,0,1)=1, TR(2)=max(1,0,1)=1, TR(3)=max(5,5,0)=5 → ATR 種子 = 7/3
        //  EMA 種子 = (-1-2-3)/3 = -2, alpha=0.5 → middle = 2*0.5 + (-2)*0.5 = 0
        //  bandWidth = 2*1.5*(7/3) = 7, lower = -3.5
        //  kcPctB = (2+3.5)/7 = 5.5/7
        //  middle=0 → kcWidth 取 0 分支; 分母 0 經 diviProt clamp 至 0.00001 → kcWidthMod = 7/0.00001 = 700000
        let arr = ohlcFromCloses([-1, -2, -3, 2], { wick: 0 })
        let rrs = await calcKeltner(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assertNear(r.vs[0].kcPctB, 5.5 / 7, 1e-12, '手算 kcPctB')
        assert.strictEqual(r.vs[0].kcWidth, 0)
        assertNear(r.vs[0].kcWidthMod, 700000, 1e-12, '手算 kcWidthMod')
    })

    it('資料筆數少於 len+1 時該期回傳空陣列, 等於 len+1 時恰一筆', async function() {
        //ATR 種子需 TR(1..len) 共 len 筆 → 至少 len+1 根
        let arr4 = genOhlc(4)
        let rrs4 = await calcKeltner(arr4, 'Close')
        assert.strictEqual(pickPeriod(rrs4, '12hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs4, '16hr').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs4, '30day').vs.length, 0)
        let arr3 = genOhlc(3)
        let rrs3 = await calcKeltner(arr3, 'Close')
        rrs3.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('High/Low/前根 Close/當根 Close 非數值時須拋錯', async function() {
        let arrH = genOhlc(20)
        arrH[7].High = null
        await assert.rejects(calcKeltner(arrH, 'Close'), /invalid h/)
        let arrL = genOhlc(20)
        arrL[7].Low = null
        await assert.rejects(calcKeltner(arrL, 'Close'), /invalid l/)
        let arrP = genOhlc(20)
        arrP[7].Close = null
        await assert.rejects(calcKeltner(arrP, 'Close'), /invalid cPrev/)
        let arrC = genOhlc(20)
        arrC[19].Close = null
        await assert.rejects(calcKeltner(arrC, 'Close'), /invalid c\[/)
    })

})
