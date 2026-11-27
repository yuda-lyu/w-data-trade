import assert from 'assert'
import calcDown from '../src/calcDown.mjs'
import wdt from '../src/WDataTrade.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear } from './unit-setup.mjs'
import { KP, mkBars, mkGeo, mkAlt, sum, popStd, win, distinct, labelOf, intBads, numBads, assertOptK3, assertFiniteRrs, assertCausal, assertIntervalSec } from './unit-setupFeat.mjs'


//規格來源: src/calcDown.mjs 之 JSDoc(下跌之統計)
//  D1 記號: lc = ln(key 欄位), r(i) = lc(i) − lc(i−1)(i ≥ 1), W(i, m) = 第 i−m+1 ~ i 根, σ(j) = r 於 W(j, volLen) 之母體標準差(j ≥ volLen; σ(j) 含第 j 根自身之報酬); 只用當根(含)以前之資料; 讀 key 欄位與 Volumn
//  D2 輸出欄(第 i 根; 期別根數 len):
//       downBars = W(i, len) 內 r(j) < 0 之根數 / len
//       downVol  = W(i, len) 內 r(j) < 0 之根之 Volumn 之和 / W(i, len) 內 Volumn 之和, 分母 ≤ 0 ⇒ 0.5
//       crashN   = W(i, len) 內「σ(j) > 0 且 r(j) / σ(j) ≤ −crashK」之根數
//  D3 s0 = len + volLen − 1(W(i, len) 內最早一根 j = i − len + 1 需有 σ(j), 即 j ≥ volLen); 第一筆對應輸入索引 s0, 逐根對齊至最後一根; 筆數 n < s0 + 1 ⇒ 該期 vs 為 []
//  D4 選項 opt.volLen(至少為 2 之整數, 預設 30)、opt.crashK(有限且大於 0 之數值, 預設 1.5)皆為跨套件規格 K3(非預期之輸入視為未給而改用預設, opt.debug 為 true 時警告)、opt.intervalSec、opt.kp; 輸入檢核: key 須為非空字串、key 欄位須為正之有限數、Volumn 須為不小於 0 之有限數(訊息不含輸入值); 輸出皆為有限數值
//  D5 σ 之下限: σ 為 0 者及 σ 不大於 1e-12 者(完全等比之序列僅差浮點捨入)視為 0 ⇒ 不計暴跌


let msgArr = 'invalid arr: must have a positive finite value of key in every element'
let msgVol = 'invalid arr: must have a finite Volumn >= 0 in every element'
let msgKey = 'invalid key: must be a non-empty string'
let msgKp = 'invalid opt.kp: must be an object of positive integers'
let msgIv = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let COLS = ['downBars', 'downVol', 'crashN']

//s0Of, 各期第一筆對應之輸入索引
let s0Of = (len, volLen = 30) => len + volLen - 1

//refDown, 暴力計算: 依 D1 ~ D3 逐根以陣列切片與定義式計算(不 import src 之內部邏輯)
let refDown = (arr, key, len, volLen = 30, crashK = 1.5) => {
    let lc = arr.map((v) => Math.log(v[key]))
    let vol = arr.map((v) => v.Volumn)
    let r = lc.map((v, i) => (i === 0 ? NaN : v - lc[i - 1]))
    //rw, r 於 W(i, m); r(0) 不存在, 起點須 ≥ 1
    let rw = (i, m) => {
        assert.ok(i - m + 1 >= 1, `r 之視窗起點 ${i - m + 1} 小於 1`)
        return win(r, i, m)
    }
    let sg = (j) => popStd(rw(j, volLen))
    let out = []
    for (let i = s0Of(len, volLen); i < lc.length; i++) {
        let js = Array.from({ length: len }, (_, k) => i - len + 1 + k)
        let dn = js.filter((j) => r[j] < 0)
        let vAll = sum(js.map((j) => vol[j]))
        out.push({
            i,
            downBars: dn.length / len,
            downVol: vAll > 0 ? sum(dn.map((j) => vol[j])) / vAll : 0.5,
            crashN: js.filter((j) => {
                let s = sg(j)
                return s > 0 && r[j] / s <= -crashK
            }).length,
        })
    }
    return out
}

