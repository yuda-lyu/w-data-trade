import assert from 'assert'
import calcDonchian from '../src/calcDonchian.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcDonchian.mjs
//  Upper = 視窗內 High 之最大值, Lower = 視窗內 Low 之最小值
//  視窗 (excludeCurrent=false, 預設) = [i-len+1, i] 含當前根, 第一筆對應輸入索引 len-1
//  視窗 (excludeCurrent=true) = [i-len, i-1] 不含當前根, 第一筆對應輸入索引 len
//  mid = (Upper+Lower)/2, bandWidth = Upper-Lower
//  dcPctB = (Close - Lower) / bandWidth, bandWidth 為 0 時給 0.5
//  dcWidth = bandWidth / mid, mid 為 0 時給 0
//  dcWidthChange = dcWidth - 前一筆 dcWidth, 首筆給 0
//  mids = mid - subMid, midsp = sign(mids) * |mids|^powMid, midspp = midsp + plusMid
//  dcWidthMod = diviProt(bandWidth + plusBandWidth, midspp)
//  dcWidthChangeMod = dcWidthMod - 前一筆 dcWidthMod, 首筆給 0
//  n < len 時該期回傳 []
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

//參考實作: 直接照 Donchian 通道定義, 用 Math.max/Math.min 暴力掃視窗
let refDonchian = (arr, len, opt = {}) => {
    let excludeCurrent = opt.excludeCurrent !== undefined ? opt.excludeCurrent : false
    let subMid = opt.subMid !== undefined ? opt.subMid : 0
    let plusMid = opt.plusMid !== undefined ? opt.plusMid : 0
    let powMid = opt.powMid !== undefined ? opt.powMid : 1
    let plusBandWidth = opt.plusBandWidth !== undefined ? opt.plusBandWidth : 0
    let rs = []
    if (arr.length < len) {
        return rs
    }
    let widthPrev = null
    let widthModPrev = null
    for (let i = excludeCurrent ? len : len - 1; i < arr.length; i++) {
        let win = excludeCurrent ? arr.slice(i - len, i) : arr.slice(i - len + 1, i + 1)
        let upper = Math.max(...win.map((v) => {
            return v.High
        }))
        let lower = Math.min(...win.map((v) => {
            return v.Low
        }))
        let c = arr[i].Close
        let mid = (upper + lower) / 2
        let bandWidth = upper - lower
        let dcPctB = bandWidth !== 0 ? (c - lower) / bandWidth : 0.5
        let dcWidth = mid !== 0 ? bandWidth / mid : 0
        let dcWidthChange = widthPrev !== null ? dcWidth - widthPrev : 0
        let mids = mid - subMid
        let midspp = Math.sign(mids) * Math.abs(mids) ** powMid + plusMid
        let dcWidthMod = refDiviProt(bandWidth + plusBandWidth, midspp)
        let dcWidthChangeMod = widthModPrev !== null ? dcWidthMod - widthModPrev : 0
        rs.push({
            dcPctB,
            dcWidth,
            dcWidthChange,
            dcWidthMod,
            dcWidthChangeMod,
        })
        widthPrev = dcWidth
        widthModPrev = dcWidthMod
    }
    return rs
}


