import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import calcDirChange from '../src/calcDirChange.mjs'
import periodInfo from '../src/periodInfo.mjs'
import dataConvert from '../src/dataConvert.mjs'
import { resetWarned } from '../src/resolvePeriods.mjs'
import { genOhlc, genFlat, genUp, ohlcFromCloses, genTimes, valuesOf, pickPeriod, assertNear } from './unit-setup.mjs'


//規格來源: src/calcDirChange.mjs 之 JSDoc (方向改變法 directional change)
//  S1 只用收盤: lc = ln(Close), θ = ln(1 + 門檻百分比 / 100); 逐根且只看到當根(因果)
//  S2 起始: 同時記至今之最高與最低 lc; lc − 最低 ≥ θ ⇒ 確認為漲(+1), 否則 最高 − lc ≥ θ ⇒ 確認為跌(−1); 確認前無值(不輸出)
//  S3 漲之方向記至今之最高 ext; lc ≤ ext − θ ⇒ 換為跌、ext 改記該根; 否則創新高時更新 ext; 跌之方向對稱
//  S4 轉折點 pivot: 第 1 次確認漲(跌)為至今之最低(最高), 其後換向時為換向前之 ext
//  S5 輸出: dirState = 已確認之方向; dirRetrace = 漲 (ext − lc)/θ、跌 (lc − ext)/θ, 範圍 [0, 1); dirRun = 漲 (lc − pivot)/θ、跌 (pivot − lc)/θ, 確認當根 ≥ 1、恆 > 0; dirAge = 自確認起之根數(確認當根 0)
//  S6 內建門檻表 { '4pct': 4, '6pct': 6, '8pct': 8, '10pct': 10 }; 各期 len 固定 0、pct 為門檻百分比; 標籤與輸出不隨 opt.intervalSec 改變; periodInfo 認 `${N}pct` 回 0 根 0 秒(同 'none'; 接受集合之細項見 unit-intervalSec S7); dataConvert 照常使用(檔名之期別為 `${N}pct`)
//  S7 opt.intervalSec 給了而無效 ⇒ reject(訊息同其他 calc), 先於 opt.kp 與資料之檢核
//  S8 opt.kp: 值為正整數(數字字串轉數值)之物件 ⇒ 標籤與值原樣採用; 非預期之輸入 ⇒ 視為未給(內建表), opt.debug 時經 funLog 警告; 值為物件 ⇒ reject
//  S9 Close 非正之有限數 ⇒ reject `invalid arr: must have a positive finite Close in every element`(不含輸入值)
//  S10 資料不足或未曾確認者該門檻之 vs 為空陣列; arr 為 null、undefined、{}(size 0)視為無資料, 其餘非陣列值(字串、非空物件)讀不到有效 Close 而 reject; key 未使用


let KP = { '4pct': 4, '6pct': 6, '8pct': 8, '10pct': 10 }

//refDirChange, 參考實作: 依 S1~S5 以索引記極值與轉折點(不 import src 之內部邏輯), 另回傳每根之轉折點索引 iPiv 與確認之根 iCf
let refDirChange = (cs, pct) => {
    let th = Math.log(1 + pct / 100)
    let lc = cs.map((c) => Math.log(c))
    let out = []
    let s = 0
    let iHi = 0
    let iLo = 0
    let iExt = -1
    let iPiv = -1
    let iCf = -1
    for (let i = 0; i < lc.length; i++) {
        if (s === 0) {
            if (lc[i] > lc[iHi]) {
                iHi = i
            }
            if (lc[i] < lc[iLo]) {
                iLo = i
            }
            if (lc[i] - lc[iLo] >= th) {
                s = 1
                iPiv = iLo
                iExt = i
                iCf = i
            }
            else if (lc[iHi] - lc[i] >= th) {
                s = -1
                iPiv = iHi
                iExt = i
                iCf = i
            }
        }
        else if (s === 1) {
            if (lc[i] > lc[iExt]) {
                iExt = i
            }
            else if (lc[iExt] - lc[i] >= th) {
                s = -1
                iPiv = iExt
                iExt = i
                iCf = i
            }
        }
        else {
            if (lc[i] < lc[iExt]) {
                iExt = i
            }
            else if (lc[i] - lc[iExt] >= th) {
                s = 1
                iPiv = iExt
                iExt = i
                iCf = i
            }
        }
        if (s !== 0) {
            out.push({ i, dirState: s, dirRetrace: s * (lc[iExt] - lc[i]) / th, dirRun: s * (lc[i] - lc[iPiv]) / th, dirAge: i - iCf, iPiv, iCf })
        }
    }
    return out
}

