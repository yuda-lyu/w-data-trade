import assert from 'assert'
import calcVortex from '../src/calcVortex.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcVortex.mjs
//  Vortex Indicator (Etienne Botes & Douglas Siepman 原始定義)
//  VM+ [i] = |High[i] - Low[i-1]|
//  VM- [i] = |Low[i]  - High[i-1]|
//  TR  [i] = max(|High[i]-Low[i]|, |High[i]-Close[i-1]|, |Low[i]-Close[i-1]|)
//  VI+ [i] = sum(VM+, 視窗 i-len+1..i) / sum(TR, 同視窗)
//  VI- [i] = sum(VM-, 同視窗) / sum(TR, 同視窗)
//  VIdiff = VI+ - VI- , VIsum = VI+ + VI-
//  sum(TR)=0 時 (無波動) 直接給 VI+ = VI- = 0 (src 明列之除零保護, 不走 diviProt)
//  第一筆輸出對應輸入索引 len (因需前一根, 計算自 i=1 起, 視窗滿 len 根需 i>=len)
//  n < len+1 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
}

//參考實作: 每根輸出各自暴力重掃視窗內 len 根之 VM+/VM-/TR, 不用 running sum
let refVortex = (arr, len) => {
    let rs = []
    for (let i = len; i < arr.length; i++) {
        let sVp = 0
        let sVm = 0
        let sTr = 0
        for (let j = i - len + 1; j <= i; j++) {
            let h = arr[j].High
            let l = arr[j].Low
            let hPrev = arr[j - 1].High
            let lPrev = arr[j - 1].Low
            let cPrev = arr[j - 1].Close
            sVp += Math.abs(h - lPrev)
            sVm += Math.abs(l - hPrev)
            sTr += Math.max(Math.abs(h - l), Math.abs(h - cPrev), Math.abs(l - cPrev))
        }
        rs.push({
            VIplus: sTr === 0 ? 0 : sVp / sTr,
            VIminus: sTr === 0 ? 0 : sVm / sTr,
        })
    }
    return rs
}