describe('calcDonchian', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcDonchian(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('預設視窗含當前根, 時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcDonchian(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('excludeCurrent=true 時視窗不含當前根, 時間軸自第 len 根起算', async function() {
        let arr = genOhlc(200)
        let rrs = await calcDonchian(arr, 'Close', { excludeCurrent: true })
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('各 keyOut 須符合 Donchian 通道定義 (逐點比對暴力參考實作)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcDonchian(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refDonchian(arr, len);
            ['dcPctB', 'dcWidth', 'dcWidthChange', 'dcWidthMod', 'dcWidthChangeMod'].forEach((key) => {
                assertNearAll(r.vs, key, exps.map((v) => {
                    return v[key]
                }), 1e-9, period)
            })
        })
    })

    it('excludeCurrent=true 之各 keyOut 須符合定義 (逐點比對暴力參考實作)', async function() {
        let arr = genOhlc(200)
        let opt = { excludeCurrent: true }
        let rrs = await calcDonchian(arr, 'Close', opt)
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refDonchian(arr, len, opt);
            ['dcPctB', 'dcWidth', 'dcWidthChange', 'dcWidthMod', 'dcWidthChangeMod'].forEach((key) => {
                assertNearAll(r.vs, key, exps.map((v) => {
                    return v[key]
                }), 1e-9, period)
            })
        })
    })

    it('手算例: 收盤 1..6 (無影線) 於 len=6 之 upper=6, lower=1', async function() {
        //手算: 無影線之 K 線 Open=前根 Close, High=max(O,C), Low=min(O,C)
        //  第 0 根 H=L=1, 第 1~5 根 H=收盤 (2..6), L=開盤 (1..5)
        //  視窗含 6 根: upper = max(High) = 6, lower = min(Low) = 1
        //  mid = (6+1)/2 = 3.5, bandWidth = 6-1 = 5
        //  末根收盤 6 = upper → dcPctB = (6-1)/5 = 1
        //  dcWidth = 5/3.5 = 10/7, dcWidthChange 首筆 = 0
        //  dcWidthMod = diviProt(5, 3.5) = 10/7 (opt 全 0)
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6], { wick: 0 })
        let rrs = await calcDonchian(arr, 'Close')
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[5].time)
        assert.strictEqual(r.vs[0].dcPctB, 1)
        assertNear(r.vs[0].dcWidth, 10 / 7, 1e-12, '手算 dcWidth')
        assert.strictEqual(r.vs[0].dcWidthChange, 0)
        assertNear(r.vs[0].dcWidthMod, 10 / 7, 1e-12, '手算 dcWidthMod')
        assert.strictEqual(r.vs[0].dcWidthChangeMod, 0)
        assert.strictEqual(pickPeriod(rrs, '2day').vs.length, 0)
    })

    it('手算例: excludeCurrent=true 時收盤突破上軌之 dcPctB 大於 1', async function() {
        //手算: 收盤 1..7 (無影線), len=6, 當前根 index=6
        //  視窗 = index 0~5 → upper = 6, lower = 1, bandWidth = 5
        //  當前根收盤 7 → dcPctB = (7-1)/5 = 1.2 (註解: excludeCurrent=true 時可能 <0 或 >1)
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6, 7], { wick: 0 })
        let rrs = await calcDonchian(arr, 'Close', { excludeCurrent: true })
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[6].time)
        assertNear(r.vs[0].dcPctB, 1.2, 1e-12, '手算 dcPctB')
        assertNear(r.vs[0].dcWidth, 10 / 7, 1e-12, '手算 dcWidth')
    })

    it('不變式: 視窗含當前根時 lower <= Close <= upper, 故 dcPctB 落在 0~1', async function() {
        let arr = genOhlc(200)
        let rrs = await calcDonchian(arr, 'Close')
        Object.keys(kp).forEach((period) => {
            assertRange(pickPeriod(rrs, period).vs, 'dcPctB', 0, 1, period)
        })
    })

    it('單調上升時收盤恆等於上軌 (dcPctB=1), 單調下降時恆等於下軌 (dcPctB=0)', async function() {
        let arrUp = genUp(40)
        let rrsUp = await calcDonchian(arrUp, 'Close')
        pickPeriod(rrsUp, '1day').vs.forEach((v, i) => {
            assert.strictEqual(v.dcPctB, 1, `上升第 ${i} 筆`)
        })
        let arrDown = genDown(40)
        let rrsDown = await calcDonchian(arrDown, 'Close')
        pickPeriod(rrsDown, '1day').vs.forEach((v, i) => {
            assert.strictEqual(v.dcPctB, 0, `下降第 ${i} 筆`)
        })
    })

    it('subMid/powMid/plusMid/plusBandWidth 須依註解公式作用於 dcWidthMod', async function() {
        //dcWidthMod = diviProt(bandWidth+plusBandWidth, sign(mid-subMid)*|mid-subMid|^powMid + plusMid)
        let opt = {
            subMid: 50,
            plusMid: 0.5,
            powMid: 0.5,
            plusBandWidth: 0.1,
        }
        let arr = genOhlc(120)
        let rrs = await calcDonchian(arr, 'Close', opt)
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refDonchian(arr, len, opt)
            assertNearAll(r.vs, 'dcWidthMod', exps.map((v) => {
                return v.dcWidthMod
            }), 1e-9, period)
            assertNearAll(r.vs, 'dcWidthChangeMod', exps.map((v) => {
                return v.dcWidthChangeMod
            }), 1e-9, period)
        })
    })

    it('opt 全為預設 0 時 dcWidthMod 退化成 dcWidth', async function() {
        //註解: plusMid/plusBandWidth=0 時退化成原版 dcWidth (mid 遠離 diviProt 底限時)
        let arr = genOhlc(100)
        let rrs = await calcDonchian(arr, 'Close')
        pickPeriod(rrs, '2day').vs.forEach((v, i) => {
            assertNear(v.dcWidthMod, v.dcWidth, 1e-12, `第 ${i} 筆`)
            assertNear(v.dcWidthChangeMod, v.dcWidthChange, 1e-12, `第 ${i} 筆 change`)
        })
    })

    it('dcWidthChange 首筆為 0, 其後為相鄰兩筆 dcWidth 之差', async function() {
        let arr = genOhlc(60)
        let rrs = await calcDonchian(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.strictEqual(vs[0].dcWidthChange, 0)
        assert.strictEqual(vs[0].dcWidthChangeMod, 0)
        for (let i = 1; i < vs.length; i++) {
            assertNear(vs[i].dcWidthChange, vs[i].dcWidth - vs[i - 1].dcWidth, 1e-12, `第 ${i} 筆`)
            assertNear(vs[i].dcWidthChangeMod, vs[i].dcWidthMod - vs[i - 1].dcWidthMod, 1e-12, `第 ${i} 筆 mod`)
        }
    })

    it('退化: 定值序列之通道寬為 0, dcPctB 給 0.5 且各寬度為 0', async function() {
        //upper=lower → bandWidth=0 → dcPctB 取 0.5 分支; dcWidth = 0/100 = 0; dcWidthMod = diviProt(0,100) = 0
        let arr = genFlat(30, 100)
        let rrs = await calcDonchian(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.strictEqual(vs.length, 25)
        vs.forEach((v, i) => {
            assert.strictEqual(v.dcPctB, 0.5, `第 ${i} 筆 dcPctB`)
            assert.strictEqual(v.dcWidth, 0, `第 ${i} 筆 dcWidth`)
            assert.strictEqual(v.dcWidthChange, 0, `第 ${i} 筆 dcWidthChange`)
            assert.strictEqual(v.dcWidthMod, 0, `第 ${i} 筆 dcWidthMod`)
            assert.strictEqual(v.dcWidthChangeMod, 0, `第 ${i} 筆 dcWidthChangeMod`)
        })
    })

    it('手算例: mid 為 0 時 dcWidth 給 0, dcWidthMod 走 diviProt 底限', async function() {
        //手算: 收盤 [-3,3,0] (無影線), len=3
        //  第 0 根 H=L=-3; 第 1 根 O=-3,C=3 → H=3,L=-3; 第 2 根 O=3,C=0 → H=3,L=0
        //  upper = 3, lower = -3 → mid = 0 → dcWidth 取 0 分支 (即使 bandWidth=6 > 0)
        //  dcPctB = (0-(-3))/6 = 0.5
        //  midspp = sign(0)*|0|^1 + 0 = 0 → diviProt clamp 至 0.00001 → dcWidthMod = 6/0.00001 = 600000
        let arr = ohlcFromCloses([-3, 3, 0], { wick: 0 })
        let rrs = await calcDonchian(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].dcPctB, 0.5)
        assert.strictEqual(r.vs[0].dcWidth, 0)
        assertNear(r.vs[0].dcWidthMod, 600000, 1e-12, '手算 dcWidthMod')
    })

    it('資料筆數少於 len 時該期回傳空陣列, 等於 len 時含當前根恰一筆而不含當前根為空', async function() {
        let arr = genOhlc(5)
        let rrs = await calcDonchian(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '12hr').vs.length, 3)
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs, '1day').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '30day').vs.length, 0)
        let rrsEx = await calcDonchian(arr, 'Close', { excludeCurrent: true })
        assert.strictEqual(pickPeriod(rrsEx, '12hr').vs.length, 2)
        assert.strictEqual(pickPeriod(rrsEx, '20hr').vs.length, 0)
    })

    it('High/Low/Close 非數值時須拋錯', async function() {
        let arrH = genOhlc(20)
        arrH[7].High = null
        await assert.rejects(calcDonchian(arrH, 'Close'), /invalid h/)
        let arrL = genOhlc(20)
        arrL[7].Low = null
        await assert.rejects(calcDonchian(arrL, 'Close'), /invalid l/)
        let arrC = genOhlc(20)
        arrC[7].Close = null
        await assert.rejects(calcDonchian(arrC, 'Close'), /invalid c/)
    })

})
