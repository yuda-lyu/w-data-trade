import assert from 'assert'
import calcVolx from '../src/calcVolx.mjs'
import wdt from '../src/WDataTrade.mjs'
import { genOhlc, genFlat, genUp, genDown, genTimes, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear } from './unit-setup.mjs'
import { KP, mkRand, mkBars, sum, mean, popStd, win, distinct, intBads, numBads, assertOptK3, assertFiniteRrs, assertCausal, assertIntervalSec } from './unit-setupFeat.mjs'


//規格來源: src/calcVolx.mjs 之 JSDoc(波動之延伸)
//  V1 記號: lo、lh、ll、lc 為開、高、低、收之對數, r(i) = lc(i) − lc(i−1)(i ≥ 1), W(i, m) = 第 i−m+1 ~ i 根; 只用當根(含)以前之資料; 讀 Open、High、Low、Close(key 不使用)
//     pk = (lh − ll)² / (4 ln2); gk = 0.5 (lh − ll)² − (2 ln2 − 1)(lc − lo)²; rs = (lh − lc)(lh − lo) + (ll − lc)(ll − lo); tr = max(lh, lc(i−1)) − min(ll, lc(i−1)); lnv(x) = 0.5 ln(max(x, eps))
//  V2 輸出欄(第 i 根; 期別根數 len):
//       rv = lnv(r² 於 W(i, len) 之平均); park = lnv(pk 之平均); gk = lnv(gk 之平均); rs = lnv(rs 之平均)(平均不大於 0 者亦取 eps)
//       rvRatio = rv − lnv(r² 於 W(i, len × longMult) 之平均)
//       chop = log10(tr 於 W 之和 / (W 內 lh 之最大 − ll 之最小)) / log10(len), 高低差 ≤ 0 ⇒ 0
//       downShare = W 內 r < 0 者之 r² 之和 / 全部 r² 之和, 分母 0 ⇒ 0.5
//       jumpShare = 1 − (π/2)(|r(j)||r(j−1)| 於 j ∈ W 之平均) / (r² 於 W 之平均), 分母 0 ⇒ 0
//       varRatio = ((lc(j) − lc(j−vrLag))² 於 j ∈ W 之平均) / (vrLag × r² 於 W 之平均), 分母 0 ⇒ 1
//       volOfVol = u(j) 於 j ∈ W 之母體標準差, u(j) = lnv(r² 於 W(j, vovLen) 之平均)
//  V3 s0 = 各欄所需最早一根之最大者 = max(len × longMult, len + 1, len + vrLag − 1, len + vovLen − 1)(逐欄: rv、chop、downShare i ≥ len; park、gk、rs i ≥ len − 1; jumpShare i ≥ len + 1; rvRatio i ≥ len × longMult; varRatio i ≥ len + vrLag − 1; volOfVol i ≥ len + vovLen − 1); n < s0 + 1 ⇒ vs 為 []
//     len + 1(jumpShare)於 longMult ≥ 2、len ≥ 2 時恆不大於 len × longMult, 不會單獨成為最大者
//  V4 選項 opt.longMult、opt.vrLag、opt.vovLen(皆至少為 2 之整數; 預設 4、6、6)、opt.eps(有限且大於 0 之數值; 預設 1e-12)皆為跨套件規格 K3(非預期之輸入視為未給而改用預設, opt.debug 為 true 時警告)、opt.intervalSec、opt.kp; len 須為至少 2 之整數(chop 除以 log10(len)); 輸出皆為有限數值
//  V5 輸入檢核: Open、High、Low、Close 須為正之有限數, 且高低涵蓋開收(Low ≤ Open、Close ≤ High): 自相矛盾之 K 線整批 reject(合法 K 線之 gk、rs 逐根量皆不小於 0)


let msgArr = 'invalid arr: must have a positive finite Open, High, Low and Close in every element'
let msgOhlc = 'invalid arr: must have Low <= Open, Close <= High in every element'
let msgKp = 'invalid opt.kp: must be an object of integers >= 2'
let msgIv = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let COLS = ['rv', 'park', 'gk', 'rs', 'rvRatio', 'chop', 'downShare', 'jumpShare', 'varRatio', 'volOfVol']
let DEF = { longMult: 4, vrLag: 6, vovLen: 6, eps: 1e-12 }
let LN2 = Math.log(2)

//s0Of, 各期第一筆對應之輸入索引
let s0Of = (len, o = DEF) => Math.max(len * o.longMult, len + 1, len + o.vrLag - 1, len + o.vovLen - 1)

