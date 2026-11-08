import assert from 'assert'
import { createHash } from 'crypto'
import wdt from '../src/WDataTrade.mjs'
import resolvePeriods from '../src/resolvePeriods.mjs'
import { genOhlc, assertNear } from './unit-setup.mjs'


//規格來源: src/resolvePeriods.mjs 之 JSDoc 與 README〈週期換算〉
//  1. 21個calc(calcOrig除外)之內建週期表以4hr K線為基準(每日6根), 未給opt.barsPerDay(或給6、或給非預期之值)時輸出與1.0.33逐位相同
//  2. opt.barsPerDay給每日根數即等比換算各期根數並四捨五入, 不足1根之期剔除, 週期標籤維持時間語意(1hr K線之'1day'均線取24根)
//  3. 單根型態(calcCandle、calcKlr)只改標籤; 參數物件類(calcKeltner、calcSupertrend、calcIchimoku)只換算根數欄位, 倍數不變
//  4. opt.kp直接採用不換算; 全部週期皆不足1根時以reject告知(calc皆為async, 失敗通道為reject, 不同步throw)
//  5. dataConvert之optMethod、dataCalibrate之optMethodInit/optMethodRef原樣傳入calc, 併入barsPerDay即生效(兩者不改碼)


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

//ICHI, calcIchimoku內建週期表之{tenkan, kijun, senkouB}(1.0.33), 輸出之len為senkouB
let ICHI = {
    '4day': [4, 12, 24],
    '7day': [7, 21, 42],
    '15day': [16, 45, 90],
    '30day': [31, 90, 180],
}

//BARS, 常見每日根數與其單根標籤: 24=1hr, 48=30m, 1=1day, 2=12hr, 4=6hr, 96=15m, 288=5m
let LABEL = { 24: '1hr', 48: '30m', 1: '1day', 2: '12hr', 4: '6hr', 96: '15m', 288: '5m' }
let BARS = [24, 48, 1, 2, 4, 96, 288]

let H1 = 3600 * 1000

//regen, 將合成K線之time改為指定間隔(欄位值不變)
let regen = (arr, stepMs) => {
    return arr.map((v, i) => {
        return { ...v, time: new Date(Date.UTC(2020, 0, 1) + i * stepMs).toISOString().slice(0, 19) }
    })
}

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

//scale, 獨立於實作之換算式(先乘後除, 四捨五入, 不足1根為null)
let scale = (v, b) => {
    let x = (v * b) / 6
    return x < 1 ? null : Math.round(x)
}

//expectShape, 由改動前之週期表推算換算後之period:len清單
let expectShape = (nm, b) => {
    if (nm === 'calcCandle' || nm === 'calcKlr') {
        return [`${LABEL[b]}:1`]
    }
    let r = []
    SNAP[nm].kp.forEach((s) => {
        let [p, len] = s.split(':')
        if (nm === 'calcIchimoku') {
            let ts = ICHI[p].map((v) => scale(v, b))
            if (ts.some((v) => v === null)) {
                return
            }
            r.push(`${p}:${ts[2]}`)
            return
        }
        let l = scale(Number(len), b)
        if (l !== null) {
            r.push(`${p}:${l}`)
        }
    })
    return r
}


