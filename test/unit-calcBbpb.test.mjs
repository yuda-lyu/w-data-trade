import assert from 'assert'
import calcBbpb from '../src/calcBbpb.mjs'
import { genOhlc, genFlat, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcBbpb.mjs
//  Middle = SMA(Close, len)
//  Sigma = 母體標準差 = sqrt(E[X^2] - (E[X])^2)
//  Upper = Middle + k * Sigma, Lower = Middle - k * Sigma (k 預設 2)
//  bandWidth = Upper - Lower = 2 * k * Sigma
//  BBpctB = (Close - Lower) / bandWidth, bandWidth 為 0 時給 0.5
//  BBwidth = bandWidth / Middle, Middle 為 0 時給 0
//  BBwidthChange = BBwidth - 前一筆 BBwidth, 首筆給 0
//  mids = Middle - subMid, midsp = sign(mids) * |mids|^powMid, midspp = midsp + plusMid
//  BBwidthMod = diviProt(bandWidth + plusBandWidth, midspp)
//  BBwidthChangeMod = BBwidthMod - 前一筆 BBwidthMod, 首筆給 0
//  第一筆對應輸入索引 len-1, n < len 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
    '15day': 90, // 15 days = 90 * 4 hours
    '30day': 180, // 30 days = 180 * 4 hours
}

//參考實作: src/diviProt.mjs 之保護規則
//  |分母| < 0.00001 時 clamp 至 ±0.00001 (保留符號, 分母為 0 視為正向)
let refDiviProt = (u, d) => {
    let dd = d
    if (Math.abs(dd) < 0.00001) {
        dd = dd < 0 ? -0.00001 : 0.00001
    }
    return u / dd
}

//參考實作: 直接照布林通道定義暴力計算 (每根重掃視窗, 變異數用離差平方和)
let refBbpb = (cs, len, opt = {}) => {
    let k = opt.k !== undefined ? opt.k : 2
    let subMid = opt.subMid !== undefined ? opt.subMid : 0
    let plusMid = opt.plusMid !== undefined ? opt.plusMid : 0
    let powMid = opt.powMid !== undefined ? opt.powMid : 1
    let plusBandWidth = opt.plusBandWidth !== undefined ? opt.plusBandWidth : 0
    let rs = []
    if (cs.length < len) {
        return rs
    }
    let bwPrev = null
    let bwModPrev = null
    for (let i = len - 1; i < cs.length; i++) {
        let ws = []
        for (let j = i - len + 1; j <= i; j++) {
            ws.push(cs[j])
        }
        let sum = 0
        ws.forEach((v) => {
            sum += v
        })
        let middle = sum / len
        let sumDev = 0
        ws.forEach((v) => {
            sumDev += (v - middle) * (v - middle)
        })
        let sigma = Math.sqrt(sumDev / len)
        let upper = middle + k * sigma
        let lower = middle - k * sigma
        let bandWidth = upper - lower
        let BBpctB = bandWidth !== 0 ? (cs[i] - lower) / bandWidth : 0.5
        let BBwidth = middle !== 0 ? bandWidth / middle : 0
        let BBwidthChange = bwPrev !== null ? BBwidth - bwPrev : 0
        let mids = middle - subMid
        let midspp = Math.sign(mids) * Math.abs(mids) ** powMid + plusMid
        let BBwidthMod = refDiviProt(bandWidth + plusBandWidth, midspp)
        let BBwidthChangeMod = bwModPrev !== null ? BBwidthMod - bwModPrev : 0
        rs.push({
            BBpctB,
            BBwidth,
            BBwidthChange,
            BBwidthMod,
            BBwidthChangeMod,
        })
        bwPrev = BBwidth
        bwModPrev = BBwidthMod
    }
    return rs
}


