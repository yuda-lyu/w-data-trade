import assert from 'assert'
import calcFlow from '../src/calcFlow.mjs'
import wdt from '../src/WDataTrade.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear } from './unit-setup.mjs'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import { KP, mkBars, sum, mean, win, distinct, intBads, assertOptK3, assertFiniteRrs, assertCausal, assertIntervalSec } from './unit-setupFeat.mjs'


//規格來源: src/calcFlow.mjs 之 JSDoc(累積主動買賣量之水準、速度、加速度)
//  F1 讀 Volumn 與 TakerBuyBaseAssetVolume(key 不使用); 只用當根(含)以前之資料; 輸入須 Volumn 為不小於 0 之有限數, 0 ≤ TakerBuyBaseAssetVolume ≤ Volumn × (1 + 1e-9)
//  F2 量之尺度 s(j) = 第 max(0, j − scaleWin) ~ j − 1 根(不含當根)之 Volumn 平均, 需 j ≥ scaleMin; s(j) ≤ 0 ⇒ 該根之 buy、sell 皆記 0
//       buy(j) = 主動買量 / s(j); sell(j) = (量 − 主動買量) / s(j); net(j) = buy(j) − sell(j)
//  F3 M_x(i) = x 於 W(i, len) 之平均(x = buy、sell、net); M_share(i) = W(i, len) 內(2 × 主動買量 − 量)之和 / 量之和(量之和 ≤ 0 ⇒ 0)
//       水準 L = M(i); 速度 V = M(i) − M(i − len); 加速度 A = M(i) − 2 M(i − len) + M(i − 2 len)
//       輸出 12 欄: buyL、buyV、buyA、sellL、sellV、sellA、netL、netV、netA、shareL、shareV、shareA
//  F4 s0 = scaleMin + 3 len − 1(M(i − 2 len) 之視窗最早一根為 i − 3 len + 1, 需 ≥ scaleMin); 第一筆對應輸入索引 s0, 逐根對齊至最後一根; 筆數 n < s0 + 1 ⇒ 該期 vs 為 []
//  F5 選項 opt.scaleWin(至少為 1 之整數, 預設 90)、opt.scaleMin(至少為 1 且不大於 scaleWin 之整數, 預設為 30 與 scaleWin 之較小者)皆為跨套件規格 K3(非預期之輸入視為未給而改用預設, 含 scaleMin 大於 scaleWin; opt.debug 為 true 時警告)、opt.intervalSec、opt.kp; 輸出皆為有限數值


let msgArr = 'invalid arr: must have a finite Volumn >= 0 and a finite TakerBuyBaseAssetVolume in [0, Volumn] in every element'
let msgKp = 'invalid opt.kp: must be an object of positive integers'
let msgIv = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let COLS = ['buyL', 'buyV', 'buyA', 'sellL', 'sellV', 'sellA', 'netL', 'netV', 'netA', 'shareL', 'shareV', 'shareA']

//s0Of, 各期第一筆對應之輸入索引
let s0Of = (len, scaleMin = 30) => scaleMin + 3 * len - 1

