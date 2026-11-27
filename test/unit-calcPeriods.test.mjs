import assert from 'assert'
import { createHash } from 'crypto'
import wdt from '../src/WDataTrade.mjs'
import resolvePeriods from '../src/resolvePeriods.mjs'
import { genOhlc, assertNear } from './unit-setup.mjs'


//規格來源: src/resolvePeriods.mjs 之 JSDoc 與 README〈opt.intervalSec〉
//  1. 21個calc(calcOrig除外)之內建週期表之標籤以每根4hr寫定: 未給opt.intervalSec(或給14400)時輸出與1.0.33逐位相同; 已移除之opt.barsPerDay視為未知鍵而忽略(輸出同未給)
//  2. 給opt.intervalSec時各期根數不變, len與vs與未給時逐筆相同, 只有period(標籤 = 根數 × 每根秒數)不同
//  4. opt.kp直接採用(標籤與值皆原樣), 同時給intervalSec亦不換算
//  5. dataConvert之optMethod、dataCalibrate之optMethodInit/optMethodRef原樣傳入calc, 併入intervalSec即生效


//SNAP, 改動前(1.0.33)之快照: 各calc對genOhlc(1200)以key='Close'、不給opt之輸出的sha256(JSON.stringify)與內建週期表(period:len)
//重產: 以npm pack w-data-trade@1.0.33取得1.0.33, 對同一合成序列計算; 不得以現行程式碼重產
let SNAP = {
    calcAdx: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '8c17d07cfd4a346362790a9538aa3b8ffa32c7768f9086c85cbf9f42b6575596',
    },
    calcAtr: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42'],
        sha256: '2846ad8f9ddd8c2c9fe098fe5ff8dffbb7a6b021ef85d5519b0f6f30d94ec663',
    },
    calcAts: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '22a5b52c8193afdc955be7cef958ad971e84b103888a979eccc481cc63acfe90',
    },
    calcBbpb: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: 'f1d75d0c6d7edc33553a7699380e2244c91589a39bf5d3be58ae591b450a9e0d',
    },
    calcCandle: {
        kp: ['4hr:1'],
        sha256: '8f7d5b6bbc5497ddd30686fa5912a55add910a0843400b01457d6a7eee6f4c33',
    },
    calcCvd: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '1c918200b1ddce9bc9227be7c9b557ee6094541d3b975f48667e986d279d65df',
    },
    calcDonchian: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '7c57835839c7ee08ce75c5b18fd56ec4abdddb9949afb33f9dce237595a94891',
    },
    calcEma: {
        kp: ['1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: 'b1484d032597a1ccfd3485174e2fdb30b4e2823978d216871593f1897d198298',
    },
    calcIchimoku: {
        kp: ['4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '2fee50a608601a45aa0e3c6c571800c9696ed04b8583e0656925c2b95f1dbed3',
    },
    calcKdj: {
        kp: ['1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '7e3981722f9852eb34637a989b04a1c7ec3136adea37d3015c845aa5af7bdb68',
    },
    calcKeltner: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: 'd1daa49a0418a2e9027dfbda9f45decd55608d44fd7b84904b509f9ecad38657',
    },
    calcKlr: {
        kp: ['4hr:1'],
        sha256: 'f528ab89ead3ce35c5e137d8f7c3575f3e756385deec34992e579e8b3117b35b',
    },
    calcMa: {
        kp: ['1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: 'a95116c1c799efa55768c09999c5b98509801545b35febba3631ae038cb24bbe',
    },
    calcMacd: {
        kp: ['4hr:1', '8hr:2', '12hr:3', '16hr:4', '20hr:5', '1day:6'],
        sha256: '09aa0f85146a7a9e519c0ee62d9ceac98613c875940f89874d0ea43599bf9916',
    },
    calcMfi: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42'],
        sha256: 'a2c2824c05e0a1d61803bde102042c3e8c41f218e43f64060cd6a7a3160646fa',
    },
    calcObv: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '970ffa2b12f6eaac51a06142bd9902ab21f80fee0f1285e1d0d2bb17ad0a7e77',
    },
    calcRsi: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42'],
        sha256: '1adb4dfd94679258dc6606aaed5485191ff5e120693b3cc1ac6cab66fadd73e6',
    },
    calcSupertrend: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '326ba8673cd7622a790fd28e94fb8b0accaeb0a083e512af8162f07625c9598e',
    },
    calcVec: {
        kp: ['4hr:1', '8hr:2', '12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '251e4906f4cca2fcb51bee32a1ed716628e54f700964a63b6eb92dfbe1df4ac0',
    },
    calcVortex: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42'],
        sha256: 'ba163b8f70bfc8c4f5a682ff37193efc8a8e14558ef863195bc24268868a4099',
    },
    calcVwap: {
        kp: ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42', '15day:90', '30day:180'],
        sha256: '550ae92caabf8eca991e92d30198ca6ce59af837b143c86bd84bbc85881c8b42',
    },
}
let names = Object.keys(SNAP)