describe('calcBbpb', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcBbpb(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcBbpb(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('各 keyOut 須符合布林通道定義 (逐點比對暴力參考實作)', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcBbpb(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refBbpb(cs, len)
            assertNearAll(r.vs, 'BBpctB', exps.map((v) => {
                return v.BBpctB
            }), 1e-9, period)
            assertNearAll(r.vs, 'BBwidth', exps.map((v) => {
                return v.BBwidth
            }), 1e-9, period)
            assertNearAll(r.vs, 'BBwidthChange', exps.map((v) => {
                return v.BBwidthChange
            }), 1e-9, period)
            assertNearAll(r.vs, 'BBwidthMod', exps.map((v) => {
                return v.BBwidthMod
            }), 1e-9, period)
            assertNearAll(r.vs, 'BBwidthChangeMod', exps.map((v) => {
                return v.BBwidthChangeMod
            }), 1e-9, period)
        })
    })

    it('手算例: 收盤 1..6 於 len=6 之 middle=3.5, sigma=sqrt(35/12)', async function() {
        //手算:
        //  middle = (1+2+3+4+5+6)/6 = 3.5
        //  E[X^2] = (1+4+9+16+25+36)/6 = 91/6, mean^2 = 49/4
        //  variance = 91/6 - 49/4 = (182-147)/12 = 35/12, sigma = sqrt(35/12)
        //  bandWidth = 2*k*sigma = 4*sigma, lower = 3.5 - 2*sigma
        //  BBpctB = (6 - (3.5-2*sigma)) / (4*sigma) = (2.5 + 2*sigma) / (4*sigma)
        //  BBwidth = 4*sigma / 3.5
        //  首筆 BBwidthChange = 0, BBwidthMod = bandWidth/middle (opt 全 0) = BBwidth
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6])
        let rrs = await calcBbpb(arr, 'Close')
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[5].time)
        let sigma = Math.sqrt(35 / 12)
        assertNear(r.vs[0].BBpctB, (2.5 + 2 * sigma) / (4 * sigma), 1e-12, '手算 BBpctB')
        assertNear(r.vs[0].BBwidth, 4 * sigma / 3.5, 1e-12, '手算 BBwidth')
        assert.strictEqual(r.vs[0].BBwidthChange, 0)
        assertNear(r.vs[0].BBwidthMod, 4 * sigma / 3.5, 1e-12, '手算 BBwidthMod')
        assert.strictEqual(r.vs[0].BBwidthChangeMod, 0)
        assert.strictEqual(pickPeriod(rrs, '2day').vs.length, 0)
    })

    it('手算例: 收盤等於中軌時 BBpctB 為 0.5', async function() {
        //手算: 收盤 [1,2,3,4,5,3], middle = 18/6 = 3, 末根收盤 3 = middle
        //  BBpctB = (Close-Lower)/bandWidth = (middle - (middle-k*sigma))/(2*k*sigma) = 0.5
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 3])
        let rrs = await calcBbpb(arr, 'Close')
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 1)
        assertNear(r.vs[0].BBpctB, 0.5, 1e-12, '收盤等於中軌')
    })

    it('手算例: 收盤等於上軌時 BBpctB 為 1, 等於下軌時為 0', async function() {
        //手算 (上軌): 收盤 [0,0,0,0,0,6], middle = 1
        //  E[X^2] = 36/6 = 6, variance = 6-1 = 5, sigma = sqrt(5)
        //  取 k = sqrt(5) 則 Upper = 1 + sqrt(5)*sqrt(5) = 6 = 末根收盤 → BBpctB = 1
        //手算 (下軌): 收盤 [6,6,6,6,6,0], middle = 5
        //  E[X^2] = 180/6 = 30, variance = 30-25 = 5, sigma = sqrt(5)
        //  取 k = sqrt(5) 則 Lower = 5 - 5 = 0 = 末根收盤 → BBpctB = 0
        let k = Math.sqrt(5)
        let arrU = ohlcFromCloses([0, 0, 0, 0, 0, 6])
        let rrsU = await calcBbpb(arrU, 'Close', { k })
        assertNear(pickPeriod(rrsU, '1day').vs[0].BBpctB, 1, 1e-12, '收盤等於上軌')
        let arrL = ohlcFromCloses([6, 6, 6, 6, 6, 0])
        let rrsL = await calcBbpb(arrL, 'Close', { k })
        assertNear(pickPeriod(rrsL, '1day').vs[0].BBpctB, 0, 1e-12, '收盤等於下軌')
    })

    it('opt.k 為通道倍數: k 加倍則 bandWidth 加倍, BBpctB 對 0.5 之偏離減半', async function() {
        //bandWidth = 2*k*sigma 與 k 成正比 → BBwidth(k=4) = 2*BBwidth(k=2)
        //BBpctB - 0.5 = (Close-Middle)/(2*k*sigma) 與 k 成反比
        let arr = genOhlc(100)
        let rrs2 = await calcBbpb(arr, 'Close')
        let rrs4 = await calcBbpb(arr, 'Close', { k: 4 })
        let vs2 = pickPeriod(rrs2, '1day').vs
        let vs4 = pickPeriod(rrs4, '1day').vs
        assert.strictEqual(vs2.length, vs4.length)
        vs2.forEach((v, i) => {
            assertNear(vs4[i].BBwidth, v.BBwidth * 2, 1e-12, `第 ${i} 筆 BBwidth`)
            assertNear(vs4[i].BBpctB - 0.5, (v.BBpctB - 0.5) / 2, 1e-12, `第 ${i} 筆 BBpctB`)
        })
    })

    it('subMid/powMid/plusMid/plusBandWidth 須依註解公式作用於 BBwidthMod', async function() {
        //BBwidthMod = diviProt(bandWidth+plusBandWidth, sign(middle-subMid)*|middle-subMid|^powMid + plusMid)
        let opt = {
            subMid: 50,
            plusMid: 0.5,
            powMid: 0.5,
            plusBandWidth: 0.1,
        }
        let arr = genOhlc(120)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcBbpb(arr, 'Close', opt)
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refBbpb(cs, len, opt)
            assertNearAll(r.vs, 'BBwidthMod', exps.map((v) => {
                return v.BBwidthMod
            }), 1e-9, period)
            assertNearAll(r.vs, 'BBwidthChangeMod', exps.map((v) => {
                return v.BBwidthChangeMod
            }), 1e-9, period)
        })
    })

    it('opt 全為預設 0 時 BBwidthMod 退化成 BBwidth', async function() {
        //註解: subMid/plusMid/powMid/plusBandWidth=0 時退化成原版 BBwidth (middle 遠離 diviProt 底限時)
        let arr = genOhlc(100)
        let rrs = await calcBbpb(arr, 'Close')
        pickPeriod(rrs, '2day').vs.forEach((v, i) => {
            assertNear(v.BBwidthMod, v.BBwidth, 1e-12, `第 ${i} 筆`)
            assertNear(v.BBwidthChangeMod, v.BBwidthChange, 1e-12, `第 ${i} 筆 change`)
        })
    })

    it('BBwidthChange 首筆為 0, 其後為相鄰兩筆 BBwidth 之差', async function() {
        let arr = genOhlc(60)
        let rrs = await calcBbpb(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.strictEqual(vs[0].BBwidthChange, 0)
        assert.strictEqual(vs[0].BBwidthChangeMod, 0)
        for (let i = 1; i < vs.length; i++) {
            assertNear(vs[i].BBwidthChange, vs[i].BBwidth - vs[i - 1].BBwidth, 1e-12, `第 ${i} 筆`)
            assertNear(vs[i].BBwidthChangeMod, vs[i].BBwidthMod - vs[i - 1].BBwidthMod, 1e-12, `第 ${i} 筆 mod`)
        }
    })

    it('退化: 定值序列之 sigma 為 0, BBpctB 給 0.5 且各寬度為 0', async function() {
        //sigma=0 → bandWidth=0 → BBpctB 取 0.5 分支; BBwidth = 0/100 = 0; BBwidthMod = diviProt(0,100) = 0
        let arr = genFlat(30, 100)
        let rrs = await calcBbpb(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.strictEqual(vs.length, 25)
        vs.forEach((v, i) => {
            assert.strictEqual(v.BBpctB, 0.5, `第 ${i} 筆 BBpctB`)
            assert.strictEqual(v.BBwidth, 0, `第 ${i} 筆 BBwidth`)
            assert.strictEqual(v.BBwidthChange, 0, `第 ${i} 筆 BBwidthChange`)
            assert.strictEqual(v.BBwidthMod, 0, `第 ${i} 筆 BBwidthMod`)
            assert.strictEqual(v.BBwidthChangeMod, 0, `第 ${i} 筆 BBwidthChangeMod`)
        })
    })

    it('手算例: 中軌為 0 時 BBwidth 給 0, BBwidthMod 走 diviProt 底限', async function() {
        //手算: 收盤 [-1,0,1] 於 len=3
        //  middle = 0 → BBwidth 取 0 分支 (即使 bandWidth > 0)
        //  E[X^2] = 2/3, variance = 2/3, sigma = sqrt(2/3), bandWidth = 4*sigma
        //  BBpctB = (1 - (0-2*sigma))/(4*sigma) = (1+2*sigma)/(4*sigma)
        //  midspp = sign(0)*|0|^1 + 0 = 0 → diviProt clamp 至 0.00001
        //  BBwidthMod = 4*sigma / 0.00001
        let arr = ohlcFromCloses([-1, 0, 1])
        let rrs = await calcBbpb(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        let sigma = Math.sqrt(2 / 3)
        let bandWidth = 4 * sigma
        assertNear(r.vs[0].BBpctB, (1 + 2 * sigma) / bandWidth, 1e-12, '手算 BBpctB')
        assert.strictEqual(r.vs[0].BBwidth, 0)
        assertNear(r.vs[0].BBwidthMod, bandWidth / 0.00001, 1e-12, '手算 BBwidthMod')
    })

    it('資料筆數少於 len 時該期回傳空陣列, 等於 len 時恰一筆', async function() {
        let arr = genOhlc(5)
        let rrs = await calcBbpb(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '12hr').vs.length, 3)
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs, '1day').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '30day').vs.length, 0)
    })

    it('Close 非數值時須拋錯', async function() {
        let arr = genOhlc(20)
        arr[7].Close = null
        await assert.rejects(calcBbpb(arr, 'Close'), /invalid c/)
    })

})
