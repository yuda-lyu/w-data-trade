import assert from 'assert'
import calcMomz from '../src/calcMomz.mjs'
import wdt from '../src/WDataTrade.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear } from './unit-setup.mjs'
import { KP, mkBars, mkGeo, mkAlt, sum, popStd, win, distinct, labelOf, intBads, assertOptK3, assertFiniteRrs, assertCausal, assertIntervalSec } from './unit-setupFeat.mjs'


//規格來源: src/calcMomz.mjs 之 JSDoc(以波動標準化之動能、速度、加速度、已漲之幅、效率比)
//  M1 記號: lc = ln(key 欄位), r(i) = lc(i) − lc(i−1)(i ≥ 1), 視窗 W(i, m) = 第 i−m+1 ~ i 根, σ(i) = r 於 W(i, volLen) 之母體標準差(i ≥ volLen); 只用當根(含)以前之資料
//  M2 輸出欄(第 i 根; 期別根數 len):
//       momZ = (lc(i) − lc(i−len)) / (σ(i) √len)                    σ = 0 ⇒ 0
//       vel  = lc 於 W(i, len) 對 x = 0 … len−1 之最小平方斜率 / σ(i)   σ = 0 ⇒ 0
//       acc  = vel(i) − vel(i−len)
//       ext  = (lc(i) − W(i, len) 內 lc 之最小) / (σ(i) √len)         σ = 0 ⇒ 0
//       er   = |lc(i) − lc(i−len)| / Σ_{j ∈ W(i, len)} |r(j)|        分母 = 0 ⇒ 0
//  M3 s0 = len + max(len − 1, volLen)(acc 需第 i−len 根之 vel, 該根需 W(·, len) 與 σ); 第一筆對應輸入索引 s0, 逐根對齊至最後一根; 筆數 n < s0 + 1 ⇒ 該期 vs 為 []
//  M4 選項 opt.volLen(至少為 2 之整數, 預設 30; 跨套件規格 K3: 非預期之輸入視為未給而改用預設, opt.debug 為 true 時警告)、opt.intervalSec、opt.kp; 輸入檢核: key 須為非空字串、key 欄位須為正之有限數(訊息不含輸入值); 輸出皆為有限數值
//  M5 len 須為至少 2 之整數(vel 需至少 2 點): opt.kp 之值為 1 或為參數物件 ⇒ reject
//  M6 σ 之下限: σ 為 0 者(視窗內 r 全相同)及 σ 不大於 1e-12 者(完全等比之序列僅差浮點捨入)視為 0 ⇒ momZ、vel、ext 為 0


let msgArr = 'invalid arr: must have a positive finite value of key in every element'
let msgKey = 'invalid key: must be a non-empty string'
let msgKp = 'invalid opt.kp: must be an object of integers >= 2'
let msgIv = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let COLS = ['momZ', 'vel', 'acc', 'ext', 'er']

//s0Of, 各期第一筆對應之輸入索引
let s0Of = (len, volLen = 30) => len + Math.max(len - 1, volLen)