//refFlow, 暴力計算: 依 F2 ~ F4 逐根以陣列切片與定義式計算(不 import src 之內部邏輯)
let refFlow = (arr, len, scaleWin = 90, scaleMin = 30) => {
    let vol = arr.map((v) => v.Volumn)
    let tb = arr.map((v) => v.TakerBuyBaseAssetVolume)
    let n = arr.length
    let buy = new Array(n).fill(NaN)
    let sell = new Array(n).fill(NaN)
    let net = new Array(n).fill(NaN)
    for (let j = scaleMin; j < n; j++) {
        let s = mean(vol.slice(Math.max(0, j - scaleWin), j))
        buy[j] = s > 0 ? tb[j] / s : 0
        sell[j] = s > 0 ? (vol[j] - tb[j]) / s : 0
        net[j] = buy[j] - sell[j]
    }
    //M, x 於 W(i, len) 之平均(視窗內不得有無值之根)
    let M = (x) => (i) => {
        let w = win(x, i, len)
        assert.ok(w.every((v) => !Number.isNaN(v)), `M(${i}) 之視窗含無值之根`)
        return mean(w)
    }
    let Ms = (i) => {
        let v = win(vol, i, len)
        let t = win(tb, i, len)
        let den = sum(v)
        return den > 0 ? sum(v.map((x, k) => 2 * t[k] - x)) / den : 0
    }
    let tri = (f, i) => ({ L: f(i), V: f(i) - f(i - len), A: f(i) - 2 * f(i - len) + f(i - 2 * len) })
    let out = []
    for (let i = s0Of(len, scaleMin); i < n; i++) {
        let o = { i }
        for (let [nm, f] of [['buy', M(buy)], ['sell', M(sell)], ['net', M(net)], ['share', Ms]]) {
            let t = tri(f, i)
            o[`${nm}L`] = t.L
            o[`${nm}V`] = t.V
            o[`${nm}A`] = t.A
        }
        out.push(o)
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


describe('calcFlow', function() {

    let arr = mkBars(800, 3)

    it('F3 回傳結構: 內建週期表之 period 與 len(同 calcCvd)、各筆之欄為 time 與 12 個輸出欄', async function() {
        let rrs = await calcFlow(arr, 'Close')
        assertRrsShape(rrs, KP)
        assertFiniteRrs(rrs, COLS, '內建表')
        assert.deepStrictEqual(rrs.map((r) => Object.keys(r)), rrs.map(() => ['period', 'len', 'vs']))
        assert.strictEqual(wdt.calcFlow, calcFlow)
    })

    it('F4 各期自 s0 = scaleMin + 3 len − 1 起算並逐根對齊; n = s0 ⇒ []、n = s0 + 1 ⇒ 恰 1 筆(含不同之 scaleMin 與 len = 1)', async function() {
        let rrs = await calcFlow(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let s0 = s0Of(len)
            assert.strictEqual(s0, 29 + 3 * len)
            assertTimeAlign(pickPeriod(rrs, period).vs, arr, s0)
            let r0 = pickPeriod(await calcFlow(arr.slice(0, s0), 'Close'), period)
            assert.deepStrictEqual(r0.vs, [], `${period} n = s0`)
            let r1 = pickPeriod(await calcFlow(arr.slice(0, s0 + 1), 'Close'), period)
            assert.strictEqual(r1.vs.length, 1, `${period} n = s0 + 1`)
            assert.strictEqual(r1.vs[0].time, arr[s0].time, `${period} n = s0 + 1 之 time`)
        }
        for (let [scaleWin, scaleMin, len, expS0] of [[20, 5, 4, 16], [90, 40, 1, 42], [1, 1, 2, 6], [90, 90, 3, 98], [5, 5, 180, 544]]) {
            assert.strictEqual(s0Of(len, scaleMin), expS0, '手算 s0')
            let opt = { scaleWin, scaleMin, kp: { x: len } }
            assert.deepStrictEqual((await calcFlow(arr.slice(0, expS0), 'Close', opt))[0].vs, [], `scaleWin ${scaleWin} scaleMin ${scaleMin} len ${len} n = s0`)
            let r1 = (await calcFlow(arr.slice(0, expS0 + 1), 'Close', opt))[0]
            assert.deepStrictEqual(r1.vs.map((v) => v.time), [arr[expS0].time], `scaleWin ${scaleWin} scaleMin ${scaleMin} len ${len} n = s0 + 1`)
        }
    })

    it('F2 ~ F3 與暴力計算逐根逐欄相同(全部 9 期、預設選項; 另 scaleWin = 20 且 scaleMin = 5、scaleWin = 1 且 scaleMin = 1、scaleWin = 700 且 scaleMin = 60 三組)', async function() {
        let rrs = await calcFlow(arr, 'Close')
        for (let [period, len] of Object.entries(KP)) {
            let ref = refFlow(arr, len)
            assert.ok(ref.length > 0, `${period} 須有輸出`)
            assertSameAsRef(pickPeriod(rrs, period).vs, arr, ref, period)
        }
        for (let [w, m] of [[20, 5], [1, 1], [700, 60]]) {
            let r2 = await calcFlow(arr, 'Close', { scaleWin: w, scaleMin: m })
            for (let [period, len] of Object.entries(KP)) {
                let ref = refFlow(arr, len, w, m)
                assertSameAsRef(pickPeriod(r2, period).vs, arr, ref, `scaleWin ${w} scaleMin ${m} ${period}`)
            }
        }
    })

    it('F2 ~ F3 手算例: 量 10 ~ 60、主動買量 6、12、15、30、20、45, scaleWin = 3、scaleMin = 2、len = 1 ⇒ s0 = 4, 第 4、5 根逐欄手算', async function() {
        let vl = [10, 20, 30, 40, 50, 60]
        let tb = [6, 12, 15, 30, 20, 45]
        let a = ohlcFromCloses([10, 11, 10, 12, 11, 13], { vols: vl })
        a.forEach((v, i) => {
            v.TakerBuyBaseAssetVolume = tb[i]
        })
        //s(2) = (10 + 20)/2 = 15、s(3) = (10 + 20 + 30)/3 = 20、s(4) = (20 + 30 + 40)/3 = 30、s(5) = (30 + 40 + 50)/3 = 40
        //  buy = tb/s: 根 2 ~ 5 = 1、1.5、2/3、1.125; sell = (量 − tb)/s: 1、0.5、1、0.375; net = buy − sell: 0、1、−1/3、0.75
        //  share(len = 1) = (2tb − 量)/量: 根 2 ~ 5 = 0、0.5、−0.2、0.5
        //  L = M(i)、V = M(i) − M(i−1)、A = M(i) − 2M(i−1) + M(i−2)
        let r = (await calcFlow(a, 'Close', { scaleWin: 3, scaleMin: 2, kp: { x: 1 } }))[0]
        assert.deepStrictEqual(r.vs.map((v) => v.time), [a[4].time, a[5].time])
        let e4 = {
            buyL: 2 / 3,
            buyV: 2 / 3 - 1.5,
            buyA: 2 / 3 - 3 + 1,
            sellL: 1,
            sellV: 1 - 0.5,
            sellA: 1 - 1 + 1,
            netL: -1 / 3,
            netV: -1 / 3 - 1,
            netA: -1 / 3 - 2 + 0,
            shareL: -0.2,
            shareV: -0.2 - 0.5,
            shareA: -0.2 - 1 + 0,
        }
        let e5 = {
            buyL: 1.125,
            buyV: 1.125 - 2 / 3,
            buyA: 1.125 - 4 / 3 + 1.5,
            sellL: 0.375,
            sellV: 0.375 - 1,
            sellA: 0.375 - 2 + 0.5,
            netL: 0.75,
            netV: 0.75 + 1 / 3,
            netA: 0.75 + 2 / 3 + 1,
            shareL: 0.5,
            shareV: 0.7,
            shareA: 0.5 + 0.4 + 0.5,
        }
        for (let [k, e] of [e4, e5].entries()) {
            COLS.forEach((c) => {
                assertNear(r.vs[k][c], e[c], 1e-12, `第 ${k} 筆 ${c}`)
            })
        }
    })

    it('F2 退化: 尺度 s(j) ≤ 0 ⇒ 該根之 buy、sell 記 0(量尺度窗內之量全為 0 而當根量為正; share 仍依量計為 0.2); 視窗內量之和為 0 ⇒ share 為 0', async function() {
        //根 0 ~ 99 隨機、100 ~ 139 量為 0(主動買量 0)、根 140 量 500 且主動買量 300、其後隨機
        let a = mkBars(200, 71).map((v, i) => {
            if (i >= 100 && i < 140) {
                return { ...v, Volumn: 0, TakerBuyBaseAssetVolume: 0 }
            }
            if (i === 140) {
                return { ...v, Volumn: 500, TakerBuyBaseAssetVolume: 300 }
            }
            return v
        })
        let opt = { scaleWin: 20, scaleMin: 5 }
        let r1 = (await calcFlow(a, 'Close', { ...opt, kp: { x: 1 } }))[0]
        assertSameAsRef(r1.vs, a, refFlow(a, 1, 20, 5), '零量段 len = 1')
        let at = (i) => r1.vs[i - s0Of(1, 5)]
        //根 140: s(140) = 根 120 ~ 139 之量平均 = 0 ⇒ buy = sell = net = 0; share = (2 × 300 − 500)/500 = 0.2; 速度 = 0.2 − M_share(139)(= 0)
        let v140 = at(140)
        assert.strictEqual(v140.time, a[140].time)
        assert.strictEqual(v140.buyL, 0)
        assert.strictEqual(v140.sellL, 0)
        assert.strictEqual(v140.netL, 0)
        assertNear(v140.shareL, 0.2, 1e-12, '根 140 shareL')
        assertNear(v140.shareV, 0.2, 1e-12, '根 140 shareV')
        //根 141: s(141) = 根 121 ~ 140 之量平均 = 500/20 = 25 ⇒ 恢復有限正值
        let v141 = at(141)
        assert.ok(v141.buyL > 0 || v141.sellL > 0, '根 141 之 buy/sell 非 0')
        //根 100 ~ 139: 量為 0 ⇒ len = 1 之 share 為 0; buy、sell 為 0(量與主動買量皆 0)
        for (let i = 100; i < 140; i++) {
            let v = at(i)
            assert.strictEqual(v.shareL, 0, `根 ${i} shareL`)
            assert.strictEqual(v.buyL, 0, `根 ${i} buyL`)
            assert.strictEqual(v.sellL, 0, `根 ${i} sellL`)
        }
        //len = 3: 視窗全落在零量段之 share 為 0(分母 0), 全部與暴力計算相同
        let r3 = (await calcFlow(a, 'Close', { ...opt, kp: { x: 3 } }))[0]
        assertSameAsRef(r3.vs, a, refFlow(a, 3, 20, 5), '零量段 len = 3')
        for (let i = 102; i < 140; i++) {
            let v = r3.vs[i - s0Of(3, 5)]
            assert.strictEqual(v.shareL, 0, `len = 3 根 ${i} shareL`)
        }
        //全部量為 0 ⇒ 全部輸出欄為 0
        let z = mkBars(300, 72).map((v) => ({ ...v, Volumn: 0, TakerBuyBaseAssetVolume: 0 }))
        let nZ = 0
        let rz = await calcFlow(z, 'Close', { scaleWin: 10, scaleMin: 3 })
        rz.forEach((r) => {
            r.vs.forEach((v) => {
                COLS.forEach((c) => {
                    assert.strictEqual(v[c], 0, `${r.period} ${c}`)
                })
                nZ++
            })
        })
        assert.ok(nZ > 1000, `輸出筆數 ${nZ}`)
    })

    it('F3 各欄之性質與鑑別: net = buy − sell 對 L、V、A 皆成立; buyL ≥ 0; shareL 於 [−1, 1]; 12 欄取值皆多樣; 主動買量全為量之一半 ⇒ shareL 為 0、netL 為 0', async function() {
        let rrs = await calcFlow(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, k) => {
                for (let o of ['L', 'V', 'A']) {
                    assertNear(v[`net${o}`], v[`buy${o}`] - v[`sell${o}`], 1e-9, `${r.period} 第 ${k} 筆 net${o}`)
                }
                assert.ok(v.buyL >= 0 && v.sellL >= 0, `${r.period} 第 ${k} 筆 buyL ${v.buyL} sellL ${v.sellL}`)
                assert.ok(v.shareL >= -1 - 1e-9 && v.shareL <= 1 + 1e-9, `${r.period} 第 ${k} 筆 shareL ${v.shareL}`)
            })
            COLS.forEach((c) => {
                assert.ok(distinct(r.vs, c) > r.vs.length * 0.5, `${r.period} ${c} 取值個數 ${distinct(r.vs, c)} / ${r.vs.length}`)
            })
            assert.ok(r.vs.some((v) => v.shareL > 0) && r.vs.some((v) => v.shareL < 0), `${r.period} shareL 正負皆有`)
        })
        //主動買量 = 量之一半 ⇒ buy = sell(net 0)、share 0(視窗內量之和為正)
        let h = mkBars(300, 73).map((v) => ({ ...v, TakerBuyBaseAssetVolume: v.Volumn / 2 }))
        let rh = await calcFlow(h, 'Close', { kp: { x: 3, y: 12 } })
        rh.forEach((r) => {
            assert.ok(r.vs.length > 100, r.period)
            r.vs.forEach((v) => {
                for (let o of ['L', 'V', 'A']) {
                    assertNear(v[`net${o}`], 0, 1e-9, `${r.period} net${o}`)
                    assertNear(v[`share${o}`], 0, 1e-9, `${r.period} share${o}`)
                    assertNear(v[`buy${o}`], v[`sell${o}`], 1e-9, `${r.period} buy${o} = sell${o}`)
                }
            })
        })
    })

    it('F1 只用當根以前之資料: 第 t 根之後依根而異地改動, 其前之輸出逐值不變而其後有變; 以第 t 根截斷之輸出同完整序列之前段', async function() {
        await assertCausal((a) => calcFlow(a, 'Close'), arr, 600, [580, 650, 780], '預設')
        let a2 = mkBars(200, 29)
        await assertCausal((a) => calcFlow(a, 'Close', { scaleWin: 10, scaleMin: 3, kp: { x: 2, y: 5 } }), a2, 100, [60, 130], '小參數')
    })

    it('F5 opt.scaleWin、opt.scaleMin: 預設(給預設值、數字字串、null、undefined 皆同未給); 給了而有效者(含 scaleMin = scaleWin)確實生效; scaleWin 極大亦可', async function() {
        let a = mkBars(300, 13)
        let opt0 = { kp: { x: 3, y: 12 } }
        let base = await calcFlow(a, 'Close', opt0)
        for (let v of [90, '90', ' 90 ', '90.0', null, undefined]) {
            assert.deepStrictEqual(await calcFlow(a, 'Close', { ...opt0, scaleWin: v }), base, `scaleWin ${String(v)}`)
        }
        for (let v of [30, '30', null, undefined]) {
            assert.deepStrictEqual(await calcFlow(a, 'Close', { ...opt0, scaleMin: v }), base, `scaleMin ${String(v)}`)
        }
        let r1 = await calcFlow(a, 'Close', { ...opt0, scaleWin: 40, scaleMin: 10 })
        assert.notDeepStrictEqual(r1, base)
        assert.deepStrictEqual(await calcFlow(a, 'Close', { ...opt0, scaleWin: '40', scaleMin: '10' }), r1)
        assert.strictEqual(r1[0].vs[0].time, a[s0Of(3, 10)].time, 's0 隨 scaleMin 改變')
        //只改 scaleMin(90 以內)亦改變輸出; scaleMin = scaleWin 有效
        assert.notDeepStrictEqual(await calcFlow(a, 'Close', { ...opt0, scaleMin: 60 }), base)
        let rEq = await calcFlow(a, 'Close', { ...opt0, scaleWin: 10, scaleMin: 10 })
        rEq.forEach((r) => {
            assertSameAsRef(r.vs, a, refFlow(a, r.len, 10, 10), `scaleWin = scaleMin = 10 ${r.period}`)
        })
        //scaleWin 極大: 尺度為其前全部根之平均, 同暴力計算
        let rBig = await calcFlow(a, 'Close', { ...opt0, scaleWin: 1000000, scaleMin: 30 })
        rBig.forEach((r) => {
            assertSameAsRef(r.vs, a, refFlow(a, r.len, 1000000, 30), `scaleWin 極大 ${r.period}`)
        })
        //scaleMin 極大(同為 scaleWin)⇒ 資料不足
        let rNone = await calcFlow(a, 'Close', { scaleWin: 1000000, scaleMin: 1000000 })
        rNone.forEach((r) => {
            assert.deepStrictEqual(r.vs, [], r.period)
        })
    })

    it('F5 opt.scaleWin、opt.scaleMin 非預期之輸入視為未給(K3): 結果同未給、不 reject; 合格寫法(數值、數字字串)轉為數值使用; opt.debug 為 true 時警告(固定詞彙、不含傳入之值、同鍵每行程一次)', async function() {
        let a = mkBars(300, 13)
        let opt0 = { kp: { x: 3, y: 12 } }
        let base = await calcFlow(a, 'Close', opt0)
        let r1 = await calcFlow(a, 'Close', { ...opt0, scaleWin: 40, scaleMin: 10 })
        assert.notDeepStrictEqual(r1, base, '鑑別: scaleWin 40 且 scaleMin 10 之結果異於預設')
        //合格之數字字串(含空白、正號、科學記號)與數值同值(K4)
        for (let [w, m] of [['40', '10'], [' 40 ', ' 10 '], ['+40', '+10'], ['40.0', '10.0'], ['4e1', '1e1']]) {
            assert.deepStrictEqual(await calcFlow(a, 'Close', { ...opt0, scaleWin: w, scaleMin: m }), r1, `scaleWin ${w} scaleMin ${m}`)
        }
        await assertOptK3({
            call: (o) => calcFlow(a, 'Close', o),
            base,
            name: 'scaleWin',
            invalids: intBads(1),
            sames: [90, '90', ' 90 ', '9e1'],
            tag: 'w-data-trade calcFlow',
            desc: 'a positive integer',
            defDesc: '90',
            extra: opt0,
        })
        //scaleMin 之非預期含大於 scaleWin 者(跨鍵依賴): scaleWin 為 100 時 101 以上亦為非預期
        let baseW100 = await calcFlow(a, 'Close', { ...opt0, scaleWin: 100 })
        await assertOptK3({
            call: (o) => calcFlow(a, 'Close', o),
            base: baseW100,
            name: 'scaleMin',
            invalids: [...intBads(1), 101, '101', 1000, '1e3'],
            sames: [30, '30', ' 30 ', '3e1'],
            tag: 'w-data-trade calcFlow',
            desc: 'a positive integer <= opt.scaleWin',
            defDesc: 'the smaller of 30 and opt.scaleWin',
            extra: { ...opt0, scaleWin: 100 },
        })
        //scaleMin 大於 scaleWin ⇒ 視為未給, 改用預設 min(30, scaleWin)(不是 scaleMin 本身、也不是 scaleWin)
        let at = (o) => calcFlow(a, 'Close', { ...opt0, ...o })
        assert.deepStrictEqual(await at({ scaleWin: 10, scaleMin: 11 }), await at({ scaleWin: 10, scaleMin: 10 }), 'scaleWin 10 scaleMin 11')
        assert.deepStrictEqual(await at({ scaleWin: 10, scaleMin: 11 }), await at({ scaleWin: 10 }), 'scaleWin 10 scaleMin 11 同只給 scaleWin')
        assert.deepStrictEqual(await at({ scaleMin: 91 }), base, 'scaleMin 91(scaleWin 預設 90)')
        assert.deepStrictEqual(await at({ scaleWin: '5', scaleMin: '6' }), await at({ scaleWin: 5, scaleMin: 5 }), 'scaleWin 5 scaleMin 6')
        assert.deepStrictEqual(await at({ scaleWin: 20, scaleMin: 30 }), await at({ scaleWin: 20, scaleMin: 20 }), 'scaleWin 20 scaleMin 30')
        assert.notDeepStrictEqual(await at({ scaleWin: 20, scaleMin: 30 }), await at({ scaleWin: 20, scaleMin: 19 }), '鑑別: scaleMin 19 與 20 之結果不同')
        //scaleWin 非預期而 scaleMin 合格: scaleMin 對照 scaleWin 之預設 90
        assert.deepStrictEqual(await at({ scaleWin: 'x', scaleMin: 60 }), await at({ scaleMin: 60 }), 'scaleWin 非預期、scaleMin 60')
        assert.deepStrictEqual(await at({ scaleWin: 'x', scaleMin: 95 }), base, 'scaleWin 非預期、scaleMin 95 > 預設 scaleWin 90')
        //跨鍵之警告: scaleMin 大於 scaleWin 時警告 scaleMin(固定詞彙)
        getOptReader.resetWarned()
        let logs = []
        await at({ scaleWin: 10, scaleMin: 11, debug: true, funLog: (m, info) => logs.push([m, info]) })
        assert.ok(logs.length === 1 && logs[0][0] === '[w-data-trade calcFlow] invalid opt.scaleMin: must be a positive integer <= opt.scaleWin, using default the smaller of 30 and opt.scaleWin' && logs[0][1].key === 'scaleMin', '跨鍵警告')
        getOptReader.resetWarned()

        //只給小於 30 之 scaleWin: scaleMin 之預設取 scaleWin(與明給同值者逐值相同, 且與 scaleMin = 30 之結果不同 —— s0 隨之改變)
        let b = mkBars(300, 5)
        for (let w of [20, 29, 1]) {
            let rDef = await calcFlow(b, 'Close', { scaleWin: w })
            assert.deepStrictEqual(rDef, await calcFlow(b, 'Close', { scaleWin: w, scaleMin: w }), `scaleWin ${w} 之預設 scaleMin`)
            assert.strictEqual(rDef[0].vs[0].time, b[s0Of(rDef[0].len, w)].time, `scaleWin ${w} 之 s0`)
            assert.notStrictEqual(rDef[0].vs[0].time, b[s0Of(rDef[0].len, 30)].time, `scaleWin ${w} 之 s0 不為預設 30 者`)
        }
        //scaleWin 不小於 30 者, scaleMin 之預設仍為 30
        assert.deepStrictEqual(await calcFlow(b, 'Close', { scaleWin: 31 }), await calcFlow(b, 'Close', { scaleWin: 31, scaleMin: 30 }), 'scaleWin 31 之預設 scaleMin')
        assert.notDeepStrictEqual(await calcFlow(b, 'Close', { scaleWin: 31 }), await calcFlow(b, 'Close', { scaleWin: 31, scaleMin: 31 }), 'scaleWin 31 之預設 scaleMin 不為 31')
        //邊界: scaleWin = 30(= 預設 scaleMin)與 scaleMin = 90(= 預設 scaleWin)有效
        assertFiniteRrs(await calcFlow(mkBars(300, 5), 'Close', { scaleWin: 30 }), COLS, 'scaleWin = 30')
        assertFiniteRrs(await calcFlow(mkBars(300, 5), 'Close', { scaleMin: 90 }), COLS, 'scaleMin = 90')
    })

    it('F5 opt.kp: 原樣採用(標籤與值、數字字串轉數值、len = 1 可用)、結果同暴力計算; 非預期之輸入視為未給; 值為參數物件 ⇒ reject', async function() {
        let rrs = await calcFlow(arr, 'Close', { kp: { a: 4, b: '7', c: 1 }, intervalSec: 86400 })
        assert.deepStrictEqual(rrs.map((r) => [r.period, r.len]), [['a', 4], ['b', 7], ['c', 1]])
        rrs.forEach((r) => {
            assertSameAsRef(r.vs, arr, refFlow(arr, r.len), `kp ${r.period}`)
        })
        let base = await calcFlow(arr, 'Close')
        for (let kp of [{}, { a: 0 }, { a: -4 }, { a: 1.5 }, { a: 'abc' }, { a: 5, b: 0 }, 'x', 4, [4], null]) {
            assert.deepStrictEqual(await calcFlow(arr, 'Close', { kp }), base, `kp ${JSON.stringify(kp)}`)
        }
        for (let kp of [{ a: { len: 5 } }, { a: 5, b: { mult: 2 } }]) {
            await assert.rejects(calcFlow(arr, 'Close', { kp }), (e) => e.message === msgKp, `kp ${JSON.stringify(kp)}`)
        }
    })

    it('F5 opt.intervalSec = 86400: 期別標籤為 3day … 180day, 根數與各值同預設(含 3600、數字字串、14400); 無效 ⇒ reject(先於 opt.kp 與資料之檢核)', async function() {
        await assertIntervalSec((a, o) => calcFlow(a, 'Close', o), arr, 'calcFlow')
        for (let v of [0, -60, 59, 90, 1.5, 31536060, 'abc', '', NaN, Infinity, true, [], {}]) {
            await assert.rejects(calcFlow(arr, 'Close', { intervalSec: v }), (e) => e.message === msgIv, `intervalSec ${String(v)}`)
            await assert.rejects(calcFlow(arr, 'Close', { intervalSec: v, kp: { a: 5 } }), (e) => e.message === msgIv, `intervalSec ${String(v)} 與有效之 opt.kp`)
        }
        let bad = mkBars(10, 1)
        bad[3] = { ...bad[3], Volumn: -1 }
        await assert.rejects(calcFlow(bad, 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('F1 輸入檢核: Volumn 須為不小於 0 之有限數, 主動買量須為有限數且 0 ≤ 主動買量 ≤ 量 × (1 + 1e-9)(任一根無效即整批 reject, 訊息不含輸入值); null、undefined、{} 視為無資料; 非陣列之字串 reject; key 不使用', async function() {
        for (let bad of [-1, -1e-9, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], Volumn: bad }
            await assert.rejects(calcFlow(a, 'Close'), (e) => e.message === msgArr, `Volumn ${String(bad)}`)
        }
        for (let bad of [-1, -1e-9, NaN, Infinity, -Infinity, '100', null, undefined, true, {}, 1e6]) {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], TakerBuyBaseAssetVolume: bad }
            await assert.rejects(calcFlow(a, 'Close'), (e) => e.message === msgArr, `TakerBuyBaseAssetVolume ${String(bad)}`)
        }
        //量之相對界: tb = 量 × (1 + 1e-9) 為界(含), 再大即拒; 量為 0 時主動買量須為 0
        let lim = 1000 * (1 + 1e-9)
        let mk = (v, t) => {
            let a = mkBars(60, 2)
            a[10] = { ...a[10], Volumn: v, TakerBuyBaseAssetVolume: t }
            return a
        }
        for (let [v, t] of [[1000, 1000], [1000, 0], [1000, lim], [1000, 1000 * (1 + 5e-10)], [0, 0]]) {
            assertFiniteRrs(await calcFlow(mk(v, t), 'Close', { kp: { x: 3 }, scaleMin: 5, scaleWin: 20 }), COLS, `量 ${v} 買 ${t}`)
        }
        for (let [v, t] of [[1000, 1000 * (1 + 2e-9)], [1000, 1000.000002], [0, 1e-12], [0, 1]]) {
            await assert.rejects(calcFlow(mk(v, t), 'Close'), (e) => e.message === msgArr, `量 ${v} 買 ${t}`)
        }
        //最後一根無效亦拒
        let a1 = mkBars(60, 2)
        a1[59] = { ...a1[59], Volumn: -1 }
        await assert.rejects(calcFlow(a1, 'Close'), (e) => e.message === msgArr)
        await assert.rejects(calcFlow([null, ...mkBars(60, 2)], 'Close'), (e) => e.message === msgArr)
        for (let a of [null, undefined, {}, []]) {
            let rrs = await calcFlow(a, 'Close')
            assert.deepStrictEqual(rrs.map((r) => [r.period, r.len, r.vs.length]), Object.entries(KP).map(([p, l]) => [p, l, 0]))
        }
        await assert.rejects(calcFlow('abc', 'Close'), (e) => e.message === msgArr)
        //key 不使用
        let base = await calcFlow(arr, 'Close')
        for (let k of ['Open', 'Nope', undefined, null, '']) {
            assert.deepStrictEqual(await calcFlow(arr, k), base, `key ${String(k)}`)
        }
    })

    it('F4 暖機根數(README 載明): 內建表之 30day 期(len 180)需 570 根、12hr 期(len 3)需 39 根方有第一筆', async function() {
        let a = mkBars(620, 31)
        for (let [period, need] of [['30day', 570], ['12hr', 39]]) {
            assert.deepStrictEqual(pickPeriod(await calcFlow(a.slice(0, need - 1), 'Close'), period).vs, [], `${period} n = ${need - 1}`)
            assert.strictEqual(pickPeriod(await calcFlow(a.slice(0, need), 'Close'), period).vs.length, 1, `${period} n = ${need}`)
        }
    })

    it('F5 純函式: 重複呼叫結果一致且不改動輸入; 輸出皆為有限數值(隨機、震盪、單調上升、單調下降、定值)', async function() {
        let snap = JSON.stringify(arr)
        let r1 = await calcFlow(arr, 'Close')
        assert.deepStrictEqual(await calcFlow(arr, 'Close'), r1)
        assert.strictEqual(JSON.stringify(arr), snap)
        let sets = { 隨機: mkBars(800, 17), 震盪: genOhlc(800), 上升: genUp(800), 下降: genDown(800), 定值: genFlat(800) }
        for (let [nm, a] of Object.entries(sets)) {
            let rrs = await calcFlow(a, 'Close')
            assertFiniteRrs(rrs, COLS, nm)
            assert.ok(rrs.every((r) => r.vs.length > 0), `${nm} 各期須有輸出`)
        }
    })

})