//refVolx, 暴力計算: 依 V1 ~ V3 逐根以陣列切片與定義式計算(不 import src 之內部邏輯)
let refVolx = (arr, len, o = DEF) => {
    let lg = (k) => arr.map((v) => Math.log(v[k]))
    let lo = lg('Open')
    let lh = lg('High')
    let ll = lg('Low')
    let lc = lg('Close')
    let r = lc.map((v, i) => (i === 0 ? NaN : v - lc[i - 1]))
    let pk = lh.map((h, i) => Math.pow(h - ll[i], 2) / (4 * LN2))
    let gk = lh.map((h, i) => 0.5 * Math.pow(h - ll[i], 2) - (2 * LN2 - 1) * Math.pow(lc[i] - lo[i], 2))
    let rs = lh.map((h, i) => (h - lc[i]) * (h - lo[i]) + (ll[i] - lc[i]) * (ll[i] - lo[i]))
    let tr = lh.map((h, i) => (i === 0 ? NaN : Math.max(h, lc[i - 1]) - Math.min(ll[i], lc[i - 1])))
    let lnv = (x) => 0.5 * Math.log(Math.max(x, o.eps))
    //at, 取值並確認索引有效(暴力計算自身不得讀到不存在之值)
    let at = (x, idx) => {
        assert.ok(idx >= 0 && idx < x.length, `索引 ${idx} 無效`)
        assert.ok(!Number.isNaN(x[idx]), `索引 ${idx} 無值`)
        return x[idx]
    }
    let idxs = (i, m) => Array.from({ length: m }, (_, k) => i - m + 1 + k)
    let sq = (i, m) => idxs(i, m).map((j) => Math.pow(at(r, j), 2))
    let mr2 = (i, m) => mean(sq(i, m))
    let out = []
    for (let i = s0Of(len, o); i < lc.length; i++) {
        let js = idxs(i, len)
        let den = sum(sq(i, len))
        let num = sum(js.filter((j) => at(r, j) < 0).map((j) => Math.pow(r[j], 2)))
        let mbp = mean(js.map((j) => Math.abs(at(r, j)) * Math.abs(at(r, j - 1))))
        let mdd = mean(js.map((j) => Math.pow(at(lc, j) - at(lc, j - o.vrLag), 2)))
        let range = Math.max(...win(lh, i, len)) - Math.min(...win(ll, i, len))
        let rv = lnv(mr2(i, len))
        out.push({
            i,
            rv,
            park: lnv(mean(win(pk, i, len))),
            gk: lnv(mean(win(gk, i, len))),
            rs: lnv(mean(win(rs, i, len))),
            rvRatio: rv - lnv(mr2(i, len * o.longMult)),
            chop: range > 0 ? Math.log10(sum(js.map((j) => at(tr, j))) / range) / Math.log10(len) : 0,
            downShare: den > 0 ? num / den : 0.5,
            jumpShare: den > 0 ? 1 - (Math.PI / 2) * mbp / (den / len) : 0,
            varRatio: den > 0 ? mdd / (o.vrLag * (den / len)) : 1,
            volOfVol: popStd(js.map((j) => lnv(mr2(j, o.vovLen)))),
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

//mkFlatBar / barsOf, 由 [O, H, L, C] 造 K 線(量為固定值, 本 calc 不讀)
let barsOf = (rows) => {
    let ts = genTimes(rows.length)
    return rows.map((x, i) => ({ time: ts[i], Open: x[0], High: x[1], Low: x[2], Close: x[3], Volumn: 1000, TakerBuyBaseAssetVolume: 500 }))
}


describe('calcVolx', function() {

    let arr = mkBars(900, 3)

    it('V2 回傳結構: 內建週期表之 period 與 len(同 calcCvd)、各筆之欄為 time 與 10 個輸出欄', async function() {
        let rrs = await calcVolx(arr, 'Close')
        assertRrsShape(rrs, KP)
        assertFiniteRrs(rrs, COLS, '內建表')
        assert.deepStrictEqual(rrs.map((r) => Object.keys(r)), rrs.map(() => ['period', 'len', 'vs']))
        assert.strictEqual(wdt.calcVolx, calcVolx)
    })

    it('V3 各期自 s0 起算並逐根對齊; n = s0 ⇒ []、n = s0 + 1 ⇒ 恰 1 筆(內建表之 s0 = len × 4; 另以選項讓 vrLag、vovLen、longMult 各為最大項)', async function() {
        let rrs = await calcVolx(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let s0 = s0Of(len)
            assert.strictEqual(s0, len * 4, '內建表以 len × longMult 為最大')
            assertTimeAlign(pickPeriod(rrs, period).vs, arr, s0)
            let r0 = pickPeriod(await calcVolx(arr.slice(0, s0), 'Close'), period)
            assert.deepStrictEqual(r0.vs, [], `${period} n = s0`)
            let r1 = pickPeriod(await calcVolx(arr.slice(0, s0 + 1), 'Close'), period)
            assert.strictEqual(r1.vs.length, 1, `${period} n = s0 + 1`)
            assert.strictEqual(r1.vs[0].time, arr[s0].time, `${period} n = s0 + 1 之 time`)
        }
        //[選項, len, 手算之 s0]: 逐項為最大者各一例
        let cases = [
            [{ longMult: 4, vrLag: 20 }, 3, 22], //len + vrLag − 1 = 22 > 12
            [{ longMult: 4, vovLen: 25 }, 3, 27], //len + vovLen − 1 = 27 > 12
            [{ longMult: 2, vrLag: 6, vovLen: 6 }, 10, 20], //len × longMult = 20 > 15
            [{ longMult: 2, vrLag: 15, vovLen: 6 }, 10, 24], //len + vrLag − 1 = 24
            [{ longMult: 2, vrLag: 6, vovLen: 20 }, 10, 29], //len + vovLen − 1 = 29
            [{ longMult: 7 }, 2, 14], //len × longMult = 14
        ]
        for (let [o, len, expS0] of cases) {
            assert.strictEqual(s0Of(len, { ...DEF, ...o }), expS0, '手算 s0')
            let opt = { ...o, kp: { x: len } }
            assert.deepStrictEqual((await calcVolx(arr.slice(0, expS0), 'Close', opt))[0].vs, [], `${JSON.stringify(o)} len ${len} n = s0`)
            let r1 = (await calcVolx(arr.slice(0, expS0 + 1), 'Close', opt))[0]
            assert.deepStrictEqual(r1.vs.map((v) => v.time), [arr[expS0].time], `${JSON.stringify(o)} len ${len} n = s0 + 1`)
        }
    })

    it('V2 與暴力計算逐根逐欄相同(全部 9 期、預設選項; 另一組非預設選項 longMult = 2、vrLag = 3、vovLen = 4、eps = 1e-6 之三期)', async function() {
        let rrs = await calcVolx(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let ref = refVolx(arr, len)
            assert.ok(ref.length > 0, `${period} 須有輸出`)
            assertSameAsRef(pickPeriod(rrs, period).vs, arr, ref, period)
        }
        let o = { longMult: 2, vrLag: 3, vovLen: 4, eps: 1e-6 }
        let r2 = await calcVolx(arr, 'Close', { ...o, kp: { a: 2, b: 7, c: 30 } })
        assert.deepStrictEqual(r2.map((r) => [r.period, r.len]), [['a', 2], ['b', 7], ['c', 30]])
        r2.forEach((r) => {
            assertSameAsRef(r.vs, arr, refVolx(arr, r.len, o), `非預設選項 ${r.period}`)
        })
    })

    it('V2 手算例(以報酬為主之欄): r(1..6) = 0.1、−0.2、0.3、−0.1、0.2、0.1, len = 2、longMult = 2、vrLag = 2、vovLen = 2 ⇒ s0 = 4, 第 4、5 根逐欄手算', async function() {
        let lc = [0, 0.1, -0.1, 0.2, 0.1, 0.3, 0.4]
        let cs = lc.map((x) => Math.exp(x))
        let a = barsOf(cs.map((c) => [c, c, c, c]))
        let r = (await calcVolx(a, 'Close', { kp: { x: 2 }, longMult: 2, vrLag: 2, vovLen: 2 }))[0]
        assert.deepStrictEqual(r.vs.map((v) => v.time), [a[4].time, a[5].time, a[6].time])
        let lnv = (x) => 0.5 * Math.log(Math.max(x, 1e-12))
        let h = Math.PI / 2
        //根 4: W = {3, 4}, r = {0.3, −0.1}; r² 平均 = (0.09 + 0.01)/2 = 0.05; 長視窗 W(4, 4) = r(1..4): r² 平均 = (0.01 + 0.04 + 0.09 + 0.01)/4 = 0.0375
        //  downShare = 0.01 / 0.10; jumpShare: |r3||r2| = 0.3 × 0.2 = 0.06、|r4||r3| = 0.1 × 0.3 = 0.03, 平均 0.045 ⇒ 1 − (π/2)(0.045/0.05)
        //  varRatio: (lc3 − lc1)² = (r2 + r3)² = 0.01、(lc4 − lc2)² = (r3 + r4)² = 0.04, 平均 0.025 ⇒ 0.025 / (2 × 0.05) = 0.25
        //  volOfVol: u3 = lnv((0.04 + 0.09)/2)、u4 = lnv(0.05), 母體標準差 = |u3 − u4| / 2
        let e4 = {
            rv: lnv(0.05),
            rvRatio: lnv(0.05) - lnv(0.0375),
            downShare: 0.1,
            jumpShare: 1 - h * (0.045 / 0.05),
            varRatio: 0.25,
            volOfVol: Math.abs(lnv(0.065) - lnv(0.05)) / 2,
        }
        //根 5: W = {4, 5}, r = {−0.1, 0.2}; r² 平均 = 0.025; 長視窗 r(2..5): (0.04 + 0.09 + 0.01 + 0.04)/4 = 0.045
        //  downShare = 0.01 / 0.05; jumpShare: |r4||r3| = 0.03、|r5||r4| = 0.02, 平均 0.025 ⇒ 1 − π/2
        //  varRatio: (r3 + r4)² = 0.04、(r4 + r5)² = 0.01, 平均 0.025 ⇒ 0.025 / (2 × 0.025) = 0.5
        //  volOfVol: u4 = lnv(0.05)、u5 = lnv((0.01 + 0.04)/2 = 0.025)
        let e5 = {
            rv: lnv(0.025),
            rvRatio: lnv(0.025) - lnv(0.045),
            downShare: 0.2,
            jumpShare: 1 - h,
            varRatio: 0.5,
            volOfVol: Math.abs(lnv(0.05) - lnv(0.025)) / 2,
        }
        for (let [k, e] of [e4, e5].entries()) {
            Object.keys(e).forEach((c) => {
                assertNear(r.vs[k][c], e[c], 1e-12, `第 ${k} 筆 ${c}`)
            })
        }
    })

    it('V2 手算例(以高低開收為主之欄): 高低比固定且開 = 收 ⇒ park = ln d − ½ ln(4 ln2)、gk = rs = ln d − ½ ln2(d 為 lh − ll)', async function() {
        let d = 0.04
        let rnd = mkRand(5)
        let p = 100
        let rows = []
        for (let i = 0; i < 300; i++) {
            p = p * Math.exp((rnd() - 0.5) * 0.03)
            rows.push([p, p * Math.exp(d / 2), p * Math.exp(-d / 2), p])
        }
        let a = barsOf(rows)
        let rrs = await calcVolx(a, 'Close', { kp: { a: 3, b: 10, c: 24 } })
        rrs.forEach((r) => {
            assert.ok(r.vs.length > 100, r.period)
            r.vs.forEach((v, k) => {
                assertNear(v.park, Math.log(d) - 0.5 * Math.log(4 * LN2), 1e-9, `${r.period} 第 ${k} 筆 park`)
                assertNear(v.gk, Math.log(d) - 0.5 * LN2, 1e-9, `${r.period} 第 ${k} 筆 gk`)
                assertNear(v.rs, Math.log(d) - 0.5 * LN2, 1e-9, `${r.period} 第 ${k} 筆 rs`)
            })
        })
    })

    it('V2 手算例(chop): 逐根相接之階梯(每根低 = 前一根收 = 前一根高、tr 之和 = 高低差)⇒ 0; 各根高低全同、收在其內(tr 之和 = len × 高低差)⇒ 1', async function() {
        let aStep = 0.01
        //階梯: 第 j 根之對數為 開 = 低 = j × a、高 = 收 = (j + 1) × a
        let step = barsOf(Array.from({ length: 300 }, (_, j) => [Math.exp(j * aStep), Math.exp((j + 1) * aStep), Math.exp(j * aStep), Math.exp((j + 1) * aStep)]))
        let rnd = mkRand(9)
        //盤整: 低 = 1、高 = e^a, 開與收為其內之相異值
        let chp = barsOf(Array.from({ length: 300 }, () => [Math.exp(rnd() * aStep), Math.exp(aStep), 1, Math.exp(rnd() * aStep)]))
        let opt = { kp: { a: 3, b: 10, c: 24 } }
        let r0 = await calcVolx(step, 'Close', opt)
        let r1 = await calcVolx(chp, 'Close', opt)
        r0.forEach((r) => {
            assert.ok(r.vs.length > 100, r.period)
            r.vs.forEach((v, k) => {
                assertNear(v.chop, 0, 1e-9, `階梯 ${r.period} 第 ${k} 筆`)
            })
        })
        r1.forEach((r) => {
            assert.ok(r.vs.length > 100, r.period)
            r.vs.forEach((v, k) => {
                assertNear(v.chop, 1, 1e-9, `盤整 ${r.period} 第 ${k} 筆`)
            })
        })
        assert.ok(new Set(r1[0].vs.map((v) => v.rv)).size > 100, '盤整資料之報酬逐根相異(非常數)')
    })

    it('V2 退化: 全程定值 ⇒ rv、park、gk、rs 為 ½ln(eps)、rvRatio、chop、jumpShare、volOfVol 為 0、downShare 為 0.5、varRatio 為 1', async function() {
        let lnEps = 0.5 * Math.log(1e-12)
        let rrs = await calcVolx(genFlat(800), 'Close')
        let nOut = 0
        rrs.forEach((r) => {
            r.vs.forEach((v) => {
                assert.deepStrictEqual({ ...v, time: 0 }, { time: 0, rv: lnEps, park: lnEps, gk: lnEps, rs: lnEps, rvRatio: 0, chop: 0, downShare: 0.5, jumpShare: 0, varRatio: 1, volOfVol: 0 }, r.period)
                nOut++
            })
        })
        assert.ok(nOut > 1000, `輸出筆數 ${nOut}`)
        //opt.eps 生效
        let r2 = await calcVolx(genFlat(100), 'Close', { eps: 1e-6, kp: { x: 3 } })
        r2[0].vs.forEach((v) => {
            assert.strictEqual(v.rv, 0.5 * Math.log(1e-6))
            assert.strictEqual(v.park, 0.5 * Math.log(1e-6))
        })
    })

    it('V2 退化: 前 100 根隨機漫步、其後為定值之根 ⇒ 視窗全落在定值段時 downShare 為 0.5、jumpShare 為 0、chop 為 0、varRatio 為 1(分子仍非 0)、波動類為 ½ln(eps)、volOfVol 為 0', async function() {
        let head = mkBars(100, 41)
        let c = head[99].Close
        let tail = barsOf(Array.from({ length: 100 }, () => [c, c, c, c]))
        let ts = genTimes(200)
        let a = head.concat(tail.map((v, i) => ({ ...v, time: ts[100 + i] })))
        assert.strictEqual(a.length, 200)
        let len = 3
        let o = { ...DEF }
        let r = (await calcVolx(a, 'Close', { kp: { x: len } }))[0]
        let ref = refVolx(a, len)
        assertSameAsRef(r.vs, a, ref, '退化資料')
        let lnEps = 0.5 * Math.log(1e-12)
        let lc = a.map((v) => Math.log(v.Close))
        let nVr = 0
        let nVov = 0
        let nRatio = 0
        r.vs.forEach((v, k) => {
            let i = s0Of(len, o) + k
            //r(100 ~) = 0 ⇒ W(i, 3) 之報酬全為 0 ⇔ i − 2 ≥ 100
            if (i >= 102) {
                assert.strictEqual(v.downShare, 0.5, `根 ${i} downShare`)
                assert.strictEqual(v.jumpShare, 0, `根 ${i} jumpShare`)
                assert.strictEqual(v.chop, 0, `根 ${i} chop`)
                assert.strictEqual(v.varRatio, 1, `根 ${i} varRatio`)
                assert.strictEqual(v.rv, lnEps, `根 ${i} rv`)
                assert.strictEqual(v.park, lnEps, `根 ${i} park`)
                assert.strictEqual(v.gk, lnEps, `根 ${i} gk`)
                assert.strictEqual(v.rs, lnEps, `根 ${i} rs`)
                //鑑別: varRatio 之分子(視窗內 (lc(j) − lc(j−6))² 之和)於 i ≤ 106 非 0, 故 1 為分母 0 之退化值
                if (i <= 106) {
                    let num = sum([i - 2, i - 1, i].map((j) => Math.pow(lc[j] - lc[j - 6], 2)))
                    assert.ok(num > 0, `根 ${i} varRatio 之分子`)
                    nVr++
                }
            }
            //u(j) = ½ln(eps) ⇔ r(j−5 ~ j) 全為 0 ⇔ j ≥ 105; 故 W(i, 3) 之 u 全相同 ⇔ i ≥ 107
            if (i >= 107) {
                assert.strictEqual(v.volOfVol, 0, `根 ${i} volOfVol`)
                nVov++
            }
            //長視窗 W(i, 12) 全落在定值段 ⇔ i − 11 ≥ 100
            if (i >= 111) {
                assert.strictEqual(v.rvRatio, 0, `根 ${i} rvRatio`)
                nRatio++
            }
            else if (i >= 102) {
                assert.ok(v.rvRatio < 0, `根 ${i} rvRatio(長視窗仍含波動)為負`)
            }
        })
        assert.strictEqual(nVr, 5, '根 102 ~ 106')
        assert.strictEqual(nVov, 93, '根 107 ~ 199')
        assert.strictEqual(nRatio, 89, '根 111 ~ 199')
    })

    it('V2 退化: 平盤 K 線(開 = 高 = 低 = 收)之 pk、gk、rs 皆為 0 ⇒ 平均不大於 0 者取 eps; 視窗內高低差為 0 而 tr 之和大於 0(視窗首根與其前一根之收盤有跳空)⇒ chop 為 0(不為 Infinity 或 NaN); opt.eps 生效', async function() {
        //每 5 根一段, 段內為同一價位之平盤 K 線, 各段價位互異(段間跳空)
        let a = barsOf(Array.from({ length: 120 }, (_, i) => {
            let seg = Math.floor(i / 5)
            let p = 100 + 3 * seg + (seg % 2) * 7.7
            return [p, p, p, p]
        }))
        let lcs = a.map((v) => Math.log(v.Close))
        for (let eps of [undefined, 1e-6, 1e-8]) {
            let opt = eps === undefined ? { kp: { x: 3 } } : { eps, kp: { x: 3 } }
            let e = eps === undefined ? 1e-12 : eps
            let r = (await calcVolx(a, 'Close', opt))[0]
            assert.ok(r.vs.length > 100)
            let nGap = 0
            r.vs.forEach((v, k) => {
                let i = s0Of(3) + k
                assert.strictEqual(v.park, 0.5 * Math.log(e), `eps ${eps} 第 ${k} 筆 park`)
                assert.strictEqual(v.gk, 0.5 * Math.log(e), `eps ${eps} 第 ${k} 筆 gk`)
                assert.strictEqual(v.rs, 0.5 * Math.log(e), `eps ${eps} 第 ${k} 筆 rs`)
                assert.strictEqual(v.chop, 0, `eps ${eps} 第 ${k} 筆 chop`)
                //視窗 W(i, 3) 之高低差與 tr 之和(由資料直接算)
                let lo = Math.min(lcs[i], lcs[i - 1], lcs[i - 2])
                let hi = Math.max(lcs[i], lcs[i - 1], lcs[i - 2])
                let sTr = 0
                for (let j = i - 2; j <= i; j++) {
                    sTr += Math.max(lcs[j], lcs[j - 1]) - Math.min(lcs[j], lcs[j - 1])
                }
                if (hi - lo === 0 && sTr > 0) {
                    nGap++ //鑑別: 高低差為 0 而 tr 之和大於 0, chop 之 0 為「高低差不大於 0」之退化值而非 tr 為 0 所致
                }
                //視窗內有跳空(r² 之和大於 0)⇒ rv 非退化; 否則為 eps 下限
                let sR2 = 0
                for (let j = i - 2; j <= i; j++) {
                    sR2 += Math.pow(lcs[j] - lcs[j - 1], 2)
                }
                if (sR2 > 0) {
                    assert.ok(v.rv > 0.5 * Math.log(e) + 1, `eps ${eps} 第 ${k} 筆 rv 非退化(視窗內有跳空)`)
                }
                else {
                    assert.strictEqual(v.rv, 0.5 * Math.log(e), `eps ${eps} 第 ${k} 筆 rv 為 eps 下限`)
                }
            })
            assert.ok(nGap >= 10, `eps ${eps}: 高低差為 0 而 tr 之和大於 0 之視窗 ${nGap} 個(鑑別)`)
            assertSameAsRef(r.vs, a, refVolx(a, 3, { ...DEF, eps: e }), `eps ${eps}`)
        }
    })

    it('V2 各欄之性質與鑑別: downShare 於 [0, 1]、jumpShare ≤ 1、varRatio ≥ 0、volOfVol ≥ 0、chop ≥ 0(高低涵蓋開收之合法 K 線); 各欄取值多樣; rvRatio 有正有負、downShare 兩端皆有', async function() {
        let rrs = await calcVolx(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, k) => {
                assert.ok(v.downShare >= 0 && v.downShare <= 1, `${r.period} 第 ${k} 筆 downShare ${v.downShare}`)
                assert.ok(v.jumpShare <= 1, `${r.period} 第 ${k} 筆 jumpShare ${v.jumpShare}`)
                assert.ok(v.varRatio >= 0, `${r.period} 第 ${k} 筆 varRatio ${v.varRatio}`)
                assert.ok(v.volOfVol >= 0, `${r.period} 第 ${k} 筆 volOfVol ${v.volOfVol}`)
                assert.ok(v.chop >= -1e-9, `${r.period} 第 ${k} 筆 chop ${v.chop}`)
            })
            COLS.forEach((c) => {
                assert.ok(distinct(r.vs, c) > r.vs.length * 0.5, `${r.period} ${c} 取值個數 ${distinct(r.vs, c)} / ${r.vs.length}`)
            })
        })
        let r1 = pickPeriod(rrs, '1day').vs
        assert.ok(r1.some((v) => v.rvRatio > 0) && r1.some((v) => v.rvRatio < 0), 'rvRatio 正負皆有')
        assert.ok(r1.some((v) => v.downShare < 0.3) && r1.some((v) => v.downShare > 0.7), 'downShare 兩端皆有')
    })

    it('V2 jumpShare 不截斷(值域 (−∞, 1]): 視窗首根之前一根為大幅報酬而視窗內報酬皆小時, 雙冪次變差遠大於已實現變異, jumpShare 為甚大之負值(估計式本身之性質, 手算 ≈ −14.7), 不被截為 0', async function() {
        //r(1..11) = 0.01、−0.011、0.012、−0.009、1.0、0.1、0.001、0.001、0.002、−0.001、0.001; len = 3, i = 8 之視窗 r(6..8) = 0.1、0.001、0.001, 其前一根 r(5) = 1.0
        let rr = [0, 0.01, -0.011, 0.012, -0.009, 1.0, 0.1, 0.001, 0.001, 0.002, -0.001, 0.001]
        let lcs = []
        let s = Math.log(100)
        rr.forEach((x) => {
            s += x
            lcs.push(s)
        })
        let a = ohlcFromCloses(lcs.map((v) => Math.exp(v)), { wick: 0 })
        let r = (await calcVolx(a, 'Close', { longMult: 2, vrLag: 2, vovLen: 2, kp: { x: 3 } }))[0]
        assert.strictEqual(r.vs[0].time, a[s0Of(3, { ...DEF, longMult: 2, vrLag: 2, vovLen: 2 })].time)
        let k8 = r.vs.findIndex((v) => v.time === a[8].time)
        let mr2 = (0.1 * 0.1 + 0.001 * 0.001 + 0.001 * 0.001) / 3
        let mbp = (0.1 * 1.0 + 0.001 * 0.1 + 0.001 * 0.001) / 3
        let exp = 1 - (Math.PI / 2) * mbp / mr2
        assert.ok(exp < -14 && exp > -15, `手算值 ${exp}`)
        assertNear(r.vs[k8].jumpShare, exp, 1e-6, '根 8 jumpShare')
        //其餘各根同暴力計算(含負值者)
        assertSameAsRef(r.vs, a, refVolx(a, 3, { ...DEF, longMult: 2, vrLag: 2, vovLen: 2 }), 'jumpShare 例')
        assert.ok(r.vs.some((v) => v.jumpShare < -5), '有甚大之負值')
    })

    it('V1 只用當根以前之資料: 第 t 根之後依根而異地改動, 其前之輸出逐值不變而其後有變; 以第 t 根截斷之輸出同完整序列之前段', async function() {
        await assertCausal((a) => calcVolx(a, 'Close'), arr, 740, [730, 800, 880], '預設')
        let a2 = mkBars(200, 29)
        await assertCausal((a) => calcVolx(a, 'Close', { longMult: 2, vrLag: 3, vovLen: 4, kp: { x: 4, y: 12 } }), a2, 100, [60, 130], '小參數')
    })

    it('V4 opt.longMult、opt.vrLag、opt.vovLen: 預設(給預設值、數字字串、null、undefined 皆同未給); 給了而有效者確實生效且同暴力計算', async function() {
        let a = mkBars(300, 13)
        let opt0 = { kp: { x: 3, y: 12 } }
        let base = await calcVolx(a, 'Close', opt0)
        for (let [nm, def, alt] of [['longMult', 4, 2], ['vrLag', 6, 3], ['vovLen', 6, 12]]) {
            for (let v of [def, String(def), ` ${def} `, null, undefined]) {
                assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, [nm]: v }), base, `${nm} ${String(v)}`)
            }
            let ra = await calcVolx(a, 'Close', { ...opt0, [nm]: alt })
            assert.notDeepStrictEqual(ra, base, `${nm} = ${alt} 須與預設不同`)
            assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, [nm]: String(alt) }), ra, `${nm} 數字字串`)
            ra.forEach((r) => {
                assertSameAsRef(r.vs, a, refVolx(a, r.len, { ...DEF, [nm]: alt }), `${nm} = ${alt} ${r.period}`)
            })
        }
        //極大值 ⇒ 資料不足, 各期 vs 為空(不致耗時或出錯)
        for (let nm of ['longMult', 'vrLag', 'vovLen']) {
            let big = await calcVolx(a, 'Close', { [nm]: 1000000 })
            big.forEach((r) => {
                assert.deepStrictEqual(r.vs, [], `${nm} 極大 ${r.period}`)
            })
        }
    })

    it('V4 opt.longMult、opt.vrLag、opt.vovLen、opt.eps 非預期之輸入視為未給(K3): 結果同未給、不 reject; 合格寫法(數值、數字字串)轉為數值使用; opt.debug 為 true 時警告(固定詞彙、不含傳入之值、同鍵每行程一次)', async function() {
        let a = mkBars(300, 13)
        let opt0 = { kp: { x: 3, y: 12 } }
        let base = await calcVolx(a, 'Close', opt0)
        let call = (o) => calcVolx(a, 'Close', o)
        for (let [nm, def, alt] of [['longMult', 4, 2], ['vrLag', 6, 3], ['vovLen', 6, 12]]) {
            let ra = await calcVolx(a, 'Close', { ...opt0, [nm]: alt })
            assert.notDeepStrictEqual(ra, base, `${nm} = ${alt} 須與預設不同`)
            //合格之數字字串(含空白、正號、小數點後全零、科學記號)與數值同值(K4)
            for (let v of [`${alt}`, ` ${alt} `, `+${alt}`, `${alt}.0`, `${alt}e0`]) {
                assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, [nm]: v }), ra, `${nm} ${v}`)
            }
            await assertOptK3({
                call,
                base,
                name: nm,
                invalids: intBads(2),
                sames: [def, `${def}`, ` ${def} `, `${def}e0`],
                tag: 'w-data-trade calcVolx',
                desc: 'an integer >= 2',
                defDesc: `${def}`,
                extra: opt0,
            })
        }
        //eps: 合格之數字字串與數值同值(K4); 非預期之輸入視為未給
        let rEps = await calcVolx(a, 'Close', { ...opt0, eps: 1e-3 })
        assert.notDeepStrictEqual(rEps, base, 'eps = 1e-3 須與預設不同')
        for (let v of ['1e-3', ' 0.001 ', '+1e-3', '1E-3']) {
            assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, eps: v }), rEps, `eps ${v}`)
        }
        await assertOptK3({
            call,
            base,
            name: 'eps',
            invalids: numBads(),
            sames: [1e-12, '1e-12', ' 1e-12 ', '0.000000000001'],
            tag: 'w-data-trade calcVolx',
            desc: 'a positive number',
            defDesc: '1e-12',
            extra: opt0,
        })
        //多鍵同時非預期: 各自改用預設; 一鍵非預期、另一鍵合格: 只前者改用預設
        assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, longMult: 'x', vrLag: 'y', vovLen: 'z', eps: 'w' }), base)
        assert.deepStrictEqual(await calcVolx(a, 'Close', { ...opt0, longMult: 'x', vrLag: 3 }), await calcVolx(a, 'Close', { ...opt0, vrLag: 3 }))
    })

    it('V4 opt.eps: 預設 1e-12; 給了而有效者生效', async function() {
        let a = mkBars(150, 13)
        assert.deepStrictEqual(await calcVolx(a, 'Close', { eps: 1e-12 }), await calcVolx(a, 'Close'))
        assert.deepStrictEqual(await calcVolx(a, 'Close', { eps: null }), await calcVolx(a, 'Close'))
        assert.deepStrictEqual(await calcVolx(a, 'Close', { eps: undefined }), await calcVolx(a, 'Close'))
        //eps = 1e-3 大於各視窗之 r² 平均(報酬約 0.006、至多約 0.04, 6 根平均之 r² 皆小於 1e-3)⇒ 逐根波動 u(j) 全被截於 eps ⇒ volOfVol 恰為 0、rvRatio 恰為 0; 與暴力計算相同
        let rE = await calcVolx(a, 'Close', { eps: 1e-3, kp: { x: 3, y: 12 } })
        rE.forEach((r) => {
            assertSameAsRef(r.vs, a, refVolx(a, r.len, { ...DEF, eps: 1e-3 }), `eps = 1e-3 ${r.period}`)
            r.vs.forEach((v, k) => {
                assert.strictEqual(v.volOfVol, 0, `eps = 1e-3 ${r.period} 第 ${k} 筆 volOfVol`)
            })
        })
    })

    it('V4 opt.kp: 原樣採用(標籤與值、數字字串轉數值); 非預期之輸入視為未給; 值小於 2 或為參數物件 ⇒ reject', async function() {
        let a = mkBars(200, 3)
        let rrs = await calcVolx(a, 'Close', { kp: { a: 4, b: '7', c: 2 }, intervalSec: 86400 })
        assert.deepStrictEqual(rrs.map((r) => [r.period, r.len]), [['a', 4], ['b', 7], ['c', 2]])
        rrs.forEach((r) => {
            assertSameAsRef(r.vs, a, refVolx(a, r.len), `kp ${r.period}`)
        })
        let base = await calcVolx(a, 'Close')
        for (let kp of [{}, { a: 0 }, { a: -4 }, { a: 1.5 }, { a: 'abc' }, { a: 5, b: 0 }, 'x', 4, [4], null]) {
            assert.deepStrictEqual(await calcVolx(a, 'Close', { kp }), base, `kp ${JSON.stringify(kp)}`)
        }
        for (let kp of [{ a: 1 }, { a: 5, b: 1 }, { a: '1' }, { a: { len: 5 } }, { a: 5, b: { mult: 2 } }]) {
            await assert.rejects(calcVolx(a, 'Close', { kp }), (e) => e.message === msgKp, `kp ${JSON.stringify(kp)}`)
        }
    })

    it('V4 opt.intervalSec = 86400: 期別標籤為 3day … 180day, 根數與各值同預設(含 3600、數字字串、14400); 無效 ⇒ reject(先於 opt.kp 與資料之檢核)', async function() {
        await assertIntervalSec((a, o) => calcVolx(a, 'Close', o), arr, 'calcVolx')
        for (let v of [0, -60, 59, 90, 1.5, 31536060, 'abc', '', NaN, Infinity, true, [], {}]) {
            await assert.rejects(calcVolx(arr, 'Close', { intervalSec: v }), (e) => e.message === msgIv, `intervalSec ${String(v)}`)
            await assert.rejects(calcVolx(arr, 'Close', { intervalSec: v, kp: { a: 5 } }), (e) => e.message === msgIv, `intervalSec ${String(v)} 與有效之 opt.kp`)
        }
        let bad = barsOf([[1, 2, 1, 1], [1, 2, 1, -1]])
        await assert.rejects(calcVolx(bad, 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('V4 輸入檢核: Open、High、Low、Close 須為正之有限數(任一根無效即整批 reject, 訊息不含輸入值); null、undefined、{} 視為無資料; 非陣列之字串 reject; key 不使用', async function() {
        for (let k of ['Open', 'High', 'Low', 'Close']) {
            for (let bad of [0, -5, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
                let a = mkBars(60, 2)
                a[10] = { ...a[10], [k]: bad }
                await assert.rejects(calcVolx(a, 'Close'), (e) => e.message === msgArr, `${k} ${String(bad)}`)
            }
            //最後一根無效亦拒
            let a1 = mkBars(60, 2)
            a1[59] = { ...a1[59], [k]: -1 }
            await assert.rejects(calcVolx(a1, 'Close'), (e) => e.message === msgArr, `${k} 最後一根`)
        }
        await assert.rejects(calcVolx([null, ...mkBars(60, 2)], 'Close'), (e) => e.message === msgArr)
        for (let a of [null, undefined, {}, []]) {
            let rrs = await calcVolx(a, 'Close')
            assert.deepStrictEqual(rrs.map((r) => [r.period, r.len, r.vs.length]), Object.entries(KP).map(([p, l]) => [p, l, 0]))
        }
        await assert.rejects(calcVolx('abc', 'Close'), (e) => e.message === msgArr)
        //key 不使用
        let base = await calcVolx(arr, 'Close')
        for (let k of ['Open', 'Nope', undefined, null, '']) {
            assert.deepStrictEqual(await calcVolx(arr, k), base, `key ${String(k)}`)
        }
    })

    it('V5 高低須涵蓋開收(Low ≤ Open、Close ≤ High): 違反者(High 小於 Low、Open 或 Close 落在高低之外, 各邊各一; 高於 High 或低於 Low 僅 1 ulp 亦然)整批 reject, 訊息不含輸入值, 任一根(首、中、末)皆然; 恰在邊界者(Open = Low、Close = High、Open = High、Close = Low、平盤)可', async function() {
        //[Open, High, Low, Close]
        let bads = [
            [100, 99, 98, 103], //High < Open、Close
            [100, 98, 105, 103], //High < Low
            [100, 105, 98, 106], //Close > High
            [100, 105, 98, 97], //Close < Low
            [106, 105, 98, 103], //Open > High
            [97, 105, 98, 103], //Open < Low
            [100, 105, 98, 105 * (1 + Number.EPSILON)], //Close 高於 High 僅 1 ulp
            [98 * (1 - Number.EPSILON / 2), 105, 98, 103], //Open 低於 Low 僅 1 ulp
        ]
        assert.ok(bads[6][3] > 105 && bads[7][0] < 98, '1 ulp 之構造')
        let goods = [
            [100, 105, 98, 103],
            [98, 105, 98, 105], //Open = Low、Close = High
            [105, 105, 98, 98], //Open = High、Close = Low
            [100, 100, 100, 100], //平盤
            [100, 105, 100, 105],
            [100, 100, 98, 98],
        ]
        for (let pos of [0, 10, 59]) {
            for (let [o, h, l, c] of bads) {
                let a = mkBars(60, 2)
                a[pos] = { ...a[pos], Open: o, High: h, Low: l, Close: c }
                await assert.rejects(calcVolx(a, 'Close'), (e) => e.message === msgOhlc, `位置 ${pos} [${o}, ${h}, ${l}, ${c}]`)
            }
            for (let [o, h, l, c] of goods) {
                let a = mkBars(60, 2)
                a[pos] = { ...a[pos], Open: o, High: h, Low: l, Close: c }
                assertFiniteRrs(await calcVolx(a, 'Close', { kp: { x: 3 }, longMult: 2, vrLag: 2, vovLen: 2 }), COLS, `位置 ${pos} [${o}, ${h}, ${l}, ${c}]`)
            }
        }
        //無效之數值(非正、非有限)仍以另一訊息拒絕(先於高低涵蓋開收之檢核)
        let a1 = mkBars(60, 2)
        a1[10] = { ...a1[10], High: NaN, Low: 200 }
        await assert.rejects(calcVolx(a1, 'Close'), (e) => e.message === msgArr)
        //無資料與 opt.intervalSec 之優先順序不變
        await assert.rejects(calcVolx(a1, 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('V3 暖機根數(README 載明): 內建表之 30day 期(len 180)需 721 根、12hr 期(len 3)需 13 根方有第一筆', async function() {
        let a = mkBars(760, 31)
        for (let [period, need] of [['30day', 721], ['12hr', 13]]) {
            assert.deepStrictEqual(pickPeriod(await calcVolx(a.slice(0, need - 1), 'Close'), period).vs, [], `${period} n = ${need - 1}`)
            assert.strictEqual(pickPeriod(await calcVolx(a.slice(0, need), 'Close'), period).vs.length, 1, `${period} n = ${need}`)
        }
    })

    it('V4 純函式: 重複呼叫結果一致且不改動輸入; 輸出皆為有限數值(隨機、震盪、單調上升、單調下降、定值)', async function() {
        let snap = JSON.stringify(arr)
        let r1 = await calcVolx(arr, 'Close')
        assert.deepStrictEqual(await calcVolx(arr, 'Close'), r1)
        assert.strictEqual(JSON.stringify(arr), snap)
        let sets = { 隨機: mkBars(900, 17), 震盪: genOhlc(900), 上升: genUp(900), 下降: genDown(900), 定值: genFlat(900) }
        for (let [nm, a] of Object.entries(sets)) {
            let rrs = await calcVolx(a, 'Close')
            assertFiniteRrs(rrs, COLS, nm)
            assert.ok(rrs.every((r) => r.vs.length > 0), `${nm} 各期須有輸出`)
        }
    })

})