let shapeOf = (rrs) => {
    return rrs.map((v) => `${v.period}:${v.len}`)
}

let sha = (rrs) => {
    return createHash('sha256').update(JSON.stringify(rrs)).digest('hex')
}

let call = (nm, arr, opt) => {
    let fn = wdt[nm]
    return opt === undefined ? fn(arr, 'Close') : fn(arr, 'Close', opt)
}


describe('各calc之週期表(opt.intervalSec / opt.kp)', function() {

    it('聚合匯出含resolvePeriods與periodInfo', function() {
        assert.strictEqual(wdt.resolvePeriods, resolvePeriods)
        assert.strictEqual(typeof wdt.periodInfo, 'function')
    })

    describe('恆等: 未給intervalSec(或為14400)時輸出與1.0.33逐位相同; 已移除之barsPerDay視為未知鍵而忽略', function() {

        let arr = genOhlc(1200)
        let opts = [
            undefined,
            {},
            { kp: undefined },
            { kp: {} },
            { intervalSec: 14400 }, //根數為本之每根4hr: 標籤與根數皆同內建表
            { intervalSec: '14400' },
            { intervalSec: null },
            { intervalSec: undefined },
            //已移除之barsPerDay: 任何值皆視為未知鍵, 輸出同未給(含曾為有效換算值、曾與intervalSec矛盾之值、非預期之值)
            { barsPerDay: 6 },
            { barsPerDay: '6' },
            { barsPerDay: 24 },
            { barsPerDay: 1 },
            { barsPerDay: 0.01 },
            { barsPerDay: '24' },
            { barsPerDay: 0 },
            { barsPerDay: 'abc' },
            { barsPerDay: undefined, kp: undefined },
            { intervalSec: 14400, barsPerDay: 6 },
            { intervalSec: 14400, barsPerDay: 1 },
            { intervalSec: '14400', barsPerDay: 24 },
        ]

        names.forEach((nm) => {
            it(`${nm}: 週期表與輸出sha256皆同改動前快照`, async function() {
                //規格1
                for (let i = 0; i < opts.length; i++) {
                    let rrs = await call(nm, arr, opts[i])
                    assert.deepStrictEqual(shapeOf(rrs), SNAP[nm].kp, `opts[${i}] 週期表`)
                    assert.strictEqual(sha(rrs), SNAP[nm].sha256, `opts[${i}] 輸出`)
                }
            })
        })

    })

    describe('給intervalSec: len與vs與未給逐筆相同, 只有period不同(sha256比對)', function() {

        let arr = genOhlc(1200)

        names.forEach((nm) => {
            it(`${nm}: intervalSec 3600/86400 之len與vs同快照, period為根數×每根秒數`, async function() {
                //規格2
                for (let iv of [3600, 86400]) {
                    let rrs = await call(nm, arr, { intervalSec: iv })
                    let lens = SNAP[nm].kp.map((s) => Number(s.split(':')[1]))
                    assert.deepStrictEqual(rrs.map((v) => v.len), lens, `intervalSec ${iv} len`)
                    //period以外之欄位(len、vs)還原為未給時之period後, 輸出同快照
                    let base = rrs.map((v, i) => ({ ...v, period: SNAP[nm].kp[i].split(':')[0] }))
                    assert.strictEqual(sha(base), SNAP[nm].sha256, `intervalSec ${iv} 輸出(period以外)`)
                    //period確實不同(每根1day時全部不同於內建標籤)
                    if (iv === 86400) {
                        rrs.forEach((v, i) => {
                            assert.notStrictEqual(v.period, SNAP[nm].kp[i].split(':')[0], `${v.period}`)
                        })
                    }
                }
            })
        })

    })

    describe('opt.kp 直接採用', function() {

        let arr = genOhlc(200)

        //各calc之週期表值型態不同: 數值、{len,mult}、{tenkan,kijun,senkouB}、單根
        let kpFor = (nm) => {
            if (nm === 'calcKeltner' || nm === 'calcSupertrend') {
                return { '3day': { len: 18, mult: 2 }, '5day': { len: 30, mult: 2.5 } }
            }
            if (nm === 'calcIchimoku') {
                return { '3day': { tenkan: 9, kijun: 26, senkouB: 52 } }
            }
            if (nm === 'calcCandle' || nm === 'calcKlr') {
                return { '3hr': 1 }
            }
            return { '3day': 18, '5day': 30 }
        }
        let expKp = (nm) => {
            if (nm === 'calcKeltner' || nm === 'calcSupertrend') {
                return ['3day:18', '5day:30']
            }
            if (nm === 'calcIchimoku') {
                return ['3day:52']
            }
            if (nm === 'calcCandle' || nm === 'calcKlr') {
                return ['3hr:1']
            }
            return ['3day:18', '5day:30']
        }

        names.forEach((nm) => {
            it(`${nm}: 採用opt.kp且標籤與值皆原樣(同時給intervalSec或barsPerDay亦然)`, async function() {
                //規格4
                assert.deepStrictEqual(shapeOf(await call(nm, arr, { kp: kpFor(nm) })), expKp(nm))
                assert.deepStrictEqual(shapeOf(await call(nm, arr, { kp: kpFor(nm), intervalSec: 86400 })), expKp(nm))
                assert.deepStrictEqual(shapeOf(await call(nm, arr, { kp: kpFor(nm), barsPerDay: 24 })), expKp(nm))
            })
        })

        it('採用opt.kp之calcMa結果同直接以該根數計算之均線', async function() {
            let rs = await wdt.calcMa(arr, 'Close', { kp: { '3day': 18 } })
            let vs = rs[0].vs
            let cs = arr.map((v) => v.Close)
            assert.strictEqual(vs.length, 200 - 17)
            assertNear(vs[0].param, cs.slice(0, 18).reduce((a, b) => a + b, 0) / 18)
            assert.strictEqual(vs[0].time, arr[17].time)
        })

    })

    describe('dataConvert / dataCalibrate 經optMethod透傳intervalSec', function() {

        let arr = genOhlc(600)

        it('dataConvert: methods[i].optMethod之intervalSec傳入calc, 輸出之統計與直接以calc計算者相同(根數不變)', async function() {
            //規格5
            let seen = []
            let kp = {
                ma: async (a, keyIn, optMethod) => {
                    seen.push(optMethod)
                    return wdt.calcMa(a, keyIn, optMethod)
                },
            }
            let run = (optMethod) => {
                let methods = [{ method: 'ma', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod }]
                return wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, arr, kp, 'unused', { denyOutput: true, keysIn: ['Close'] })
            }
            let r1 = (await run({ intervalSec: 86400 }))[0]
            let r4 = (await run({}))[0]
            assert.strictEqual(seen[0].intervalSec, 86400)
            assert.strictEqual(seen[1].intervalSec, undefined)

            //期望值: 直接對calcMa(intervalSec 86400)之全期param彙整
            let rrs = await wdt.calcMa(arr, 'Close', { intervalSec: 86400 })
            let ps = rrs.flatMap((v) => v.vs.map((m) => m.param))
            assert.strictEqual(r1.min, Math.min(...ps))
            assert.strictEqual(r1.max, Math.max(...ps))
            assertNear(r1.avg, ps.reduce((a, b) => a + b, 0) / ps.length, 1e-9)

            //根數不變: 統計同未給時(只有標籤不同; 回傳列之periods各元素帶期別標籤, 故比對時去除各期之period)
            let noLabel = (r) => ({ ...r, periods: r.periods.map(({ period, ...o }) => o) })
            assert.deepStrictEqual(noLabel(r1), noLabel(r4))
            assert.deepStrictEqual(r1.periods.map((v) => v.period), ['6day', '12day', '24day', '42day', '90day', '180day'])
            assert.deepStrictEqual(r4.periods.map((v) => v.period), ['1day', '2day', '4day', '7day', '15day', '30day'])
        })

        it('dataCalibrate: 未給opt.params時預設搜尋optMethodInit全部鍵(含intervalSec); 未給optMethodRef時參考側不帶intervalSec', async function() {
            //限制之釘住: intervalSec為固定之每根時長而非校正參數, 須以opt.params排除, 並於optMethodRef另給
            let seen = []
            let calcFn = async (a, keyIn, om) => {
                seen.push({ ...om })
                return wdt.calcMa(a, 'Close', om)
            }
            await wdt.dataCalibrate(calcFn, arr, arr, ['param'], { intervalSec: 86400 })
            assert.strictEqual(seen[0].intervalSec, undefined) //參考側
            let vals = new Set(seen.map((om) => om.intervalSec))
            assert.ok(vals.size > 2, '搜尋過程中intervalSec被當成搜尋參數而變動')
        })

    })

})