//assertSameAsRef, 某期之 vs 與暴力計算逐根逐欄相同
let assertSameAsRef = (vs, arr, ref, msg) => {
    assert.strictEqual(vs.length, ref.length, `${msg} 筆數`)
    vs.forEach((v, k) => {
        let e = ref[k]
        assert.strictEqual(v.time, arr[e.i].time, `${msg} 第 ${k} 筆 time`)
        COLS.forEach((c) => {
            assertNear(v[c], e[c], 1e-9, `${msg} 第 ${k} 筆(根 ${e.i}) ${c}`)
        })
    })
}


describe('calcDown', function() {

    let arr = mkBars(700, 3)

    it('D2 回傳結構: 內建週期表之 period 與 len(同 calcCvd)、各筆之欄為 time、downBars、downVol、crashN', async function() {
        let rrs = await calcDown(arr, 'Close')
        assertRrsShape(rrs, KP)
        assertFiniteRrs(rrs, COLS, '內建表')
        assert.deepStrictEqual(rrs.map((r) => Object.keys(r)), rrs.map(() => ['period', 'len', 'vs']))
        assert.strictEqual(wdt.calcDown, calcDown)
    })

    it('D3 各期自 s0 = len + volLen − 1 起算並逐根對齊; n = s0 ⇒ []、n = s0 + 1 ⇒ 恰 1 筆(含不同之 volLen 與 len = 1)', async function() {
        let rrs = await calcDown(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let s0 = s0Of(len)
            assert.strictEqual(s0, len + 29)
            assertTimeAlign(pickPeriod(rrs, period).vs, arr, s0)
            let r0 = pickPeriod(await calcDown(arr.slice(0, s0), 'Close'), period)
            assert.deepStrictEqual(r0.vs, [], `${period} n = s0`)
            let r1 = pickPeriod(await calcDown(arr.slice(0, s0 + 1), 'Close'), period)
            assert.strictEqual(r1.vs.length, 1, `${period} n = s0 + 1`)
            assert.strictEqual(r1.vs[0].time, arr[s0].time, `${period} n = s0 + 1 之 time`)
        }
        for (let [volLen, len, expS0] of [[2, 3, 4], [60, 24, 83], [10, 1, 10], [2, 1, 2], [5, 180, 184]]) {
            assert.strictEqual(s0Of(len, volLen), expS0, '手算 s0')
            let opt = { volLen, kp: { x: len } }
            assert.deepStrictEqual((await calcDown(arr.slice(0, expS0), 'Close', opt))[0].vs, [], `volLen ${volLen} len ${len} n = s0`)
            let r1 = (await calcDown(arr.slice(0, expS0 + 1), 'Close', opt))[0]
            assert.deepStrictEqual(r1.vs.map((v) => v.time), [arr[expS0].time], `volLen ${volLen} len ${len} n = s0 + 1`)
        }
    })

    it('D2 與暴力計算逐根逐欄相同(全部 9 期、預設選項; 另 volLen = 7 且 crashK = 0.8 一組、volLen = 2 且 crashK = 2.5 一組、len = 1 一期)', async function() {
        let rrs = await calcDown(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let ref = refDown(arr, 'Close', len)
            assert.ok(ref.length > 0, `${period} 須有輸出`)
            assertSameAsRef(pickPeriod(rrs, period).vs, arr, ref, period)
        }
        for (let [volLen, crashK] of [[7, 0.8], [2, 2.5]]) {
            let r2 = await calcDown(arr, 'Close', { volLen, crashK })
            for (let [period, len] of Object.entries(KP)) {
                assertSameAsRef(pickPeriod(r2, period).vs, arr, refDown(arr, 'Close', len, volLen, crashK), `volLen ${volLen} crashK ${crashK} ${period}`)
            }
        }
        let r1 = (await calcDown(arr, 'Close', { kp: { one: 1 } }))[0]
        assert.deepStrictEqual([r1.period, r1.len], ['one', 1])
        assertSameAsRef(r1.vs, arr, refDown(arr, 'Close', 1), 'len = 1')
    })

    it('D2 手算例: 收盤 100、102、104、97、100、96, 量 10、20、30、40、50、100, len = 3、volLen = 2 ⇒ 第 4、5 根逐欄手算; crashK 為 1.6 時暴跌不成立', async function() {
        let cl = [100, 102, 104, 97, 100, 96]
        let vl = [10, 20, 30, 40, 50, 100]
        let a = ohlcFromCloses(cl, { vols: vl })
        //r(1..5) = ln(1.02)、ln(104/102)、ln(97/104)、ln(100/97)、ln(96/100) = 0.0198、0.0194、−0.0697、0.0305、−0.0408
        //σ(2) = std{r1, r2} ≈ 0.0002(r2 > 0, 非暴跌); σ(3) = std{r2, r3} = |r2 − r3| / 2 = 0.04454 ⇒ r3 / σ(3) = −1.564(≤ −1.5, 暴跌; 但 > −1.6)
        //σ(4) = std{r3, r4} = 0.05008, r4 > 0; σ(5) = std{r4, r5} = 0.03565 ⇒ r5 / σ(5) = −1.145(> −1.5, 非暴跌)
        let r = (x, y) => Math.log(y / x)
        let sd3 = Math.abs(r(102, 104) - r(104, 97)) / 2
        let z3 = r(104, 97) / sd3
        assert.ok(z3 < -1.5 && z3 > -1.6, `前提: r3/σ3 = ${z3}`)
        let sd5 = Math.abs(r(97, 100) - r(100, 96)) / 2
        assert.ok(r(100, 96) / sd5 > -1.5, '前提: r5/σ5 > −1.5')
        let o = await calcDown(a, 'Close', { volLen: 2, kp: { x: 3 } })
        //根 4: W = {2, 3, 4}; 收跌 = {3} ⇒ downBars 1/3; 量 = 30 + 40 + 50 = 120, 收跌之量 40 ⇒ 1/3; 暴跌 = {3} ⇒ 1
        //根 5: W = {3, 4, 5}; 收跌 = {3, 5} ⇒ downBars 2/3; 量 = 40 + 50 + 100 = 190, 收跌之量 40 + 100 ⇒ 140/190; 暴跌 = {3} ⇒ 1
        let exps = [[1 / 3, 1 / 3, 1], [2 / 3, 140 / 190, 1]]
        assert.deepStrictEqual(o[0].vs.map((v) => v.time), [a[4].time, a[5].time])
        exps.forEach(([b, v, c], k) => {
            assertNear(o[0].vs[k].downBars, b, 1e-12, `第 ${k} 筆 downBars`)
            assertNear(o[0].vs[k].downVol, v, 1e-12, `第 ${k} 筆 downVol`)
            assert.strictEqual(o[0].vs[k].crashN, c, `第 ${k} 筆 crashN`)
        })
        //crashK = 1.6 ⇒ r3 / σ3 = −1.564 > −1.6, 無暴跌; crashK = 1.5 同預設
        let o2 = await calcDown(a, 'Close', { volLen: 2, kp: { x: 3 }, crashK: 1.6 })
        assert.deepStrictEqual(o2[0].vs.map((v) => v.crashN), [0, 0])
        assert.deepStrictEqual(o2[0].vs.map((v) => v.downBars), o[0].vs.map((v) => v.downBars), 'crashK 不影響 downBars')
        assert.deepStrictEqual((await calcDown(a, 'Close', { volLen: 2, kp: { x: 3 }, crashK: 1.5 }))[0], o[0])
    })

    it('D2 門檻之等號: r(j) / σ(j) 恰為 −1(收盤 100、102、100: r1 = a、r2 = −a 互為相反數, σ(2) = a)時 crashK = 1 與 0.9 成立、1.0000001 不成立', async function() {
        let a = ohlcFromCloses([100, 102, 100, 101], { vols: [10, 20, 30, 40] })
        let at = async(crashK) => (await calcDown(a, 'Close', { volLen: 2, crashK, kp: { x: 1 } }))[0].vs.map((v) => v.crashN)
        //len = 1 ⇒ s0 = 2; 輸出為根 2、3: 根 2 之 z = −1, 根 3 之 r(3) > 0
        assert.deepStrictEqual(await at(1), [1, 0])
        assert.deepStrictEqual(await at(0.9), [1, 0])
        assert.deepStrictEqual(await at(1.0000001), [0, 0])
    })

    it('D2 退化: σ = 0 ⇒ 不算暴跌(定值序列: crashN 為 0、downBars 為 0、量為正時 downVol 為 0 而非 0.5); 定值段與波動段相接', async function() {
        let a = genFlat(200)
        let rrs = await calcDown(a, 'Close')
        let nOut = 0
        rrs.forEach((r) => {
            r.vs.forEach((v) => {
                assert.deepStrictEqual({ ...v, time: 0 }, { time: 0, downBars: 0, downVol: 0, crashN: 0 }, r.period)
                nOut++
            })
        })
        assert.ok(nOut > 1000, `輸出筆數 ${nOut}`)
        //前 60 根隨機漫步、其後 60 根收盤全相同(r = 0 而 σ 於定值段尾端為 0): 與暴力計算相同, 且 σ = 0 之根(j ≥ 89)不計暴跌
        let c0 = valuesOf(mkBars(60, 11), 'Close')
        let cc = [...c0, ...new Array(60).fill(c0[59])]
        let b = ohlcFromCloses(cc, { wick: 0 })
        let rs = await calcDown(b, 'Close', { kp: { x: 3, y: 12 } })
        rs.forEach((r) => {
            assertSameAsRef(r.vs, b, refDown(b, 'Close', r.len), `定值段 ${r.period}`)
            r.vs.forEach((v, k) => {
                let i = s0Of(r.len) + k
                if (i - r.len + 1 >= 89) {
                    assert.strictEqual(v.crashN, 0, `${r.period} 根 ${i} crashN`)
                    assert.strictEqual(v.downBars, 0, `${r.period} 根 ${i} downBars`)
                    assert.strictEqual(v.downVol, 0, `${r.period} 根 ${i} downVol`)
                }
            })
        })
    })

    it('D5 σ 之下限: 完全等比之序列(r 理論上全同, 實際 σ 僅為浮點捨入之殘值)⇒ 不計暴跌(crashN 為 0); 下跌者 downBars 為 1、downVol 為 1; 上漲者 downBars、downVol 為 0(全部 9 期)', async function() {
        for (let g of [0.99, 0.9997, 0.5, 1.01, 1.0003]) {
            let a = mkGeo(500, g)
            //鑑別前提: 某視窗之 σ 為 > 0 而 ≤ 1e-12 之殘值(σ 恆為精確 0 則測不到下限; 殘值使 r/σ 達 1e13 量級, 下跌者逐根誤計為暴跌)
            let lc = valuesOf(a, 'Close').map((c) => Math.log(c))
            let r = lc.slice(1).map((v, i) => v - lc[i])
            let mx = 0
            for (let i = 30; i <= r.length; i++) {
                mx = Math.max(mx, popStd(r.slice(i - 30, i)))
            }
            assert.ok(mx > 0 && mx <= 1e-12, `公比 ${g} 之 σ 殘值最大 ${mx} 須於 (0, 1e-12]`)
            let rrs = await calcDown(a, 'Close')
            assert.ok(rrs.every((rr) => rr.vs.length > 0), `公比 ${g} 各期須有輸出`)
            rrs.forEach((rr) => {
                rr.vs.forEach((v, k) => {
                    assert.ok(v.crashN === 0, `公比 ${g} ${rr.period} 第 ${k} 筆 crashN 應為 0`)
                    assert.ok(v.downBars === (g < 1 ? 1 : 0), `公比 ${g} ${rr.period} 第 ${k} 筆 downBars`)
                    assert.ok(v.downVol === (g < 1 ? 1 : 0), `公比 ${g} ${rr.period} 第 ${k} 筆 downVol`)
                })
            })
        }
    })

    it('D5 σ 之下限之邊界: 對數報酬為 +δ、−δ 交替(volLen 為偶數時 σ = δ, 下跌根之 r/σ = −1): δ = 1e-13 與 5e-13(σ ≤ 1e-12)⇒ 不計暴跌; δ = 2e-12、1e-11 與 1e-8(σ > 1e-12)⇒ 每個下跌根皆計暴跌(crashK = 0.9)', async function() {
        let opt = { volLen: 4, crashK: 0.9, kp: { a: 4 } }
        for (let [delta, degenerate] of [[1e-13, true], [5e-13, true], [2e-12, false], [1e-11, false], [1e-8, false]]) {
            let a = mkAlt(60, delta)
            let ra = pickPeriod(await calcDown(a, 'Close', opt), 'a')
            assert.ok(ra.vs.length > 20, `δ ${delta} 須有輸出`)
            ra.vs.forEach((v, k) => {
                //len = 4 之視窗恰含 2 個下跌根(r 為 +δ、−δ 交替)
                assertNear(v.downBars, 0.5, 1e-12, `δ ${delta} 第 ${k} 筆 downBars`)
                assert.ok(v.crashN === (degenerate ? 0 : 2), `δ ${delta} 第 ${k} 筆 crashN 為 ${v.crashN}`)
            })
        }
    })

    it('D2 退化: 視窗內量之和為 0 ⇒ downVol 為 0.5(其餘欄照算); 量為 0 之根全為收跌根而視窗內另有正量 ⇒ downVol 為 0', async function() {
        let a = mkBars(220, 61).map((v, i) => (i >= 100 && i < 140 ? { ...v, Volumn: 0, TakerBuyBaseAssetVolume: 0 } : v))
        let rs = await calcDown(a, 'Close', { kp: { x: 3, y: 12 } })
        let nHalf = 0
        let nBars = 0
        rs.forEach((r) => {
            assertSameAsRef(r.vs, a, refDown(a, 'Close', r.len), `零量段 ${r.period}`)
            r.vs.forEach((v, k) => {
                let i = s0Of(r.len) + k
                if (i - r.len + 1 >= 100 && i < 140) {
                    assert.strictEqual(v.downVol, 0.5, `${r.period} 根 ${i} downVol`)
                    nHalf++
                    if (v.downBars > 0) {
                        nBars++ //視窗內有收跌根而量全為 0: downVol 仍為 0.5, 非 0
                    }
                }
            })
        })
        assert.ok(nHalf > 40, `視窗全落在零量段之根數 ${nHalf}`)
        assert.ok(nBars > 10, `其中有收跌根之根數 ${nBars}(鑑別)`)
        //全部量為 0 ⇒ 全部 downVol 為 0.5
        let z = mkBars(300, 62).map((v) => ({ ...v, Volumn: 0, TakerBuyBaseAssetVolume: 0 }))
        let rz = await calcDown(z, 'Close')
        rz.forEach((r) => {
            assert.ok(r.vs.length > 0, r.period)
            r.vs.forEach((v) => {
                assert.strictEqual(v.downVol, 0.5)
            })
        })
        //收跌根之量為 0、其餘根量為正 ⇒ 視窗內另有正量(非全為收跌)時 downVol 為 0(分母 > 0); 視窗全為收跌根時量之和為 0 ⇒ 0.5
        let b = mkBars(120, 63)
        let lc = b.map((v) => Math.log(v.Close))
        let b2 = b.map((v, i) => (i >= 1 && lc[i] < lc[i - 1] ? { ...v, Volumn: 0, TakerBuyBaseAssetVolume: 0 } : v))
        let r2 = (await calcDown(b2, 'Close', { kp: { x: 6 } }))[0]
        assert.ok(r2.vs.length > 50)
        let nMix = 0
        r2.vs.forEach((v, k) => {
            assert.strictEqual(v.downVol, v.downBars === 1 ? 0.5 : 0, `第 ${k} 筆`)
            if (v.downBars > 0 && v.downBars < 1) {
                nMix++
            }
        })
        assert.ok(nMix > 20, `鑑別: 視窗內有收跌根且另有正量之根數 ${nMix}`)
    })

    it('D2 各欄之性質與鑑別: downBars 為 k / len、downVol 於 [0, 1]、crashN 為 0 ~ len 之整數; downBars 與 crashN 各期皆取到 3 種以上之值; crashK 越大 crashN 不增(且有嚴格減少)', async function() {
        let rrs = await calcDown(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, k) => {
                assert.ok(Math.abs(v.downBars * r.len - Math.round(v.downBars * r.len)) < 1e-9, `${r.period} 第 ${k} 筆 downBars ${v.downBars}`)
                assert.ok(v.downBars >= 0 && v.downBars <= 1, `${r.period} 第 ${k} 筆 downBars`)
                assert.ok(v.downVol >= 0 && v.downVol <= 1, `${r.period} 第 ${k} 筆 downVol ${v.downVol}`)
                assert.ok(Number.isInteger(v.crashN) && v.crashN >= 0 && v.crashN <= r.len, `${r.period} 第 ${k} 筆 crashN ${v.crashN}`)
            })
            assert.ok(distinct(r.vs, 'downBars') >= 3, `${r.period} downBars 取值個數 ${distinct(r.vs, 'downBars')}`)
            assert.ok(distinct(r.vs, 'crashN') >= 3, `${r.period} crashN 取值個數 ${distinct(r.vs, 'crashN')}`)
            assert.ok(distinct(r.vs, 'downVol') > r.vs.length * 0.4, `${r.period} downVol 取值個數 ${distinct(r.vs, 'downVol')}`)
        })
        let ks = [0.5, 1, 1.5, 2, 3]
        let outs = []
        for (let k of ks) {
            outs.push(await calcDown(arr, 'Close', { crashK: k }))
        }
        let nLess = 0
        outs[0].forEach((r0, j) => {
            for (let q = 1; q < ks.length; q++) {
                r0.vs.forEach((v0, i) => {
                    let c0 = outs[q - 1][j].vs[i].crashN
                    let c1 = outs[q][j].vs[i].crashN
                    assert.ok(c1 <= c0, `${r0.period} 第 ${i} 筆 crashK ${ks[q - 1]} → ${ks[q]}: ${c0} → ${c1}`)
                    if (c1 < c0) {
                        nLess++
                    }
                })
            }
        })
        assert.ok(nLess > 50, `嚴格減少之次數 ${nLess}`)
        //單調上升: 無收跌根; 單調下降: 全為收跌根
        let up = pickPeriod(await calcDown(genUp(200), 'Close'), '1day')
        assert.ok(up.vs.length > 100)
        up.vs.forEach((v) => {
            assert.deepStrictEqual({ ...v, time: 0 }, { time: 0, downBars: 0, downVol: 0, crashN: 0 })
        })
        let dn = pickPeriod(await calcDown(genDown(200), 'Close'), '1day')
        dn.vs.forEach((v) => {
            assert.strictEqual(v.downBars, 1)
            assert.strictEqual(v.downVol, 1)
        })
    })

    it('D1 只用當根以前之資料: 第 t 根之後依根而異地改動, 其前之輸出逐值不變而其後有變; 以第 t 根截斷之輸出同完整序列之前段', async function() {
        await assertCausal((a) => calcDown(a, 'Close'), arr, 400, [380, 450, 600], '預設')
        let a2 = mkBars(200, 29)
        await assertCausal((a) => calcDown(a, 'Close', { volLen: 5, crashK: 1, kp: { x: 4, y: 12 } }), a2, 100, [60, 130], '小參數')
    })

    it('D4 opt.volLen、opt.crashK: 預設(給預設值、數字字串(僅 volLen)、null、undefined 皆同未給); 給了而有效者確實生效; 極大 volLen ⇒ 各期 vs 為空', async function() {
        let base = await calcDown(arr, 'Close')
        for (let v of [30, '30', ' 30 ', '30.0', null, undefined]) {
            assert.deepStrictEqual(await calcDown(arr, 'Close', { volLen: v }), base, `volLen ${String(v)}`)
        }
        for (let v of [1.5, null, undefined]) {
            assert.deepStrictEqual(await calcDown(arr, 'Close', { crashK: v }), base, `crashK ${String(v)}`)
        }
        let r10 = await calcDown(arr, 'Close', { volLen: 10 })
        assert.notDeepStrictEqual(r10, base)
        assert.deepStrictEqual(await calcDown(arr, 'Close', { volLen: '10' }), r10)
        assert.notStrictEqual(pickPeriod(r10, '1day').vs[0].time, pickPeriod(base, '1day').vs[0].time)
        let rk = await calcDown(arr, 'Close', { crashK: 3 })
        assert.notDeepStrictEqual(rk, base)
        //crashK 只改 crashN
        rk.forEach((r, j) => {
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.downBars, base[j].vs[i].downBars)
                assert.strictEqual(v.downVol, base[j].vs[i].downVol)
            })
        })
        let big = await calcDown(arr, 'Close', { volLen: 1000000 })
        big.forEach((r) => {
            assert.deepStrictEqual(r.vs, [], r.period)
        })
        //極小之 crashK 亦為有效(有限且大於 0)
        assertFiniteRrs(await calcDown(arr, 'Close', { crashK: 1e-9 }), COLS, 'crashK 1e-9')
    })

    it('D4 opt.volLen、opt.crashK 非預期之輸入視為未給(K3): 結果同未給、不 reject; 合格寫法(數值、數字字串)轉為數值使用; opt.debug 為 true 時警告(固定詞彙、不含傳入之值、同鍵每行程一次)', async function() {
        let a = mkBars(120, 5)
        let base = await calcDown(a, 'Close')
        let r10 = await calcDown(a, 'Close', { volLen: 10 })
        let rk3 = await calcDown(a, 'Close', { crashK: 3 })
        assert.notDeepStrictEqual(r10, base, '鑑別: volLen 10 之結果異於預設')
        assert.notDeepStrictEqual(rk3, base, '鑑別: crashK 3 之結果異於預設')
        //合格之數字字串(含空白、正號、科學記號)與數值同值(K4)
        for (let v of ['10', ' 10 ', '+10', '10.0', '1e1']) {
            assert.deepStrictEqual(await calcDown(a, 'Close', { volLen: v }), r10, `volLen ${v}`)
        }
        for (let v of ['3', ' 3 ', '+3', '3.0', '3e0', '0.3e1']) {
            assert.deepStrictEqual(await calcDown(a, 'Close', { crashK: v }), rk3, `crashK ${v}`)
        }
        await assertOptK3({
            call: (o) => calcDown(a, 'Close', o),
            base,
            name: 'volLen',
            invalids: intBads(2),
            sames: [30, '30', ' 30 ', '3e1'],
            tag: 'w-data-trade calcDown',
            desc: 'an integer >= 2',
            defDesc: '30',
        })
        await assertOptK3({
            call: (o) => calcDown(a, 'Close', o),
            base,
            name: 'crashK',
            invalids: numBads(),
            sames: [1.5, '1.5', ' 1.5 ', '15e-1'],
            tag: 'w-data-trade calcDown',
            desc: 'a positive number',
            defDesc: '1.5',
        })
        //兩鍵同時非預期: 各自改用預設
        assert.deepStrictEqual(await calcDown(a, 'Close', { volLen: 'x', crashK: 'y' }), base)
        //一鍵非預期、另一鍵合格: 只前者改用預設
        assert.deepStrictEqual(await calcDown(a, 'Close', { volLen: 'x', crashK: 3 }), rk3)
        assert.deepStrictEqual(await calcDown(a, 'Close', { volLen: 10, crashK: 'y' }), r10)
    })

    it('D4 opt.kp: 原樣採用(標籤與值、數字字串轉數值、len = 1 可用)、結果同暴力計算; 非預期之輸入視為未給; 值為參數物件 ⇒ reject', async function() {
        let rrs = await calcDown(arr, 'Close', { kp: { a: 4, b: '7', c: 1 }, intervalSec: 86400 })
        assert.deepStrictEqual(rrs.map((r) => [r.period, r.len]), [['a', 4], ['b', 7], ['c', 1]])
        rrs.forEach((r) => {
            assertSameAsRef(r.vs, arr, refDown(arr, 'Close', r.len), `kp ${r.period}`)
        })
        let base = await calcDown(arr, 'Close')
        for (let kp of [{}, { a: 0 }, { a: -4 }, { a: 1.5 }, { a: 'abc' }, { a: 5, b: 0 }, 'x', 4, [4], null]) {
            assert.deepStrictEqual(await calcDown(arr, 'Close', { kp }), base, `kp ${JSON.stringify(kp)}`)
        }
        for (let kp of [{ a: { len: 5 } }, { a: 5, b: { mult: 2 } }]) {
            await assert.rejects(calcDown(arr, 'Close', { kp }), (e) => e.message === msgKp, `kp ${JSON.stringify(kp)}`)
        }
    })

    it('D4 opt.intervalSec = 86400: 期別標籤為 3day … 180day, 根數與各值同預設(含 3600、數字字串、14400); 無效 ⇒ reject(先於 opt.kp 與資料之檢核)', async function() {
        await assertIntervalSec((a, o) => calcDown(a, 'Close', o), arr, 'calcDown')
        for (let v of [0, -60, 59, 90, 1.5, 31536060, 'abc', '', NaN, Infinity, true, [], {}]) {
            await assert.rejects(calcDown(arr, 'Close', { intervalSec: v }), (e) => e.message === msgIv, `intervalSec ${String(v)}`)
            await assert.rejects(calcDown(arr, 'Close', { intervalSec: v, kp: { a: 5 } }), (e) => e.message === msgIv, `intervalSec ${String(v)} 與有效之 opt.kp`)
        }
        let bad = ohlcFromCloses([100, -1, 3])
        await assert.rejects(calcDown(bad, 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('D4 輸入檢核: key 欄位須為正之有限數、Volumn 須為不小於 0 之有限數(量為 0 可; 任一根無效即整批 reject, 訊息不含輸入值); key 缺欄位 ⇒ reject; null、undefined、{} 視為無資料; 非陣列之字串 reject', async function() {
        for (let bad of [0, -5, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], Close: bad }
            await assert.rejects(calcDown(a, 'Close'), (e) => e.message === msgArr, `Close ${String(bad)}`)
        }
        for (let bad of [-1, -1e-9, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], Volumn: bad }
            await assert.rejects(calcDown(a, 'Close'), (e) => e.message === msgVol, `Volumn ${String(bad)}`)
        }
        //最後一根無效亦拒
        let a1 = mkBars(60, 2)
        a1[59] = { ...a1[59], Close: -1 }
        await assert.rejects(calcDown(a1, 'Close'), (e) => e.message === msgArr)
        let a2 = mkBars(60, 2)
        a2[59] = { ...a2[59], Volumn: -1 }
        await assert.rejects(calcDown(a2, 'Close'), (e) => e.message === msgVol)
        //量為 0 可
        let a3 = mkBars(60, 2)
        a3[5] = { ...a3[5], Volumn: 0 }
        assertFiniteRrs(await calcDown(a3, 'Close'), COLS, '量為 0')
        //key 為非空字串而無該欄位 ⇒ 逐根檢核不過
        await assert.rejects(calcDown(mkBars(60, 2), 'Nope'), (e) => e.message === msgArr, `key Nope`)
        //key 非非空字串: 必須參數 ⇒ msgKey(先於 opt.intervalSec 與資料之檢核, 無資料之輸入亦拒)
        let rv = Proxy.revocable({}, {})
        rv.revoke()
        for (let k of [undefined, null, '', 5, true, {}, [], ['Close'], Symbol('s'), () => 'Close', Object('Close'), rv.proxy]) {
            await assert.rejects(calcDown(mkBars(60, 2), k), (e) => e.message === msgKey, `key ${labelOf(k)}`)
            await assert.rejects(calcDown(mkBars(60, 2), k, { intervalSec: 'abc', volLen: 5 }), (e) => e.message === msgKey, `key ${labelOf(k)} 先於 intervalSec`)
            await assert.rejects(calcDown(null, k), (e) => e.message === msgKey, `key ${labelOf(k)} 無資料`)
        }
        await assert.rejects(calcDown([null, ...mkBars(60, 2)], 'Close'), (e) => e.message === msgArr)
        for (let a of [null, undefined, {}, []]) {
            let rrs = await calcDown(a, 'Close')
            assert.deepStrictEqual(rrs.map((r) => [r.period, r.len, r.vs.length]), Object.entries(KP).map(([p, l]) => [p, l, 0]))
        }
        await assert.rejects(calcDown('abc', 'Close'), (e) => e.message === msgArr)
    })

    it('D3 暖機根數(README 載明): 內建表之 30day 期(len 180)需 210 根、12hr 期(len 3)需 33 根方有第一筆', async function() {
        let a = mkBars(260, 31)
        for (let [period, need] of [['30day', 210], ['12hr', 33]]) {
            assert.deepStrictEqual(pickPeriod(await calcDown(a.slice(0, need - 1), 'Close'), period).vs, [], `${period} n = ${need - 1}`)
            assert.strictEqual(pickPeriod(await calcDown(a.slice(0, need), 'Close'), period).vs.length, 1, `${period} n = ${need}`)
        }
    })

    it('D4 key 決定所讀欄位(讀 Open 之結果同對 Open 序列之暴力計算, 且異於讀 Close); 純函式: 重複呼叫結果一致且不改動輸入; 輸出皆為有限數值(隨機、震盪、單調上升、單調下降、定值)', async function() {
        let snap = JSON.stringify(arr)
        let rc = await calcDown(arr, 'Close')
        let ro = await calcDown(arr, 'Open')
        assert.notDeepStrictEqual(ro, rc)
        assertSameAsRef(pickPeriod(ro, '2day').vs, arr, refDown(arr, 'Open', 12), 'Open 2day')
        assert.deepStrictEqual(await calcDown(arr, 'Close'), rc)
        assert.strictEqual(JSON.stringify(arr), snap)
        let sets = { 隨機: mkBars(500, 17), 震盪: genOhlc(500), 上升: genUp(500), 下降: genDown(500), 定值: genFlat(500) }
        for (let [nm, a] of Object.entries(sets)) {
            let rrs = await calcDown(a, 'Close')
            assertFiniteRrs(rrs, COLS, nm)
            assert.ok(rrs.every((r) => r.vs.length > 0), `${nm} 各期須有輸出`)
        }
    })

})