describe('calcVortex', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊 (VM/TR 需前一根, 故非 len-1)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('VI+ 須等於視窗內 sum(VM+)/sum(TR)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refVortex(arr, len).map((v) => {
                return v.VIplus
            })
            assertNearAll(r.vs, 'VIplus', exps, 1e-9, period)
        })
    })

    it('VI- 須等於視窗內 sum(VM-)/sum(TR)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refVortex(arr, len).map((v) => {
                return v.VIminus
            })
            assertNearAll(r.vs, 'VIminus', exps, 1e-9, period)
        })
    })

    it('VIdiff 與 VIsum 須為 VI+ 與 VI- 之差與和', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.VIdiff, v.VIplus - v.VIminus, `${r.period} 第 ${i} 筆 VIdiff`)
                assert.strictEqual(v.VIsum, v.VIplus + v.VIminus, `${r.period} 第 ${i} 筆 VIsum`)
            })
        })
    })

    it('手算例: 4 根 K 線於 len=3 之 VI+ = 1.2, VI- = 0.4', async function() {
        //收盤 [10,12,11,13] 且無影線, 故 O/H/L/C 為
        //  i=0: O=10 H=10 L=10 C=10
        //  i=1: O=10 H=12 L=10 C=12
        //  i=2: O=12 H=12 L=11 C=11
        //  i=3: O=11 H=13 L=11 C=13
        //手算 (視窗 i=1..3):
        //  i=1: VM+=|12-10|=2, VM-=|10-10|=0, TR=max(|12-10|,|12-10|,|10-10|)=2
        //  i=2: VM+=|12-10|=2, VM-=|11-12|=1, TR=max(|12-11|,|12-12|,|11-12|)=1
        //  i=3: VM+=|13-11|=2, VM-=|11-12|=1, TR=max(|13-11|,|13-11|,|11-11|)=2
        //  sum(VM+)=6, sum(VM-)=2, sum(TR)=5
        //  VI+ = 6/5 = 1.2, VI- = 2/5 = 0.4, VIdiff = 0.8, VIsum = 1.6
        let arr = ohlcFromCloses([10, 12, 11, 13], { wick: 0 })
        let rrs = await calcVortex(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[3].time)
        assertNear(r.vs[0].VIplus, 1.2, 1e-12, '12hr VI+')
        assertNear(r.vs[0].VIminus, 0.4, 1e-12, '12hr VI-')
        assertNear(r.vs[0].VIdiff, 0.8, 1e-12, '12hr VIdiff')
        assertNear(r.vs[0].VIsum, 1.6, 1e-12, '12hr VIsum')
        //len=4 之 16hr 需 n>=5, 故無輸出
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('VI+ 與 VI- 恆不為負 (分子分母皆為絕對值/最大值之和)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVortex(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assert.ok(v.VIplus >= 0, `${r.period} 第 ${i} 筆 VI+ 為負: ${v.VIplus}`)
                assert.ok(v.VIminus >= 0, `${r.period} 第 ${i} 筆 VI- 為負: ${v.VIminus}`)
            })
        })
    })

    it('定值序列無波動, sum(TR)=0 觸發除零保護, VI+ 與 VI- 皆為 0', async function() {
        //定值序列 O=H=L=C=100, 故 VM+=VM-=TR=0, 依 src 之除零保護給 0 (非 NaN)
        let arr = genFlat(100)
        let rrs = await calcVortex(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.VIplus, 0, `${r.period} 第 ${i} 筆 VI+`)
                assert.strictEqual(v.VIminus, 0, `${r.period} 第 ${i} 筆 VI-`)
                assert.strictEqual(v.VIdiff, 0, `${r.period} 第 ${i} 筆 VIdiff`)
                assert.strictEqual(v.VIsum, 0, `${r.period} 第 ${i} 筆 VIsum`)
            })
        })
    })

    it('單調上升 (每根漲 1 且無影線) 之 VI+ = 2, VI- = 0', async function() {
        //genUp 之 step=1 無影線: i>=1 時 High[i]=C[i], Low[i]=C[i-1], 且 C[i]-C[i-1]=1
        //  i>=2: VM+ = |C[i]-C[i-2]| = 2, VM- = |C[i-1]-C[i-1]| = 0, TR = max(1,1,0) = 1
        //  i=1 特殊 (第 0 根 High=Low=C[0]): VM+ = 1
        //  視窗完全落在 i>=2 (即輸出第 2 筆起) 時 VI+ = 2*len/len = 2, VI- = 0
        //  第 1 筆視窗含 i=1, VI+ = (2*len-1)/len
        let arr = genUp(200)
        let rrs = await calcVortex(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            r.vs.forEach((v, i) => {
                let exp = i === 0 ? (2 * len - 1) / len : 2
                assertNear(v.VIplus, exp, 1e-9, `${period} 第 ${i} 筆 VI+`)
                assertNear(v.VIminus, 0, 1e-9, `${period} 第 ${i} 筆 VI-`)
                assert.ok(v.VIplus > v.VIminus, `${period} 第 ${i} 筆 上升趨勢 VI+ 須大於 VI-`)
            })
        })
    })

    it('單調下降 (每根跌 1 且無影線) 之 VI- = 2, VI+ = 0', async function() {
        //genDown 之 step=1 無影線: i>=1 時 High[i]=C[i-1], Low[i]=C[i], 且 C[i-1]-C[i]=1
        //  i>=2: VM- = |C[i]-C[i-2]| = 2, VM+ = |C[i-1]-C[i-1]| = 0, TR = max(1,0,1) = 1
        //  i=1 特殊 (第 0 根 High=Low=C[0]): VM- = 1
        let arr = genDown(200)
        let rrs = await calcVortex(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            r.vs.forEach((v, i) => {
                let exp = i === 0 ? (2 * len - 1) / len : 2
                assertNear(v.VIminus, exp, 1e-9, `${period} 第 ${i} 筆 VI-`)
                assertNear(v.VIplus, 0, 1e-9, `${period} 第 ${i} 筆 VI+`)
                assert.ok(v.VIminus > v.VIplus, `${period} 第 ${i} 筆 下降趨勢 VI- 須大於 VI+`)
            })
        })
    })

    it('資料筆數不足 len+1 時該期回傳空陣列', async function() {
        //n=3 未達最短期 12hr 之 len+1=4
        let arr = genOhlc(3)
        let rrs = await calcVortex(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('High 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[1].High = null
        await assert.rejects(calcVortex(arr, 'Close'), /invalid h/)
    })

    it('Low 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[1].Low = null
        await assert.rejects(calcVortex(arr, 'Close'), /invalid l/)
    })

    it('前一根 Close 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[0].Close = null
        await assert.rejects(calcVortex(arr, 'Close'), /invalid cPrev/)
    })

    it('視窗僅取最近 len 根, 更早之極端波動不影響結果', async function() {
        //以 12hr (len=3) 驗證: 把第 0~1 根換成極端值後, 索引 6 之輸出 (視窗 4..6) 須不變
        let cs = [100, 101, 102, 103, 104, 105, 106]
        let a1 = ohlcFromCloses(cs, { wick: 0 })
        let a2 = ohlcFromCloses([1, 500, 102, 103, 104, 105, 106], { wick: 0 })
        let r1 = pickPeriod(await calcVortex(a1, 'Close'), '12hr')
        let r2 = pickPeriod(await calcVortex(a2, 'Close'), '12hr')
        let v1 = r1.vs[r1.vs.length - 1]
        let v2 = r2.vs[r2.vs.length - 1]
        assertNear(v2.VIplus, v1.VIplus, 1e-9, '末筆 VI+')
        assertNear(v2.VIminus, v1.VIminus, 1e-9, '末筆 VI-')
    })

    it('可接受不同起始價位, 結果僅取決於 OHLC 幾何關係', async function() {
        //Vortex 為比值指標, 對整體平移之絕對價位不敏感 (但非尺度無關, 故僅驗平移)
        let cs = valuesOf(genOhlc(60), 'Close')
        let a1 = ohlcFromCloses(cs, { wick: 0 })
        let a2 = ohlcFromCloses(cs.map((c) => {
            return c + 1000
        }), { wick: 0 })
        let r1 = pickPeriod(await calcVortex(a1, 'Close'), '1day')
        let r2 = pickPeriod(await calcVortex(a2, 'Close'), '1day')
        assertNearAll(r2.vs, 'VIplus', r1.vs.map((v) => {
            return v.VIplus
        }), 1e-9, '平移後 VI+')
    })

})
