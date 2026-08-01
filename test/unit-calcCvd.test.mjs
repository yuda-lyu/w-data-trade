import assert from 'assert'
import calcCvd from '../src/calcCvd.mjs'
import { genOhlc, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcCvd.mjs
//  delta[i] = (2*TakerBuyBaseAssetVolume[i] - Volumn[i]) / Volumn[i] (Volumn<=0 時 delta=0)
//  cvd[i] = (Σ delta[j], j∈[i-len+1,i]) / √len, 第一筆 cvd 對應 index=len-1
//  cvdSlope[i] = (cvd[i] - cvd[i-SLOPE_N]) / SLOPE_N, SLOPE_N 固定為 3
//  輸出第一筆對應輸入索引 len-1+SLOPE_N, n < len+SLOPE_N 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6,
    '2day': 12,
    '4day': 24,
    '7day': 42,
    '15day': 90,
    '30day': 180,
}

let SLOPE_N = 3

//參考實作: 直接照定義暴力計算 rolling delta 總和與 slope (視窗總和逐次重算, 不沿用 running sum)
let refCvd = (arr, len, slopeN) => {
    let n = arr.length
    let deltas = arr.map((v) => {
        let vol = v.Volumn
        let tb = v.TakerBuyBaseAssetVolume
        return vol > 0 ? (2 * tb - vol) / vol : 0
    })
    let sqrtLen = Math.sqrt(len)
    let cvds = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
        let win = deltas.slice(i - len + 1, i + 1)
        cvds[i] = win.reduce((a, b) => {
            return a + b
        }, 0) / sqrtLen
    }
    let rs = []
    for (let i = len - 1 + slopeN; i < n; i++) {
        let cvd = cvds[i]
        let cvdPrev = cvds[i - slopeN]
        rs.push({ cvd, cvdSlope: (cvd - cvdPrev) / slopeN })
    }
    return rs
}


describe('calcCvd', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcCvd(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1+SLOPE_N 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcCvd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1 + SLOPE_N)
        })
    })

    it('cvd/cvdSlope 須符合 rolling delta 定義 (與獨立參考實作逐點比對)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcCvd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exp = refCvd(arr, len, SLOPE_N)
            assertNearAll(r.vs, 'cvd', exp.map((v) => {
                return v.cvd
            }), 1e-9, `${period} cvd`)
            assertNearAll(r.vs, 'cvdSlope', exp.map((v) => {
                return v.cvdSlope
            }), 1e-9, `${period} cvdSlope`)
        })
    })

    it('手算例: 7 根自訂量能與主動買量比例, 12hr 逐筆手算驗證', async function() {
        //buyRatio = TakerBuy/Volumn, delta = 2*buyRatio-1
        //buyRatio: [0.5, 0.9, 0.1, 0.6, 0.4, 0.8, 0.2]
        //delta:    [0,   0.8, -0.8, 0.2, -0.2, 0.6, -0.6]
        let arr = ohlcFromCloses([10, 11, 10, 12, 11, 13, 12], { wick: 0 })
        let brs = [0.5, 0.9, 0.1, 0.6, 0.4, 0.8, 0.2]
        arr.forEach((v, i) => {
            v.Volumn = 100
            v.TakerBuyBaseAssetVolume = 100 * brs[i]
        })
        let rrs = await calcCvd(arr, 'Close')

        //12hr(len=3), sqrt3=√3
        //cvd[2]=(delta0+delta1+delta2)/√3=(0+0.8-0.8)/√3=0
        //cvd[3]=(delta1+delta2+delta3)/√3=(0.8-0.8+0.2)/√3=0.2/√3
        //cvd[4]=(delta2+delta3+delta4)/√3=(-0.8+0.2-0.2)/√3=-0.8/√3
        //cvd[5]=(delta3+delta4+delta5)/√3=(0.2-0.2+0.6)/√3=0.6/√3
        //cvd[6]=(delta4+delta5+delta6)/√3=(-0.2+0.6-0.6)/√3=-0.2/√3
        //輸出起始 index=len-1+SLOPE_N=2+3=5
        //i=5: cvd=cvd[5]=0.6/√3, cvdPrev=cvd[2]=0, cvdSlope=(0.6/√3-0)/3
        //i=6: cvd=cvd[6]=-0.2/√3, cvdPrev=cvd[3]=0.2/√3, cvdSlope=(-0.2/√3-0.2/√3)/3
        let sqrt3 = Math.sqrt(3)
        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 2)
        assertNear(r3.vs[0].cvd, 0.6 / sqrt3, 1e-9, '12hr[0].cvd')
        assertNear(r3.vs[0].cvdSlope, (0.6 / sqrt3) / 3, 1e-9, '12hr[0].cvdSlope')
        assert.strictEqual(r3.vs[0].time, arr[5].time)
        assertNear(r3.vs[1].cvd, -0.2 / sqrt3, 1e-9, '12hr[1].cvd')
        assertNear(r3.vs[1].cvdSlope, (-0.2 / sqrt3 - 0.2 / sqrt3) / 3, 1e-9, '12hr[1].cvdSlope')
        assert.strictEqual(r3.vs[1].time, arr[6].time)

        //20hr(len=5)以上僅 7 根資料不足 (需 n>=len+SLOPE_N=8, 7<8)
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 0)
    })

    it('cvd 須落在 [-√len, √len] 範圍內 (delta∈[-1,1] 之 len 項總和除以 √len)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcCvd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let bound = Math.sqrt(len)
            assertRange(r.vs, 'cvd', -bound, bound, period)
        })
    })

    it('資料筆數不足 (n < len+SLOPE_N) 時各期皆回傳空陣列', async function() {
        let arr = genOhlc(5)
        let rrs = await calcCvd(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('TakerBuyBaseAssetVolume 非數值時應拋出例外', async function() {
        let arr = genOhlc(20)
        arr[1].TakerBuyBaseAssetVolume = 'x'
        await assert.rejects(calcCvd(arr, 'Close'))
    })

})
