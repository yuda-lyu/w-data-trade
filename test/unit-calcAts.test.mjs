import assert from 'assert'
import calcAts from '../src/calcAts.mjs'
import { genOhlc, genTimes, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcAts.mjs
//  ats[i] = NumberOfTrades[i]>0 ? QuoteAssetVolume[i]/NumberOfTrades[i] : 0  (nt=0 防呆, ats 設為 0)
//  baseline = 最近 len 根 ats 之算術平均 (視窗 [i-len+1, i], 含當根)
//  atsRatio  = baseline!==0 ? ats[i]/baseline : 1  (baseline=0 特例回 1)
//  atsChange = atsPrev!==0 ? (ats[i]-ats[i-1])/ats[i-1] : 0  (atsPrev=0 特例回 0)
//  第一筆輸出對應輸入索引 = len-1 (需 len 根組 baseline, 且需前一根算 atsPrev), n < len+1 時該期回傳 []
//  QuoteAssetVolume / NumberOfTrades 非數值時 throw
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

//小工具: 依 time/QuoteAssetVolume/NumberOfTrades 造出最小可用列
let bar = (time, qv, nt) => {
    return { time, QuoteAssetVolume: qv, NumberOfTrades: nt }
}

//參考實作: 依定義每筆重新掃視窗計算 (不沿用 src 之遞增 running sum 技巧)
let refAts = (qvs, nts, len) => {
    let n = qvs.length
    let atss = qvs.map((qv, i) => {
        return nts[i] > 0 ? qv / nts[i] : 0
    })
    let rs = []
    for (let i = len - 1; i < n; i++) {
        let sum = 0
        for (let j = i - len + 1; j <= i; j++) {
            sum += atss[j]
        }
        let baseline = sum / len
        let ats = atss[i]
        let atsRatio = baseline !== 0 ? ats / baseline : 1
        let atsPrev = atss[i - 1]
        let atsChange = atsPrev !== 0 ? (ats - atsPrev) / atsPrev : 0
        rs.push({ atsRatio, atsChange })
    }
    return rs
}


describe('calcAts', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(300)
        let rrs = await calcAts(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(300)
        let rrs = await calcAts(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('atsRatio/atsChange 須逐點符合定義', async function() {
        let arr = genOhlc(300)
        let qvs = valuesOf(arr, 'QuoteAssetVolume')
        let nts = valuesOf(arr, 'NumberOfTrades')
        let rrs = await calcAts(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exp = refAts(qvs, nts, len)
            let atsRatios = exp.map((v) => {
                return v.atsRatio
            })
            let atsChanges = exp.map((v) => {
                return v.atsChange
            })
            assertNearAll(r.vs, 'atsRatio', atsRatios, 1e-9, `${period} atsRatio`)
            assertNearAll(r.vs, 'atsChange', atsChanges, 1e-9, `${period} atsChange`)
        })
    })

    it('手算例: qv=[10,20,12,40,25], nt=[2,4,3,5,5], 12hr(len=3) 之三筆輸出', async function() {
        // ats = [5,5,4,8,5]
        // i=2: baseline=(5+5+4)/3=14/3, atsRatio=4/(14/3)=6/7, atsPrev=5, atsChange=(4-5)/5=-0.2
        // i=3: baseline=(5+4+8)/3=17/3, atsRatio=8/(17/3)=24/17, atsPrev=4, atsChange=(8-4)/4=1
        // i=4: baseline=(4+8+5)/3=17/3, atsRatio=5/(17/3)=15/17, atsPrev=8, atsChange=(5-8)/8=-0.375
        let ts = genTimes(5)
        let qv = [10, 20, 12, 40, 25]
        let nt = [2, 4, 3, 5, 5]
        let arr = ts.map((t, i) => {
            return bar(t, qv[i], nt[i])
        })
        let rrs = await calcAts(arr, 'Close')
        let vs = pickPeriod(rrs, '12hr').vs
        assert.strictEqual(vs.length, 3)
        assertNear(vs[0].atsRatio, 6 / 7, 1e-12, 'i=2 atsRatio')
        assertNear(vs[0].atsChange, -0.2, 1e-12, 'i=2 atsChange')
        assert.strictEqual(vs[0].time, ts[2])
        assertNear(vs[1].atsRatio, 24 / 17, 1e-12, 'i=3 atsRatio')
        assertNear(vs[1].atsChange, 1, 1e-12, 'i=3 atsChange')
        assertNear(vs[2].atsRatio, 15 / 17, 1e-12, 'i=4 atsRatio')
        assertNear(vs[2].atsChange, -0.375, 1e-12, 'i=4 atsChange')
    })

    it('NumberOfTrades=0 之列, ats 視為 0 (不 throw, 亦不除以0)', async function() {
        // nt=[0,5,5,5], qv=[100,10,10,10] => ats=[0,2,2,2]
        // i=2(len=3之首筆): baseline=(0+2+2)/3=4/3, ats=2, atsRatio=2/(4/3)=1.5, atsPrev=2, atsChange=0
        let ts = genTimes(4)
        let qv = [100, 10, 10, 10]
        let nt = [0, 5, 5, 5]
        let arr = ts.map((t, i) => {
            return bar(t, qv[i], nt[i])
        })
        let rrs = await calcAts(arr, 'Close')
        let vs = pickPeriod(rrs, '12hr').vs
        assertNear(vs[0].atsRatio, 1.5, 1e-12, 'atsRatio')
        assertNear(vs[0].atsChange, 0, 1e-12, 'atsChange')
    })

    it('baseline=0 (視窗內 ats 全為 0) 時 atsRatio 特例回傳 1', async function() {
        // nt=[0,0,0,5], qv 皆為正但 nt=0 => ats=[0,0,0,2]
        // i=2: baseline=(0+0+0)/3=0 => atsRatio=1 (特例), atsPrev=ats[1]=0 => atsChange=0 (特例)
        let ts = genTimes(4)
        let qv = [1, 1, 1, 10]
        let nt = [0, 0, 0, 5]
        let arr = ts.map((t, i) => {
            return bar(t, qv[i], nt[i])
        })
        let rrs = await calcAts(arr, 'Close')
        let vs = pickPeriod(rrs, '12hr').vs
        assertNear(vs[0].atsRatio, 1, 1e-12, 'baseline=0 之 atsRatio 特例')
        assertNear(vs[0].atsChange, 0, 1e-12, 'atsPrev=0 之 atsChange 特例')
    })

    it('資料筆數不足 (n < len+1) 時該期回傳空陣列', async function() {
        let arr = genOhlc(3) // 3 < 12hr(3)+1=4, 亦小於其餘所有 period 之門檻
        let rrs = await calcAts(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('QuoteAssetVolume 或 NumberOfTrades 非數值時應 throw', async function() {
        let ts = genTimes(4)
        let arrBadQv = ts.map((t, i) => {
            return { time: t, QuoteAssetVolume: i === 1 ? 'bad' : 10, NumberOfTrades: 5 }
        })
        await assert.rejects(calcAts(arrBadQv, 'Close'), 'QuoteAssetVolume 非數值應 throw')

        let arrBadNt = ts.map((t, i) => {
            return { time: t, QuoteAssetVolume: 10, NumberOfTrades: i === 1 ? 'bad' : 5 }
        })
        await assert.rejects(calcAts(arrBadNt, 'Close'), 'NumberOfTrades 非數值應 throw')
    })

})