//walk, 幾何隨機漫步之收盤(LCG 固定種子; 各根之值相異)
let walk = (n, seed, vol) => {
    let st = seed >>> 0
    let r = () => {
        st = (st * 1664525 + 1013904223) >>> 0
        return st / 4294967296
    }
    let c = 100
    let cs = []
    for (let i = 0; i < n; i++) {
        c = c * Math.exp((r() + r() + r() + r() - 2) * vol)
        cs.push(c)
    }
    return cs
}

//assertSameAsRef, 某期之 vs 與參考實作逐根相同(時間對齊輸入之索引 i)
let assertSameAsRef = (vs, arr, ref, msg) => {
    assert.strictEqual(vs.length, ref.length, `${msg} 筆數`)
    vs.forEach((v, k) => {
        let e = ref[k]
        assert.strictEqual(v.time, arr[e.i].time, `${msg} 第 ${k} 筆 time`)
        assert.strictEqual(v.dirState, e.dirState, `${msg} 第 ${k} 筆 dirState`)
        assert.strictEqual(v.dirAge, e.dirAge, `${msg} 第 ${k} 筆 dirAge`)
        assertNear(v.dirRetrace, e.dirRetrace, 1e-12, `${msg} 第 ${k} 筆 dirRetrace`)
        assertNear(v.dirRun, e.dirRun, 1e-12, `${msg} 第 ${k} 筆 dirRun`)
        assert.deepStrictEqual(Object.keys(v), ['time', 'dirState', 'dirRetrace', 'dirRun', 'dirAge'], `${msg} 第 ${k} 筆之欄`)
    })
}

let msgIv = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let msgClose = 'invalid arr: must have a positive finite Close in every element'