//refMomz, 暴力計算: 依 M1 ~ M3 逐根以陣列切片與定義式計算(不 import src 之內部邏輯; 斜率用正規方程式、母體標準差用平均平方差)
let refMomz = (cs, len, volLen) => {
    let lc = cs.map((c) => Math.log(c))
    let r = lc.map((v, i) => (i === 0 ? NaN : v - lc[i - 1]))
    //rw, r 於 W(i, m); r(0) 不存在, 起點須 ≥ 1
    let rw = (i, m) => {
        assert.ok(i - m + 1 >= 1, `r 之視窗起點 ${i - m + 1} 小於 1`)
        return win(r, i, m)
    }
    let sg = (i) => popStd(rw(i, volLen))
    let slope = (i) => {
        let y = win(lc, i, len)
        let y0 = y[0]
        let sx = 0
        let sy = 0
        let sxy = 0
        let sxx = 0
        y.forEach((v, x) => {
            let yy = v - y0
            sx += x
            sy += yy
            sxy += x * yy
            sxx += x * x
        })
        return (len * sxy - sx * sy) / (len * sxx - sx * sx)
    }
    let vel = (i) => {
        let s = sg(i)
        return s > 0 ? slope(i) / s : 0
    }
    let out = []
    for (let i = s0Of(len, volLen); i < lc.length; i++) {
        let s = sg(i)
        let path = sum(rw(i, len).map((v) => Math.abs(v)))
        out.push({
            i,
            momZ: s > 0 ? (lc[i] - lc[i - len]) / (s * Math.sqrt(len)) : 0,
            vel: vel(i),
            acc: vel(i) - vel(i - len),
            ext: s > 0 ? (lc[i] - Math.min(...win(lc, i, len))) / (s * Math.sqrt(len)) : 0,
            er: path > 0 ? Math.abs(lc[i] - lc[i - len]) / path : 0,
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


describe('calcMomz', function() {

    let arr = mkBars(700, 3)
    let cs = valuesOf(arr, 'Close')

    it('M2 回傳結構: 內建週期表之 period 與 len(同 calcCvd)、各筆之欄為 time、momZ、vel、acc、ext、er', async function() {
        let rrs = await calcMomz(arr, 'Close')
        assertRrsShape(rrs, KP)
        assertFiniteRrs(rrs, COLS, '內建表')
        assert.deepStrictEqual(rrs.map((r) => Object.keys(r)), rrs.map(() => ['period', 'len', 'vs']))
        //聚合匯出
        assert.strictEqual(wdt.calcMomz, calcMomz)
    })

    it('M3 各期自 s0 = len + max(len−1, volLen) 起算並逐根對齊; n = s0 ⇒ []、n = s0 + 1 ⇒ 恰 1 筆(含 len−1 與 volLen 各為較大者之期)', async function() {
        let rrs = await calcMomz(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let s0 = s0Of(len)
            assertTimeAlign(pickPeriod(rrs, period).vs, arr, s0)
            let r0 = pickPeriod(await calcMomz(arr.slice(0, s0), 'Close'), period)
            assert.deepStrictEqual(r0.vs, [], `${period} n = s0`)
            let r1 = pickPeriod(await calcMomz(arr.slice(0, s0 + 1), 'Close'), period)
            assert.strictEqual(r1.vs.length, 1, `${period} n = s0 + 1`)
            assert.strictEqual(r1.vs[0].time, arr[s0].time, `${period} n = s0 + 1 之 time`)
        }
        //內建表中 len − 1 < 30(前 7 期)與 len − 1 > 30(90、180)兩種皆有; 另以 opt.volLen 讓兩項各為較大者
        for (let [volLen, len, expS0] of [[5, 24, 47], [60, 24, 84], [30, 42, 83], [30, 3, 33], [2, 5, 9]]) {
            assert.strictEqual(s0Of(len, volLen), expS0, '手算 s0')
            let opt = { volLen, kp: { x: len } }
            assert.deepStrictEqual((await calcMomz(arr.slice(0, expS0), 'Close', opt))[0].vs, [], `volLen ${volLen} len ${len} n = s0`)
            let r1 = (await calcMomz(arr.slice(0, expS0 + 1), 'Close', opt))[0]
            assert.deepStrictEqual(r1.vs.map((v) => v.time), [arr[expS0].time], `volLen ${volLen} len ${len} n = s0 + 1`)
        }
    })

    it('M2 與暴力計算逐根逐欄相同(全部 9 期、預設 volLen; 另 volLen = 10 與 volLen = 2 兩組)', async function() {
        for (let volLen of [undefined, 10, 2]) {
            let opt = volLen === undefined ? {} : { volLen }
            let rrs = await calcMomz(arr, 'Close', opt)
            for (let [period, len] of Object.entries(KP)) {
                let ref = refMomz(cs, len, volLen === undefined ? 30 : volLen)
                assert.ok(ref.length > 0, `${period} 須有輸出`)
                assertSameAsRef(pickPeriod(rrs, period).vs, arr, ref, `volLen ${volLen} ${period}`)
            }
        }
    })

    it('M2 手算例: 對數收盤 0、0.1、0.3、0.2、0.6、0.5, len = 2、volLen = 2 ⇒ 第 4、5 根逐欄手算', async function() {
        //lc = [0, 0.1, 0.3, 0.2, 0.6, 0.5], r(1..5) = [0.1, 0.2, −0.1, 0.4, −0.1], s0 = 2 + max(1, 2) = 4
        let lc = [0, 0.1, 0.3, 0.2, 0.6, 0.5]
        let a = ohlcFromCloses(lc.map((x) => Math.exp(x)))
        let r = (await calcMomz(a, 'Close', { volLen: 2, kp: { x: 2 } }))[0]
        assert.deepStrictEqual(r.vs.map((v) => v.time), [a[4].time, a[5].time])
        let s2 = Math.SQRT2
        //根 4: σ(4) = std{r3, r4} = std{−0.1, 0.4} = 0.25; momZ = (0.6 − 0.3) / (0.25 √2); vel = (0.6 − 0.2) / 0.25 = 1.6;
        //      vel(2) = (0.3 − 0.1) / std{0.1, 0.2} = 0.2 / 0.05 = 4 ⇒ acc = 1.6 − 4 = −2.4; ext = (0.6 − min{0.2, 0.6}) / (0.25 √2); er = 0.3 / (0.1 + 0.4)
        let e4 = { momZ: 0.3 / (0.25 * s2), vel: 1.6, acc: -2.4, ext: 0.4 / (0.25 * s2), er: 0.6 }
        //根 5: σ(5) = std{r4, r5} = std{0.4, −0.1} = 0.25; momZ = (0.5 − 0.2) / (0.25 √2); vel = (0.5 − 0.6) / 0.25 = −0.4;
        //      vel(3) = (0.2 − 0.3) / std{0.2, −0.1} = −0.1 / 0.15 ⇒ acc = −0.4 + 2/3; ext = (0.5 − min{0.6, 0.5}) / (0.25 √2) = 0; er = 0.3 / (0.4 + 0.1)
        let e5 = { momZ: 0.3 / (0.25 * s2), vel: -0.4, acc: -0.4 + 0.1 / 0.15, ext: 0, er: 0.6 }
        for (let [k, e] of [e4, e5].entries()) {
            COLS.forEach((c) => {
                assertNear(r.vs[k][c], e[c], 1e-12, `第 ${k} 筆 ${c}`)
            })
        }
    })

    it('M2 退化: σ = 0 ⇒ momZ、vel、ext 為 0(前 60 根隨機漫步、其後 60 根收盤全相同; len = 42 之期於 σ = 0 之根其分子仍非 0, 且 acc 取前 len 根之非 0 vel); 分母為 0 ⇒ er 為 0', async function() {
        let c0 = valuesOf(mkBars(60, 11), 'Close')
        let cc = [...c0, ...new Array(60).fill(c0[59])]
        let a = ohlcFromCloses(cc, { wick: 0 })
        let rrs = await calcMomz(a, 'Close') //volLen 30: σ(i) = 0 ⇔ r(i−29 ~ i) 全為 0 ⇔ i ≥ 89
        let lc = cc.map((c) => Math.log(c))
        let r42 = pickPeriod(rrs, '7day')
        assert.strictEqual(r42.len, 42)
        let nChk = 0
        let nExt = 0
        r42.vs.forEach((v, k) => {
            let i = s0Of(42) + k
            if (i < 89) {
                assert.ok(v.momZ !== 0 && v.vel !== 0, `根 ${i}(σ 非 0)之 momZ、vel 非 0`)
                return
            }
            assert.strictEqual(v.momZ, 0, `根 ${i} momZ`)
            assert.strictEqual(v.vel, 0, `根 ${i} vel`)
            assert.strictEqual(v.ext, 0, `根 ${i} ext`)
            if (i <= 99) {
                //鑑別: 分子非 0(視窗跨到波動段), 否則 0 為分子所致而非 σ = 0 之退化值
                assert.ok(lc[i] - lc[i - 42] !== 0, `根 ${i} 之 momZ 分子`)
                assert.ok(Math.max(...win(lc, i, 42)) > Math.min(...win(lc, i, 42)), `根 ${i} 之 vel 分子(視窗非定值)`)
                assert.ok(v.acc !== 0, `根 ${i} acc = 0 − vel(i−42), vel(i−42) 非 0`)
                if (lc[i] - Math.min(...win(lc, i, 42)) > 0) {
                    nExt++ //ext 之分子非 0(定值段之位準非視窗最小)
                }
                nChk++
            }
        })
        assert.strictEqual(nChk, 11, '根 89 ~ 99 共 11 根(根 100 起視窗 W(i, 42) 全落在定值段, 其斜率分子亦為 0)')
        assert.ok(nExt >= 5, `ext 之分子非 0 之根數 ${nExt}(鑑別)`)
        //er: 視窗內報酬全為 0(i − len + 1 ≥ 60)⇒ 分母 0 ⇒ 0
        let r3 = pickPeriod(rrs, '12hr')
        let nEr = 0
        r3.vs.forEach((v, k) => {
            let i = s0Of(3) + k
            if (i >= 62) {
                assert.strictEqual(v.er, 0, `根 ${i} er`)
                nEr++
            }
        })
        assert.strictEqual(nEr, 58, '根 62 ~ 119 共 58 根')
        //全部期與暴力計算相同(暴力計算以同一規則處理退化)
        for (let [period, len] of Object.entries(KP)) {
            assertSameAsRef(pickPeriod(rrs, period).vs, a, refMomz(cc, len, 30), `退化資料 ${period}`)
        }
        assertFiniteRrs(rrs, COLS, '退化資料')
    })

    it('M2 退化: 全程定值 ⇒ 全部欄皆為 0', async function() {
        let a = genFlat(300)
        let rrs = await calcMomz(a, 'Close')
        let nOut = 0
        rrs.forEach((r) => {
            r.vs.forEach((v) => {
                COLS.forEach((c) => {
                    assert.strictEqual(v[c], 0, `${r.period} ${c}`)
                })
                nOut++
            })
        })
        assert.ok(nOut > 1000, `輸出筆數 ${nOut}`)
    })

    it('M6 σ 之下限: 完全等比之序列(r 理論上全同, 實際 σ 僅為浮點捨入之殘值)⇒ momZ、vel、ext、acc 為 0、er 為 1(上漲與下跌、各種公比、全部 9 期)', async function() {
        for (let g of [1.01, 0.99, 1.0003, 0.9997, 1.05, 0.5, 1.0000001]) {
            let a = mkGeo(500, g)
            //鑑別前提: 某視窗之 σ 為 > 0 而 ≤ 1e-12 之殘值(若 σ 恆為精確 0, 則「全部相同者為 0」已涵蓋, 測不到下限)
            let lc = valuesOf(a, 'Close').map((c) => Math.log(c))
            let r = lc.slice(1).map((v, i) => v - lc[i])
            let mx = 0
            for (let i = 30; i <= r.length; i++) {
                mx = Math.max(mx, popStd(r.slice(i - 30, i)))
            }
            assert.ok(mx > 0 && mx <= 1e-12, `公比 ${g} 之 σ 殘值最大 ${mx} 須於 (0, 1e-12]`)
            let rrs = await calcMomz(a, 'Close')
            assert.ok(rrs.every((rr) => rr.vs.length > 0), `公比 ${g} 各期須有輸出`)
            rrs.forEach((rr) => {
                rr.vs.forEach((v, k) => {
                    assert.ok(v.momZ === 0 && v.vel === 0 && v.ext === 0 && v.acc === 0, `公比 ${g} ${rr.period} 第 ${k} 筆應為 σ = 0 之退化值`)
                    assertNear(v.er, 1, 1e-9, `公比 ${g} ${rr.period} 第 ${k} 筆 er`)
                })
            })
            assertFiniteRrs(rrs, COLS, `公比 ${g}`)
        }
    })

    it('M6 σ 之下限之邊界: 對數報酬為 +δ、−δ 交替(volLen 為偶數時 σ = δ): δ = 1e-13 與 5e-13(σ ≤ 1e-12)⇒ 退化為 0; δ = 2e-12 與 1e-11(σ > 1e-12)⇒ 照算(vel、momZ 依定義式為 ±1、±1/√3)', async function() {
        let opt = { volLen: 4, kp: { a: 2, b: 3 } }
        for (let [delta, degenerate] of [[1e-13, true], [5e-13, true], [2e-12, false], [1e-11, false], [1e-8, false]]) {
            let a = mkAlt(60, delta)
            let rrs = await calcMomz(a, 'Close', opt)
            let ra = pickPeriod(rrs, 'a')
            let rb = pickPeriod(rrs, 'b')
            assert.ok(ra.vs.length > 20 && rb.vs.length > 20, `δ ${delta} 須有輸出`)
            ra.vs.forEach((v, k) => {
                if (degenerate) {
                    assert.ok(v.vel === 0 && v.momZ === 0 && v.ext === 0, `δ ${delta} a 第 ${k} 筆應為退化值`)
                }
                else {
                    //len = 2: vel = (lc(i) − lc(i−1)) / σ = ±1
                    assertNear(Math.abs(v.vel), 1, 1e-3, `δ ${delta} a 第 ${k} 筆 |vel|`)
                }
            })
            rb.vs.forEach((v, k) => {
                if (degenerate) {
                    assert.ok(v.momZ === 0, `δ ${delta} b 第 ${k} 筆 momZ 應為 0`)
                }
                else {
                    //len = 3: lc(i) − lc(i−3) = ±δ ⇒ momZ = ±1/√3
                    assertNear(Math.abs(v.momZ), 1 / Math.sqrt(3), 1e-3, `δ ${delta} b 第 ${k} 筆 |momZ|`)
                }
            })
        }
    })

    it('M2 各欄之性質與鑑別: ext ≥ 0; er 於 [0, 1]; 各欄於一般資料上取值多樣(非全為常數或退化值)', async function() {
        let rrs = await calcMomz(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, k) => {
                assert.ok(v.ext >= 0, `${r.period} 第 ${k} 筆 ext ${v.ext}`)
                assert.ok(v.er >= 0 && v.er <= 1 + 1e-9, `${r.period} 第 ${k} 筆 er ${v.er}`)
            })
            COLS.forEach((c) => {
                assert.ok(distinct(r.vs, c) > r.vs.length * 0.5, `${r.period} ${c} 取值個數 ${distinct(r.vs, c)} / ${r.vs.length}`)
            })
            //momZ 有正有負; vel 與 momZ 同號者占多數(同一段位移之兩種度量)
            assert.ok(r.vs.some((v) => v.momZ > 0) && r.vs.some((v) => v.momZ < 0), `${r.period} momZ 正負皆有`)
        })
        //單調上升: momZ、vel、ext 皆為正; er 為 1
        let up = pickPeriod(await calcMomz(genUp(300), 'Close'), '1day')
        assert.ok(up.vs.length > 100)
        up.vs.forEach((v, k) => {
            assert.ok(v.momZ > 0 && v.vel > 0 && v.ext > 0, `上升 第 ${k} 筆`)
            assertNear(v.er, 1, 1e-9, `上升 第 ${k} 筆 er`)
        })
        //單調下降: momZ、vel 為負; ext 為 0(當根即視窗最小); er 為 1
        let dn = pickPeriod(await calcMomz(genDown(300), 'Close'), '1day')
        dn.vs.forEach((v, k) => {
            assert.ok(v.momZ < 0 && v.vel < 0, `下降 第 ${k} 筆`)
            assert.strictEqual(v.ext, 0, `下降 第 ${k} 筆 ext`)
            assertNear(v.er, 1, 1e-9, `下降 第 ${k} 筆 er`)
        })
    })

    it('M1 只用當根以前之資料: 第 t 根之後依根而異地改動, 其前之輸出逐值不變而其後有變; 以第 t 根截斷之輸出同完整序列之前段', async function() {
        await assertCausal((a) => calcMomz(a, 'Close'), arr, 400, [380, 450, 600], '預設')
        let a2 = mkBars(200, 29)
        await assertCausal((a) => calcMomz(a, 'Close', { volLen: 5, kp: { x: 4, y: 12 } }), a2, 100, [60, 130], '小參數')
    })

    it('M4 opt.volLen: 預設 30(給 30、數字字串、null、undefined 皆同未給); 給了而有效者(10、2、字串)確實生效; 極大值 ⇒ 各期 vs 為空', async function() {
        let base = await calcMomz(arr, 'Close')
        for (let v of [30, '30', ' 30 ', '30.0', null, undefined]) {
            assert.deepStrictEqual(await calcMomz(arr, 'Close', { volLen: v }), base, `volLen ${String(v)}`)
        }
        let r10 = await calcMomz(arr, 'Close', { volLen: 10 })
        assert.notDeepStrictEqual(r10, base)
        assert.deepStrictEqual(await calcMomz(arr, 'Close', { volLen: '10' }), r10)
        //volLen 影響 σ, 故 momZ 之值與 s0 皆不同
        assert.notStrictEqual(pickPeriod(r10, '1day').vs[0].time, pickPeriod(base, '1day').vs[0].time)
        let big = await calcMomz(arr, 'Close', { volLen: 1000000 })
        big.forEach((r) => {
            assert.deepStrictEqual(r.vs, [], r.period)
        })
    })

    it('M4 opt.volLen 非預期之輸入視為未給(K3): 結果同未給、不 reject; 合格寫法(數值、數字字串)轉為數值使用; opt.debug 為 true 時警告(固定詞彙、不含傳入之值、同鍵每行程一次)', async function() {
        let a = mkBars(120, 5)
        let base = await calcMomz(a, 'Close')
        let r10 = await calcMomz(a, 'Close', { volLen: 10 })
        assert.notDeepStrictEqual(r10, base, '鑑別: volLen 10 之結果異於預設')
        //合格之數字字串(含空白、正號、小數點後全零、科學記號)與數值同值(K4: 檢測之值即使用之值)
        for (let v of ['10', ' 10 ', '+10', '10.0', '1e1', 10]) {
            assert.deepStrictEqual(await calcMomz(a, 'Close', { volLen: v }), r10, `volLen ${String(v)}`)
        }
        let ref = await calcMomz(a, 'Close', { volLen: 30 })
        assert.deepStrictEqual(ref, base)
        await assertOptK3({
            call: (o) => calcMomz(a, 'Close', o),
            base,
            name: 'volLen',
            invalids: intBads(2),
            sames: [30, '30', ' 30 ', '3e1'],
            tag: 'w-data-trade calcMomz',
            desc: 'an integer >= 2',
            defDesc: '30',
        })
    })

    it('M3/M5 opt.kp: 原樣採用(標籤與值、數字字串轉數值)、結果同暴力計算; 非預期之輸入視為未給; 值小於 2 或為參數物件 ⇒ reject', async function() {
        let rrs = await calcMomz(arr, 'Close', { kp: { a: 4, b: '7', c: 2 }, intervalSec: 86400 })
        assert.deepStrictEqual(rrs.map((r) => [r.period, r.len]), [['a', 4], ['b', 7], ['c', 2]])
        rrs.forEach((r) => {
            assertSameAsRef(r.vs, arr, refMomz(cs, r.len, 30), `kp ${r.period}`)
        })
        let base = await calcMomz(arr, 'Close')
        for (let kp of [{}, { a: 0 }, { a: -4 }, { a: 1.5 }, { a: 'abc' }, { a: 5, b: 0 }, 'x', 4, [4], null]) {
            assert.deepStrictEqual(await calcMomz(arr, 'Close', { kp }), base, `kp ${JSON.stringify(kp)}`)
        }
        for (let kp of [{ a: 1 }, { a: 5, b: 1 }, { a: '1' }, { a: { len: 5 } }, { a: 5, b: { mult: 2 } }]) {
            await assert.rejects(calcMomz(arr, 'Close', { kp }), (e) => e.message === msgKp, `kp ${JSON.stringify(kp)}`)
        }
    })

    it('M4 opt.intervalSec = 86400: 期別標籤為 3day … 180day, 根數與各值同預設(含 3600、數字字串、14400); 無效 ⇒ reject(先於 opt.kp 與資料之檢核)', async function() {
        await assertIntervalSec((a, o) => (o === undefined ? calcMomz(a, 'Close') : calcMomz(a, 'Close', o)), arr, 'calcMomz')
        for (let v of [0, -60, 59, 90, 1.5, 31536060, 'abc', '', NaN, Infinity, true, [], {}]) {
            await assert.rejects(calcMomz(arr, 'Close', { intervalSec: v }), (e) => e.message === msgIv, `intervalSec ${String(v)}`)
            await assert.rejects(calcMomz(arr, 'Close', { intervalSec: v, kp: { a: 5 } }), (e) => e.message === msgIv, `intervalSec ${String(v)} 與有效之 opt.kp`)
        }
        let bad = ohlcFromCloses([100, -1, 3])
        await assert.rejects(calcMomz(bad, 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('M4 輸入檢核: key 欄位須為正之有限數(任一根無效即整批 reject, 訊息不含輸入值); key 缺欄位 ⇒ reject; null、undefined、{} 視為無資料; 非陣列之字串 reject', async function() {
        for (let bad of [0, -5, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], Close: bad }
            await assert.rejects(calcMomz(a, 'Close'), (e) => e.message === msgArr, `Close ${String(bad)}`)
        }
        //最後一根無效亦拒(逐根檢核, 非只看有輸出之部分), 無效值在不用於輸出之前段亦拒
        let a1 = mkBars(60, 2)
        a1[59] = { ...a1[59], Close: -1 }
        await assert.rejects(calcMomz(a1, 'Close'), (e) => e.message === msgArr)
        //key 為非空字串而無該欄位 ⇒ 逐根檢核不過
        await assert.rejects(calcMomz(mkBars(60, 2), 'Nope'), (e) => e.message === msgArr, `key Nope`)
        //key 非非空字串: 必須參數 ⇒ msgKey(先於 opt.intervalSec 與資料之檢核, 無資料之輸入亦拒)
        let rv = Proxy.revocable({}, {})
        rv.revoke()
        for (let k of [undefined, null, '', 5, true, {}, [], ['Close'], Symbol('s'), () => 'Close', Object('Close'), rv.proxy]) {
            await assert.rejects(calcMomz(mkBars(60, 2), k), (e) => e.message === msgKey, `key ${labelOf(k)}`)
            await assert.rejects(calcMomz(mkBars(60, 2), k, { intervalSec: 'abc', volLen: 5 }), (e) => e.message === msgKey, `key ${labelOf(k)} 先於 intervalSec`)
            await assert.rejects(calcMomz(null, k), (e) => e.message === msgKey, `key ${labelOf(k)} 無資料`)
        }
        //元素非物件
        await assert.rejects(calcMomz([null, ...mkBars(60, 2)], 'Close'), (e) => e.message === msgArr)
        for (let a of [null, undefined, {}, []]) {
            let rrs = await calcMomz(a, 'Close')
            assert.deepStrictEqual(rrs.map((r) => [r.period, r.len, r.vs.length]), Object.entries(KP).map(([p, l]) => [p, l, 0]))
        }
        await assert.rejects(calcMomz('abc', 'Close'), (e) => e.message === msgArr)
    })

    it('M4 key 決定所讀欄位(讀 Open 之結果同對 Open 序列之暴力計算, 且異於讀 Close); 純函式: 重複呼叫結果一致且不改動輸入', async function() {
        let snap = JSON.stringify(arr)
        let rc = await calcMomz(arr, 'Close')
        let ro = await calcMomz(arr, 'Open')
        assert.notDeepStrictEqual(ro, rc)
        let opens = valuesOf(arr, 'Open')
        assertSameAsRef(pickPeriod(ro, '2day').vs, arr, refMomz(opens, 12, 30), 'Open 2day')
        assert.deepStrictEqual(await calcMomz(arr, 'Close'), rc)
        assert.strictEqual(JSON.stringify(arr), snap)
    })

    it('M3 暖機根數(README 載明): 內建表之 30day 期(len 180)需 360 根、12hr 期(len 3)需 34 根方有第一筆', async function() {
        let a = mkBars(400, 31)
        for (let [period, need] of [['30day', 360], ['12hr', 34]]) {
            assert.deepStrictEqual(pickPeriod(await calcMomz(a.slice(0, need - 1), 'Close'), period).vs, [], `${period} n = ${need - 1}`)
            assert.strictEqual(pickPeriod(await calcMomz(a.slice(0, need), 'Close'), period).vs.length, 1, `${period} n = ${need}`)
        }
    })

    it('M4 輸出皆為有限數值(隨機、震盪、單調上升、單調下降、定值)', async function() {
        let sets = { 隨機: mkBars(500, 17), 震盪: genOhlc(500), 上升: genUp(500), 下降: genDown(500), 定值: genFlat(500) }
        for (let [nm, a] of Object.entries(sets)) {
            let rrs = await calcMomz(a, 'Close')
            assertFiniteRrs(rrs, COLS, nm)
            assert.ok(rrs.every((r) => r.vs.length > 0), `${nm} 各期須有輸出`)
        }
    })

})