describe('各calc之週期表換算(opt.barsPerDay / opt.kp)', function() {

    it('聚合匯出含resolvePeriods', function() {
        assert.strictEqual(wdt.resolvePeriods, resolvePeriods)
    })

    describe('恆等: 未給barsPerDay(或給6、非預期值)時輸出與1.0.33逐位相同', function() {

        let arr = genOhlc(1200)
        let opts = [
            undefined,
            {},
            { barsPerDay: 6 },
            { barsPerDay: '6' },
            { barsPerDay: undefined, kp: undefined },
            { barsPerDay: 0 },
            { barsPerDay: 'abc' },
            { kp: {} },
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

    describe('換算: 手算對照(calcMa、calcMacd)', function() {

        let arr = genOhlc(30)

        //calcMa內建: 1day:6 2day:12 4day:24 7day:42 15day:90 30day:180
        let ma = {
            24: ['1day:24', '2day:48', '4day:96', '7day:168', '15day:360', '30day:720'],
            48: ['1day:48', '2day:96', '4day:192', '7day:336', '15day:720', '30day:1440'],
            1: ['1day:1', '2day:2', '4day:4', '7day:7', '15day:15', '30day:30'],
            2: ['1day:2', '2day:4', '4day:8', '7day:14', '15day:30', '30day:60'],
            4: ['1day:4', '2day:8', '4day:16', '7day:28', '15day:60', '30day:120'],
            96: ['1day:96', '2day:192', '4day:384', '7day:672', '15day:1440', '30day:2880'],
            288: ['1day:288', '2day:576', '4day:1152', '7day:2016', '15day:4320', '30day:8640'],
        }

        //calcMacd內建: 4hr:1 8hr:2 12hr:3 16hr:4 20hr:5 1day:6 (值為倍率)
        let macd = {
            24: ['4hr:4', '8hr:8', '12hr:12', '16hr:16', '20hr:20', '1day:24'],
            48: ['4hr:8', '8hr:16', '12hr:24', '16hr:32', '20hr:40', '1day:48'],
            1: ['1day:1'],
            2: ['12hr:1', '16hr:1', '20hr:2', '1day:2'],
            4: ['8hr:1', '12hr:2', '16hr:3', '20hr:3', '1day:4'],
            96: ['4hr:16', '8hr:32', '12hr:48', '16hr:64', '20hr:80', '1day:96'],
            288: ['4hr:48', '8hr:96', '12hr:144', '16hr:192', '20hr:240', '1day:288'],
        }

        BARS.forEach((b) => {
            it(`barsPerDay ${b}: calcMa與calcMacd之週期表`, async function() {
                //規格2
                assert.deepStrictEqual(shapeOf(await wdt.calcMa(arr, 'Close', { barsPerDay: b })), ma[b], 'calcMa')
                assert.deepStrictEqual(shapeOf(await wdt.calcMacd(arr, 'Close', { barsPerDay: b })), macd[b], 'calcMacd')
            })
        })

    })

    describe('換算: 21個calc依規則推算之週期表', function() {

        let arr = genOhlc(30)

        names.forEach((nm) => {
            BARS.forEach((b) => {
                it(`${nm} barsPerDay ${b}`, async function() {
                    //規格2, 3
                    let rrs = await call(nm, arr, { barsPerDay: b })
                    assert.deepStrictEqual(shapeOf(rrs), expectShape(nm, b))
                    rrs.forEach((v) => {
                        assert.ok(Array.isArray(v.vs))
                    })
                })
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
            it(`${nm}: 採用opt.kp且不換算(同時給barsPerDay亦然)`, async function() {
                //規格4
                assert.deepStrictEqual(shapeOf(await call(nm, arr, { kp: kpFor(nm) })), expKp(nm))
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

    describe('全部週期皆不足1根: 以reject告知(不同步throw)', function() {

        let arr = genOhlc(60)

        names.forEach((nm) => {
            if (nm === 'calcCandle' || nm === 'calcKlr') {
                it(`${nm}: 單根型態不剔除, 只改標籤(barsPerDay 0.01 => 100day)`, async function() {
                    let rrs = await call(nm, arr, { barsPerDay: 0.01 })
                    assert.deepStrictEqual(shapeOf(rrs), ['100day:1'])
                })
                return
            }
            it(`${nm}: barsPerDay 0.01 時reject`, async function() {
                //規格4: 失敗通道為reject, 訊息不含傳入之值
                let p
                assert.doesNotThrow(() => {
                    p = call(nm, arr, { barsPerDay: 0.01 })
                })
                await assert.rejects(p, (err) => {
                    assert.strictEqual(err.message, 'invalid opt.barsPerDay: must keep at least one period of at least 1 bar')
                    return true
                })
            })
        })

    })

    describe('1hr K線(barsPerDay 24)之時間語意', function() {

        it('calcMa: 1day均線取24根(以脈衝序列驗窗寬), 預設(4hr基準)則取6根', async function() {
            //規格2: 24根脈衝使窗內含脈衝者恰24個窗
            let arr = regen(genOhlc(200), H1).map((v) => ({ ...v, Close: 0 }))
            arr[100].Close = 24
            let rs = await wdt.calcMa(arr, 'Close', { barsPerDay: 24 })
            let r1 = rs.find((v) => v.period === '1day')
            assert.strictEqual(r1.len, 24)
            let nz = r1.vs.filter((v) => v.param !== 0)
            assert.strictEqual(nz.length, 24)
            assert.ok(nz.every((v) => v.param === 1))
            //窗最後一根為脈衝(idx100)時為第一個非零, 窗第一根為脈衝時為最後一個非零
            assert.strictEqual(nz[0].time, arr[100].time)
            assert.strictEqual(nz[nz.length - 1].time, arr[123].time)
            //2day: 48個窗, 值0.5
            let r2 = rs.find((v) => v.period === '2day')
            let nz2 = r2.vs.filter((v) => v.param !== 0)
            assert.strictEqual(nz2.length, 48)
            assert.ok(nz2.every((v) => v.param === 0.5))
            //對照: 預設只取6根
            let rd = await wdt.calcMa(arr, 'Close')
            let nzd = rd.find((v) => v.period === '1day').vs.filter((v) => v.param !== 0)
            assert.strictEqual(nzd.length, 6)
        })

        it('calcMa: 斜坡序列之1day首筆為前24根均值且對齊第24根', async function() {
            let arr = regen(genOhlc(200), H1).map((v, i) => ({ ...v, Close: i }))
            let r1 = (await wdt.calcMa(arr, 'Close', { barsPerDay: 24 })).find((v) => v.period === '1day')
            assert.strictEqual(r1.vs.length, 200 - 23)
            assert.strictEqual(r1.vs[0].param, 11.5) //mean(0..23)
            assert.strictEqual(r1.vs[0].time, arr[23].time)
        })

        it('calcMa: 恆定序列各期均線恆等於該常數, 筆數為n-len+1', async function() {
            let arr = regen(genOhlc(200), H1).map((v) => ({ ...v, Close: 50 }))
            let rs = await wdt.calcMa(arr, 'Close', { barsPerDay: 24 })
            assert.deepStrictEqual(shapeOf(rs), ['1day:24', '2day:48', '4day:96', '7day:168', '15day:360', '30day:720'])
            rs.forEach((r) => {
                assert.strictEqual(r.vs.length, Math.max(0, 200 - r.len + 1), r.period)
                assert.ok(r.vs.every((v) => v.param === 50), r.period)
            })
        })

        it('calcMa: 4hr序列每根重複4次成1hr序列, 1hr(24根/日)之各期均線於區塊末端等於4hr均線(同一段時間)', async function() {
            let a4 = genOhlc(120)
            let a1 = []
            a4.forEach((v) => {
                for (let k = 0; k < 4; k++) {
                    a1.push({ ...v })
                }
            })
            a1 = regen(a1, H1)
            let r4 = await wdt.calcMa(a4, 'Close')
            let r1 = await wdt.calcMa(a1, 'Close', { barsPerDay: 24 })
            assert.deepStrictEqual(r1.map((v) => v.period), r4.map((v) => v.period))
            let nCmp = 0
            r4.forEach((p4, i) => {
                let p1 = r1[i]
                assert.strictEqual(p1.len, p4.len * 4, p4.period)
                if (p4.vs.length === 0) {
                    assert.strictEqual(p1.vs.length, 0, p4.period)
                    return
                }
                assert.strictEqual(p1.vs.length, 4 * p4.vs.length - 3, p4.period)
                p4.vs.forEach((v4, j) => {
                    assertNear(p1.vs[4 * j].param, v4.param, 1e-9, `${p4.period}[${j}]`)
                    nCmp++
                })
            })
            assert.ok(nCmp > 100)
        })

        it('calcMacd: 倍率換算維持時間語意(4hr K線len=1 => 1hr K線len=4, 快慢訊號線期數同倍), 起算位置依換算後len', async function() {
            let arr = regen(genOhlc(400), H1)
            let rs = await wdt.calcMacd(arr, 'Close', { barsPerDay: 24 })
            let r4 = rs.find((v) => v.period === '4hr')
            let r8 = rs.find((v) => v.period === '8hr')
            assert.strictEqual(r4.len, 4)
            assert.strictEqual(r8.len, 8)
            //各期第1筆對應輸入第35*len-2根
            assert.strictEqual(r4.vs.length, 400 - (35 * 4 - 2))
            assert.strictEqual(r4.vs[0].time, arr[35 * 4 - 2].time)
            assert.strictEqual(r8.vs.length, 400 - (35 * 8 - 2))
            assert.strictEqual(r8.vs[0].time, arr[35 * 8 - 2].time)
            //預設(4hr基準)同一標籤之len為1
            let rd = (await wdt.calcMacd(arr, 'Close')).find((v) => v.period === '4hr')
            assert.strictEqual(rd.len, 1)
        })

        it('calcKeltner/calcSupertrend/calcIchimoku: 只換算根數欄位, 與直接以換算後參數給opt.kp之結果相同', async function() {
            //規格3
            let arr = regen(genOhlc(600), H1)
            let kc = await wdt.calcKeltner(arr, 'Close', { barsPerDay: 24 })
            let kc2 = await wdt.calcKeltner(arr, 'Close', { kp: { '1day': { len: 24, mult: 2 } } })
            assert.deepStrictEqual(kc.find((v) => v.period === '1day'), kc2[0])
            assert.ok(kc2[0].vs.length > 0)

            let st = await wdt.calcSupertrend(arr, 'Close', { barsPerDay: 24 })
            let st2 = await wdt.calcSupertrend(arr, 'Close', { kp: { '1day': { len: 24, mult: 3 } } })
            assert.deepStrictEqual(st.find((v) => v.period === '1day'), st2[0])
            assert.ok(st2[0].vs.length > 0)

            let ic = await wdt.calcIchimoku(arr, 'Close', { barsPerDay: 24 })
            let ic2 = await wdt.calcIchimoku(arr, 'Close', { kp: { '4day': { tenkan: 16, kijun: 48, senkouB: 96 } } })
            assert.deepStrictEqual(ic.find((v) => v.period === '4day'), ic2[0])
            assert.ok(ic2[0].vs.length > 0)
        })

        it('calcCandle/calcKlr: 單期標籤為1hr, len為1, 值同預設(逐根比值與週期無關)', async function() {
            let arr = regen(genOhlc(100), H1)
            for (let nm of ['calcCandle', 'calcKlr']) {
                let r = await call(nm, arr, { barsPerDay: 24 })
                let rd = await call(nm, arr)
                assert.deepStrictEqual(shapeOf(r), ['1hr:1'], nm)
                assert.deepStrictEqual(r[0].vs, rd[0].vs, nm)
            }
        })

    })

    describe('日K線(barsPerDay 1)與撞根數', function() {

        let arr = genOhlc(100)

        it('日K線: 不足一日之期剔除', async function() {
            assert.deepStrictEqual(shapeOf(await wdt.calcRsi(arr, 'Close', { barsPerDay: 1 })), ['1day:1', '2day:2', '4day:4', '7day:7'])
            assert.deepStrictEqual(shapeOf(await wdt.calcMacd(arr, 'Close', { barsPerDay: 1 })), ['1day:1'])
            assert.deepStrictEqual(shapeOf(await wdt.calcCandle(arr, 'Close', { barsPerDay: 1 })), ['1day:1'])
        })

        it('相鄰週期四捨五入後同根數: 保留不去重, 標籤維持時間語意', async function() {
            //規格6: 12hr K線(2根/日)之'12hr'與'16hr'皆為1根
            let rs = await wdt.calcRsi(arr, 'Close', { barsPerDay: 2 })
            assert.deepStrictEqual(shapeOf(rs), ['12hr:1', '16hr:1', '20hr:2', '1day:2', '2day:4', '4day:8', '7day:14'])
            //6hr K線(4根/日)之'16hr'與'20hr'皆為3根
            assert.deepStrictEqual(shapeOf(await wdt.calcMacd(arr, 'Close', { barsPerDay: 4 })), ['8hr:1', '12hr:2', '16hr:3', '20hr:3', '1day:4'])
        })

    })

    describe('dataConvert / dataCalibrate 經optMethod透傳(兩者不改碼)', function() {

        let arr = regen(genOhlc(600), H1)

        it('dataConvert: methods[i].optMethod併入barsPerDay即傳入calc並生效', async function() {
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
                return wdt.dataConvert('t', 'SYM', '1hr', 'price', 'ohlc', methods, arr, kp, 'unused', { denyOutput: true, keysIn: ['Close'] })
            }
            let r24 = (await run({ barsPerDay: 24 }))[0]
            let r6 = (await run({}))[0]
            assert.strictEqual(seen[0].barsPerDay, 24)
            assert.strictEqual(seen[1].barsPerDay, undefined)

            //期望值: 直接對calcMa(barsPerDay 24)之全期param彙整
            let rrs = await wdt.calcMa(arr, 'Close', { barsPerDay: 24 })
            let ps = rrs.flatMap((v) => v.vs.map((m) => m.param))
            assert.strictEqual(r24.min, Math.min(...ps))
            assert.strictEqual(r24.max, Math.max(...ps))
            assertNear(r24.avg, ps.reduce((a, b) => a + b, 0) / ps.length, 1e-9)

            //確實生效: 與未併入時之統計不同
            assert.notStrictEqual(r24.avg, r6.avg)
        })

        it('dataCalibrate: optMethodInit/optMethodRef併入barsPerDay, 以opt.params排除後每次呼叫calcFn皆帶barsPerDay', async function() {
            let seen = []
            let calcFn = async (a, keyIn, om) => {
                seen.push({ ...om })
                return wdt.calcMa(a, 'Close', om)
            }
            let rs = await wdt.dataCalibrate(calcFn, arr, arr, ['param'], { barsPerDay: 24, norm: 0 }, { params: ['norm'], optMethodRef: { barsPerDay: 24 } })
            assert.ok(seen.length > 5)
            assert.ok(seen.every((om) => om.barsPerDay === 24))
            assert.strictEqual(rs.optMethod.barsPerDay, 24)
            assert.strictEqual(rs.optMethodBest.barsPerDay, 24)
        })

        it('dataCalibrate: 未給opt.params時預設搜尋optMethodInit全部鍵(含barsPerDay); 未給optMethodRef時參考側不帶barsPerDay', async function() {
            //限制之釘住: 須以opt.params排除barsPerDay, 並於optMethodRef另給
            let seen = []
            let calcFn = async (a, keyIn, om) => {
                seen.push({ ...om })
                return wdt.calcMa(a, 'Close', om)
            }
            await wdt.dataCalibrate(calcFn, arr, arr, ['param'], { barsPerDay: 24 })
            assert.strictEqual(seen[0].barsPerDay, undefined) //參考側
            let vals = new Set(seen.map((om) => om.barsPerDay))
            assert.ok(vals.size > 2, '搜尋過程中barsPerDay被當成搜尋參數而變動')
        })

    })

})