describe('calcDirChange', function() {

    it('S6 回傳結構: 內建門檻表之標籤、len 固定 0、pct 為門檻百分比', async function() {
        let rrs = await calcDirChange(genOhlc(200), 'Close')
        assert.deepStrictEqual(rrs.map((v) => v.period), Object.keys(KP))
        assert.deepStrictEqual(rrs.map((v) => v.len), [0, 0, 0, 0])
        assert.deepStrictEqual(rrs.map((v) => v.pct), Object.values(KP))
        assert.deepStrictEqual(rrs.map((v) => Object.keys(v)), rrs.map(() => ['period', 'len', 'pct', 'vs']))
    })

    it('S2~S5 手算例: 對數收盤 0、0.05、0.12、0.08、0.20、0.09、0.03、0.10、0.02、−0.05、0.08、0.15 於 θ = 0.10 之刻度 ⇒ 第 2 根確認為漲、第 5 根換為跌、第 10 根換為漲', async function() {
        //以 10pct(θ10 = ln 1.1)計: 收盤取 exp(v × θ10 / 0.10), 則 lc / θ10 = v / 0.10, 各比例同 θ = 0.10 之手算(最小餘裕 0.01θ, 浮點誤差不影響判定)
        let v = [0, 0.05, 0.12, 0.08, 0.20, 0.09, 0.03, 0.10, 0.02, -0.05, 0.08, 0.15]
        let th10 = Math.log(1.1)
        let arr = ohlcFromCloses(v.map((x) => Math.exp(x * th10 / 0.10)))
        let r = pickPeriod(await calcDirChange(arr, 'Close'), '10pct')
        //手算(θ = 0.10): [根, dirState, dirRetrace, dirRun, dirAge]
        //  根2: 0.12 − 最低0 = 0.12 ≥ θ ⇒ 漲, pivot 0, ext 0.12;      根3: 回撤 0.04;   根4: 新高 0.20
        //  根5: 0.20 − 0.09 = 0.11 ≥ θ ⇒ 跌, pivot 0.20, ext 0.09;  根6: 新低 0.03;  根7: 反彈 0.07;  根8: 新低 0.02;  根9: 新低 −0.05
        //  根10: 0.08 − (−0.05) = 0.13 ≥ θ ⇒ 漲, pivot −0.05, ext 0.08;  根11: 新高 0.15
        let exps = [
            [2, 1, 0, 1.2, 0],
            [3, 1, 0.4, 0.8, 1],
            [4, 1, 0, 2.0, 2],
            [5, -1, 0, 1.1, 0],
            [6, -1, 0, 1.7, 1],
            [7, -1, 0.7, 1.0, 2],
            [8, -1, 0, 1.8, 3],
            [9, -1, 0, 2.5, 4],
            [10, 1, 0, 1.3, 0],
            [11, 1, 0, 2.0, 1],
        ]
        assert.strictEqual(r.vs.length, exps.length, '確認前(根0、根1)無值')
        exps.forEach(([i, s, rt, rn, age], k) => {
            let m = r.vs[k]
            assert.strictEqual(m.time, arr[i].time, `第 ${k} 筆對齊根 ${i}`)
            assert.strictEqual(m.dirState, s, `根 ${i} dirState`)
            assertNear(m.dirRetrace, rt, 1e-9, `根 ${i} dirRetrace`)
            assertNear(m.dirRun, rn, 1e-9, `根 ${i} dirRun`)
            assert.strictEqual(m.dirAge, age, `根 ${i} dirAge`)
        })
    })

    it('S2/S3 門檻之等號: 達門檻(≥)即確認; 起始之漲、起始之跌、漲中換跌、跌中換漲皆含等號; 未達者不確認', async function() {
        //θ4 = ln(1 + 4/100); 收盤 1 之對數為 0, 收盤 1 + 4/100 之對數即 θ4 ⇒ 差值恰等於 θ4
        let up = 1 + 4 / 100
        let kp = { '4pct': 4 }
        //起始之漲(根1: lc − 最低 = θ) 後換為跌(根2: ext − lc = θ)
        let r1 = (await calcDirChange(ohlcFromCloses([1, up, 1]), 'Close', { kp }))[0]
        assert.deepStrictEqual(r1.vs.map((m) => [m.dirState, m.dirRetrace, m.dirRun, m.dirAge]), [[1, 0, 1, 0], [-1, 0, 1, 0]])
        //起始之跌(根1: 最高 − lc = θ)
        let r2 = (await calcDirChange(ohlcFromCloses([up, 1]), 'Close', { kp }))[0]
        assert.deepStrictEqual(r2.vs.map((m) => [m.dirState, m.dirRetrace, m.dirRun, m.dirAge]), [[-1, 0, 1, 0]])
        //起始之跌後換為漲(根2: lc − ext = θ; 跌中換漲之等號)
        let r4 = (await calcDirChange(ohlcFromCloses([up, 1, up]), 'Close', { kp }))[0]
        assert.deepStrictEqual(r4.vs.map((m) => [m.dirState, m.dirRetrace, m.dirRun, m.dirAge]), [[-1, 0, 1, 0], [1, 0, 1, 0]])
        //未達門檻: 不確認
        let r3 = (await calcDirChange(ohlcFromCloses([1, 1.0399, 1.0001]), 'Close', { kp }))[0]
        assert.strictEqual(r3.vs.length, 0)
    })

    it('S2~S5 與參考實作逐根相同(震盪與多組隨機漫步, 四個門檻)', async function() {
        let sets = [
            genOhlc(400),
            ohlcFromCloses(walk(600, 11, 0.012)),
            ohlcFromCloses(walk(600, 23, 0.025)),
            ohlcFromCloses(walk(600, 37, 0.04)),
        ]
        for (let [j, arr] of sets.entries()) {
            let cs = valuesOf(arr, 'Close')
            let rrs = await calcDirChange(arr, 'Close')
            for (let [period, pct] of Object.entries(KP)) {
                let ref = refDirChange(cs, pct)
                assert.ok(ref.length > 0, `序列 ${j} ${period} 須有確認`)
                assertSameAsRef(pickPeriod(rrs, period).vs, arr, ref, `序列 ${j} ${period}`)
            }
        }
    })

    it('S5 各欄之性質: dirState 只有 ±1; dirRetrace 於 [0, 1); dirRun > 0 且確認當根 ≥ 1; dirAge 確認當根為 0、其後逐根加 1, 且 dirState 只在 dirAge 為 0 之根改變', async function() {
        let arr = ohlcFromCloses(walk(800, 5, 0.03))
        let rrs = await calcDirChange(arr, 'Close')
        let nSwitch = 0
        for (let r of rrs) {
            assert.ok(r.vs.length > 0, r.period)
            r.vs.forEach((m, k) => {
                assert.ok(m.dirState === 1 || m.dirState === -1, `${r.period} 第 ${k} 筆 dirState`)
                assert.ok(m.dirRetrace >= 0 && m.dirRetrace < 1, `${r.period} 第 ${k} 筆 dirRetrace ${m.dirRetrace}`)
                assert.ok(m.dirRun > 0, `${r.period} 第 ${k} 筆 dirRun ${m.dirRun}`)
                assert.ok(Number.isInteger(m.dirAge) && m.dirAge >= 0, `${r.period} 第 ${k} 筆 dirAge`)
                if (m.dirAge === 0) {
                    assert.ok(m.dirRun >= 1 - 1e-12, `${r.period} 第 ${k} 筆確認當根之 dirRun ${m.dirRun}`)
                    assert.strictEqual(m.dirRetrace, 0, `${r.period} 第 ${k} 筆確認當根之 dirRetrace`)
                }
                if (k > 0) {
                    let p = r.vs[k - 1]
                    if (m.dirAge === 0) {
                        assert.strictEqual(m.dirState, -p.dirState, `${r.period} 第 ${k} 筆換向`)
                        nSwitch++
                    }
                    else {
                        assert.strictEqual(m.dirAge, p.dirAge + 1, `${r.period} 第 ${k} 筆 dirAge 遞增`)
                        assert.strictEqual(m.dirState, p.dirState, `${r.period} 第 ${k} 筆 dirState 不變`)
                    }
                }
            })
            assert.strictEqual(r.vs[0].dirAge, 0, `${r.period} 第 1 筆為第 1 次確認之根`)
        }
        assert.ok(nSwitch > 20, `換向次數 ${nSwitch}`)
    })

    it('S1 因果性: 以第 t 根截斷之序列所得之全部輸出, 與完整序列之前段逐筆相同(含「截斷處之轉折尚未確認」之根)', async function() {
        let arr = ohlcFromCloses(walk(300, 101, 0.03))
        let cs = valuesOf(arr, 'Close')
        let full = await calcDirChange(arr, 'Close')
        //鑑別之前提: 有「位於轉折點之後、確認之前」之根(事後看已屬新方向, 當下仍為舊方向), 回填或偷看其後之實作於此類根會與截斷者不同
        let nBetween = 0
        for (let pct of Object.values(KP)) {
            //各次換向(第 1 次確認以外)之轉折點與確認之根之間之根數
            for (let e of refDirChange(cs, pct).filter((x) => x.dirAge === 0).slice(1)) {
                nBetween += Math.max(0, e.i - e.iPiv - 1)
            }
        }
        assert.ok(nBetween > 10, `前提不成立: 轉折點與確認之間之根數 ${nBetween}, 須換種子`)
        for (let t = 0; t < arr.length; t++) {
            let part = await calcDirChange(arr.slice(0, t + 1), 'Close')
            part.forEach((r, j) => {
                let tEnd = arr[t].time
                let pre = full[j].vs.filter((m) => m.time <= tEnd)
                assert.deepStrictEqual(r.vs, pre, `截斷於根 ${t} 之 ${r.period}`)
            })
        }
    })

    it('門檻越大, 換向次數(含第 1 次確認)不增', async function() {
        let kp = {}
        for (let p = 1; p <= 20; p++) {
            kp[`${p}pct`] = p
        }
        let nCheck = 0
        let nLess = 0
        for (let seed of [3, 7, 19, 41, 77]) {
            let arr = ohlcFromCloses(walk(800, seed, 0.01 + (seed % 5) * 0.01))
            let rrs = await calcDirChange(arr, 'Close', { kp })
            let cnt = rrs.map((r) => r.vs.filter((m) => m.dirAge === 0).length)
            for (let k = 1; k < cnt.length; k++) {
                assert.ok(cnt[k] <= cnt[k - 1], `種子 ${seed}: ${rrs[k - 1].period} ${cnt[k - 1]} 次 → ${rrs[k].period} ${cnt[k]} 次`)
                nCheck++
                if (cnt[k] < cnt[k - 1]) {
                    nLess++
                }
            }
            //內建四門檻同此
            let cnt4 = (await calcDirChange(arr, 'Close')).map((r) => r.vs.filter((m) => m.dirAge === 0).length)
            assert.deepStrictEqual(cnt4, [cnt[3], cnt[5], cnt[7], cnt[9]], `種子 ${seed} 內建表`)
        }
        assert.ok(nLess > 20, `鑑別: 嚴格減少之相鄰門檻對 ${nLess} / ${nCheck}`)
    })

    it('S6 門檻與 K 線週期無關: 給 opt.intervalSec(3600、86400、數字字串、14400、null)時標籤與輸出皆同未給', async function() {
        let arr = ohlcFromCloses(walk(300, 9, 0.03))
        let r0 = await calcDirChange(arr, 'Close')
        for (let iv of [3600, 86400, '86400', 14400, '14400', 60, 31536000, null, undefined]) {
            assert.deepStrictEqual(await calcDirChange(arr, 'Close', { intervalSec: iv }), r0, `intervalSec ${iv}`)
        }
    })

    it('S6 periodInfo 認各期之標籤: 回 0 根 0 秒(bars 等於 len), 與 opt.intervalSec 無關', async function() {
        let arr = ohlcFromCloses(walk(100, 9, 0.03))
        for (let iv of [undefined, 3600, '86400', 604800]) {
            let opt = iv === undefined ? {} : { intervalSec: iv }
            let rrs = await calcDirChange(arr, 'Close', opt)
            assert.deepStrictEqual(rrs.map((v) => v.period), Object.keys(KP))
            rrs.forEach((v) => {
                assert.deepStrictEqual(periodInfo(v.period, opt), { period: v.period, bars: v.len, spanSec: 0 }, `${v.period} intervalSec ${iv}`)
            })
        }
    })

    it('S6 經 dataConvert: 各門檻各 keyOut 一檔, 檔名之期別為 Npct(如 price_ohlc_Close_dirState_dirChange_4pct.json), 內容為各筆之 time 與正規化後之 param', async function() {
        let fd = fileURLToPath(new URL('./_tmp/unit-calcDirChange/', import.meta.url))
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        try {
            let arr = ohlcFromCloses(walk(300, 31, 0.03))
            let keyOuts = ['dirState', 'dirRetrace', 'dirRun', 'dirAge']
            let nms = { dirState: { avg: 0, std: 1 }, dirRetrace: { avg: 0.25, std: 2 }, dirRun: { avg: 1, std: 4 }, dirAge: { avg: 3, std: 5 } }
            let methods = [{ method: 'dirChange', deals: keyOuts.map((keyOut) => ({ keyOut, nm: nms[keyOut] })), optMethod: {} }]
            let kp = { dirChange: calcDirChange }
            let rs = await dataConvert('t', 'SYM', '4hr', 'price', 'ohlc', methods, arr, kp, fd, { keysIn: ['Close'] })
            assert.deepStrictEqual(rs.map((v) => [v.method, v.keyIn, v.keyOut]), keyOuts.map((k) => ['dirChange', 'Close', k]))
            let exp = []
            Object.keys(KP).forEach((p) => {
                keyOuts.forEach((k) => {
                    exp.push(`price_ohlc_Close_${k}_dirChange_${p}.json`)
                })
            })
            assert.deepStrictEqual(fs.readdirSync(fd).sort(), exp.sort())
            let rrs = await calcDirChange(arr, 'Close')
            rrs.forEach((r) => {
                keyOuts.forEach((k) => {
                    let got = JSON.parse(fs.readFileSync(`${fd}price_ohlc_Close_${k}_dirChange_${r.period}.json`, 'utf8'))
                    assert.strictEqual(got.length, r.vs.length, `${r.period} ${k} 筆數`)
                    assert.ok(got.length > 0, `${r.period} ${k} 須有值`)
                    got.forEach((g, i) => {
                        assert.strictEqual(g.time, r.vs[i].time, `${r.period} ${k} 第 ${i} 筆 time`)
                        assertNear(g.param, (r.vs[i][k] - nms[k].avg) / nms[k].std, 1e-12, `${r.period} ${k} 第 ${i} 筆 param`)
                    })
                })
            })
        }
        finally {
            fs.rmSync(fd, { recursive: true, force: true })
            try {
                fs.rmdirSync(fileURLToPath(new URL('./_tmp/', import.meta.url))) //test/_tmp已空時一併移除(非空則保留)
            }
            catch (err) {}
        }
    })

    it('S7 opt.intervalSec 給了而無效 ⇒ reject(訊息同其他 calc、不含輸入值), 先於 opt.kp 與資料之檢核', async function() {
        let arr = genOhlc(50)
        for (let v of [0, -60, 59, 90, 1.5, 31536060, 'abc', '', '60s', NaN, Infinity, true, [], {}]) {
            await assert.rejects(calcDirChange(arr, 'Close', { intervalSec: v }), (e) => e.message === msgIv, `intervalSec ${String(v)}`)
            await assert.rejects(calcDirChange(arr, 'Close', { intervalSec: v, kp: { '5pct': 5 } }), (e) => e.message === msgIv, `intervalSec ${String(v)} 與有效之 opt.kp`)
        }
        //先於資料之檢核
        await assert.rejects(calcDirChange(ohlcFromCloses([100, -1]), 'Close', { intervalSec: 'abc' }), (e) => e.message === msgIv)
    })

    it('S8 opt.kp 原樣採用: 標籤與值原樣、數字字串轉數值; 結果同參考實作', async function() {
        let arr = ohlcFromCloses(walk(400, 13, 0.02))
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcDirChange(arr, 'Close', { kp: { 'th3': 3, '7pct': '7' }, intervalSec: 86400 })
        assert.deepStrictEqual(rrs.map((v) => [v.period, v.len, v.pct]), [['th3', 0, 3], ['7pct', 0, 7]])
        assertSameAsRef(rrs[0].vs, arr, refDirChange(cs, 3), 'th3')
        assertSameAsRef(rrs[1].vs, arr, refDirChange(cs, 7), '7pct')
    })

    it('S8 opt.kp 非預期 ⇒ 視為未給(內建表, 不拋錯); opt.debug 時經 funLog 警告一次(不含輸入值); 值為物件 ⇒ reject', async function() {
        let arr = ohlcFromCloses(walk(200, 17, 0.03))
        let r0 = await calcDirChange(arr, 'Close')
        for (let kp of [{}, { a: 0 }, { a: -4 }, { a: 1.5 }, { a: 'abc' }, { a: 5, b: 0 }, 'x', 4, [4], null]) {
            assert.deepStrictEqual(await calcDirChange(arr, 'Close', { kp }), r0, `kp ${JSON.stringify(kp)}`)
        }
        resetWarned()
        let logs = []
        let funLog = (msg, info) => logs.push({ msg, info })
        await calcDirChange(arr, 'Close', { kp: { a: 'sk-777' }, debug: true, funLog })
        await calcDirChange(arr, 'Close', { kp: { a: 0 }, debug: true, funLog })
        assert.strictEqual(logs.length, 1, '每個行程只警告一次')
        assert.ok(logs[0].msg.startsWith('[w-data-trade resolvePeriods] invalid opt.kp: '), logs[0].msg)
        assert.ok(!logs[0].msg.includes('sk-777'), '警告不含輸入值')
        assert.deepStrictEqual(logs[0].info, { fn: 'resolvePeriods', reason: 'invalid', key: 'opt.kp' })
        resetWarned()
        await assert.rejects(calcDirChange(arr, 'Close', { kp: { a: {} } }), (e) => e.message === 'invalid opt.kp: must be an object of positive integer percentages')
    })

    it('S9 Close 非正之有限數 ⇒ reject(訊息不含輸入值); 任一根無效即拒', async function() {
        for (let bad of [0, -5, NaN, Infinity, -Infinity, '100', null, undefined, true, {}]) {
            let arr = ohlcFromCloses([100, 101, 102])
            arr[1] = { ...arr[1], Close: bad }
            await assert.rejects(calcDirChange(arr, 'Close'), (e) => e.message === msgClose, `Close ${String(bad)}`)
        }
        //元素本身非物件
        await assert.rejects(calcDirChange([null, { time: genTimes(1)[0], Close: 1 }], 'Close'), (e) => e.message === msgClose)
        //無效值在確認之後亦拒(逐根檢核, 非只看前段)
        let arr = ohlcFromCloses([100, 120, 130, 140])
        arr[3] = { ...arr[3], Close: 0 }
        await assert.rejects(calcDirChange(arr, 'Close'), (e) => e.message === msgClose)
    })

    it('S10 資料不足或未曾確認 ⇒ 各門檻 vs 為空陣列(空陣列、1 根、定值、漲跌未達門檻); arr 為 null、undefined、{} 視為無資料, 其餘非陣列值(字串、非空物件)reject', async function() {
        let cases = [[], ohlcFromCloses([100]), genFlat(60, 50), ohlcFromCloses([100, 103.9, 100.1, 103.5])]
        for (let [j, arr] of cases.entries()) {
            let rrs = await calcDirChange(arr, 'Close')
            assert.deepStrictEqual(rrs.map((v) => [v.period, v.vs.length]), Object.keys(KP).map((k) => [k, 0]), `案 ${j}`)
        }
        for (let arr of [null, undefined, {}]) {
            let rrs = await calcDirChange(arr, 'Close')
            assert.deepStrictEqual(rrs.map((v) => v.vs.length), [0, 0, 0, 0])
        }
        //其餘非陣列值(size 大於 0)讀不到有效 Close ⇒ reject(不是無資料)
        for (let bad of ['abc', { a: 1 }, new Map([[1, 2]])]) {
            await assert.rejects(calcDirChange(bad, 'Close'), (e) => e.message === msgClose, `非陣列 ${Object.prototype.toString.call(bad)}`)
        }
        //單調上升: 只確認一次(漲), 其後不換向
        let r = pickPeriod(await calcDirChange(genUp(100), 'Close'), '4pct')
        assert.ok(r.vs.length > 0)
        assert.ok(r.vs.every((m) => m.dirState === 1 && m.dirRetrace === 0))
        assert.strictEqual(r.vs.filter((m) => m.dirAge === 0).length, 1)
    })

    it('S10 key 未使用(固定採 Close); 純函式: 重複呼叫結果一致且不改動輸入', async function() {
        let arr = ohlcFromCloses(walk(200, 29, 0.03))
        let snap = JSON.stringify(arr)
        let r1 = await calcDirChange(arr, 'Close')
        let r2 = await calcDirChange(arr, 'Open')
        let r3 = await calcDirChange(arr, 'Close')
        assert.deepStrictEqual(r2, r1)
        assert.deepStrictEqual(r3, r1)
        assert.strictEqual(JSON.stringify(arr), snap)
    })

})
