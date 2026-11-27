import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import wdt from '../src/WDataTrade.mjs'
import * as rp from '../src/resolvePeriods.mjs'
import { genOhlc, assertNear } from './unit-setup.mjs'


//規格來源: src/resolvePeriods.mjs(resolvePeriods、spanLabelOf、spanSecOf、chkIntervalSec)與src/periodInfo.mjs之JSDoc、README〈每根時長 opt.intervalSec(根數為本)〉
//  S1. 給opt.intervalSec(每根秒數)時, 各期之值(根數)不變, 輸出之len與vs與不給時逐筆相同; 期別標籤 = 根數 × 每根秒數之時間跨度
//  S2. 標籤規則: 秒數為整日數者為Nday, 否則整小時數者為Nhr, 否則整分鐘數者為Nm; 每根4hr時逐一重現內建表之全部標籤; 同一每根時長下不得兩期同名; 非60之正整數倍throw
//  S3. 未給opt.intervalSec時與既有輸出完全相同(另見unit-calcPeriods〈恆等〉之1.0.33快照)
//  S4. opt.intervalSec無效(非60之正整數倍、超過31536000、非數值)時calc以reject、resolvePeriods與periodInfo以throw告知, 訊息不含傳入之值
//  S5. 已移除之opt.barsPerDay視為未知鍵而忽略: 不換算、不檢核、不警告、與intervalSec併給亦不影響(輸出同只給intervalSec或未給)
//  S6. opt.kp給予時標籤與值皆原樣採用(同時給opt.intervalSec亦然)
//  S7. periodInfo(period, { intervalSec })回傳{ period, bars, spanSec }: bars等於該期輸出之len, spanSec = bars × 每根秒數; 'none'與`${N}pct`(N為正整數、無前導零; calcDirChange之門檻標籤)為0根0秒(不隨intervalSec改變); 其餘寫法(0pct、前導零、小數、大小寫、空白等)throw
//  S8. dataConvert經methods[i].optMethod傳入intervalSec時, 輸出檔名之期別即換算後之標籤, 內容與不給時同根數之期相同
//  S9. dataConvert/dataCalibrate之入口檢核先於任何計算與寫檔(檢測先於副作用, dspec V17): methods各元素(非物件、method不在kp、deals無效、deal.keyOut與deal.nm無效)與各method之intervalSec任一無效即reject且輸出夾為空、calc與funAddKeysIn未被呼叫; 既有訊息字面不變; 各method之intervalSec不一致時訊息為invalid methods[i].optMethod.intervalSec: must be the same in every method(i為第一個不一致者之索引, dspec V19)


//LENS, 各calc內建週期表之根數(輸出之len, 依鍵序; calcIchimoku為senkouB, calcMacd為倍率)
let LENS = {
    calcAdx: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcAtr: [3, 4, 5, 6, 12, 24, 42],
    calcAts: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcBbpb: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcCandle: [1],
    calcCvd: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcDonchian: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcDown: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcEma: [6, 12, 24, 42, 90, 180],
    calcFlow: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcIchimoku: [24, 42, 90, 180],
    calcKdj: [6, 12, 24, 42, 90, 180],
    calcKeltner: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcKlr: [1],
    calcMa: [6, 12, 24, 42, 90, 180],
    calcMacd: [1, 2, 3, 4, 5, 6],
    calcMfi: [3, 4, 5, 6, 12, 24, 42],
    calcMomz: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcObv: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcRsi: [3, 4, 5, 6, 12, 24, 42],
    calcSupertrend: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcVec: [1, 2, 3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcVolx: [3, 4, 5, 6, 12, 24, 42, 90, 180],
    calcVortex: [3, 4, 5, 6, 12, 24, 42],
    calcVwap: [3, 4, 5, 6, 12, 24, 42, 90, 180],
}
let names = Object.keys(LENS)

//LABELS, 各每根秒數下「根數 → 期別標籤」之手寫對照(規格S2)
let LABELS = {
    //4hr: 須逐一重現內建表之現行標籤
    14400: { 1: '4hr', 2: '8hr', 3: '12hr', 4: '16hr', 5: '20hr', 6: '1day', 12: '2day', 24: '4day', 42: '7day', 90: '15day', 180: '30day' },
    //1day: 4hr標籤之6倍時間
    86400: { 1: '1day', 2: '2day', 3: '3day', 4: '4day', 5: '5day', 6: '6day', 12: '12day', 24: '24day', 42: '42day', 90: '90day', 180: '180day' },
    //1hr: 非整日者用hr
    3600: { 1: '1hr', 2: '2hr', 3: '3hr', 4: '4hr', 5: '5hr', 6: '6hr', 12: '12hr', 24: '1day', 42: '42hr', 90: '90hr', 180: '180hr' },
    //15m: 非整小時者用m
    900: { 1: '15m', 2: '30m', 3: '45m', 4: '1hr', 5: '75m', 6: '90m', 12: '3hr', 24: '6hr', 42: '630m', 90: '1350m', 180: '45hr' },
    //12hr
    43200: { 1: '12hr', 2: '1day', 3: '36hr', 4: '2day', 5: '60hr', 6: '3day', 12: '6day', 24: '12day', 42: '21day', 90: '45day', 180: '90day' },
    //1m
    60: { 1: '1m', 2: '2m', 3: '3m', 4: '4m', 5: '5m', 6: '6m', 12: '12m', 24: '24m', 42: '42m', 90: '90m', 180: '3hr' },
    //1週
    604800: { 1: '7day', 2: '14day', 3: '21day', 4: '28day', 5: '35day', 6: '42day', 12: '84day', 24: '168day', 42: '294day', 90: '630day', 180: '1260day' },
}
let IVS = Object.keys(LABELS).map(Number)

//IVS_MORE, 檢查標籤唯一性與periodInfo所用之更多每根秒數(含上下限)
let IVS_MORE = [60, 120, 180, 300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 86400, 172800, 259200, 604800, 2592000, 31536000]

let shapeOf = (rrs) => {
    return rrs.map((v) => `${v.period}:${v.len}`)
}

let call = (nm, arr, opt) => {
    return opt === undefined ? wdt[nm](arr, 'Close') : wdt[nm](arr, 'Close', opt)
}

let MSG_ISEC = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
let MSG_MISMATCH = (i) => `invalid methods[${i}].optMethod.intervalSec: must be the same in every method`
let MSG_PERIOD = `invalid period: must be 'none' or a period label whose time span is a multiple of opt.intervalSec`


describe('opt.intervalSec(根數為本: 根數不變、期別標籤依根數×每根時長換算)', function() {

    let arr = genOhlc(400)

    it('聚合匯出含periodInfo; resolvePeriods具名匯出標籤規則函數與常數', function() {
        assert.strictEqual(typeof wdt.periodInfo, 'function')
        assert.strictEqual(typeof rp.spanLabelOf, 'function')
        assert.strictEqual(typeof rp.spanSecOf, 'function')
        assert.strictEqual(typeof rp.chkIntervalSec, 'function')
        assert.strictEqual(rp.INTERVAL_SEC_BASE, 14400)
        assert.strictEqual(rp.INTERVAL_SEC_MAX, 31536000)
    })

    describe('S1/S2 各calc: 根數不變、vs逐筆相同、標籤依手寫對照', function() {

        names.forEach((nm) => {
            it(`${nm}: 每根 ${IVS.join('/')} 秒`, async function() {
                let rd = await call(nm, arr)
                //S3前提: 不給時之len即LENS
                assert.deepStrictEqual(rd.map((v) => v.len), LENS[nm])
                for (let iv of IVS) {
                    let rrs = await call(nm, arr, { intervalSec: iv })
                    //S2: 標籤依手寫對照; S1: 根數不變
                    assert.deepStrictEqual(shapeOf(rrs), LENS[nm].map((b) => `${LABELS[iv][b]}:${b}`), `intervalSec ${iv} 週期表`)
                    //S1: vs與不給時逐筆相同(計算只依根數)
                    rrs.forEach((r, i) => {
                        assert.deepStrictEqual(r.vs, rd[i].vs, `intervalSec ${iv} ${r.period} vs`)
                    })
                }
            })
        })

        it('每根4hr(14400)時各calc之輸出與不給opt.intervalSec完全相同(含數字字串)', async function() {
            //S2: 逐一重現現行標籤; S3
            for (let nm of names) {
                let rd = await call(nm, arr)
                assert.deepStrictEqual(await call(nm, arr, { intervalSec: 14400 }), rd, nm)
                assert.deepStrictEqual(await call(nm, arr, { intervalSec: '14400' }), rd, `${nm} 字串`)
            }
        })

        it('每根1day時之對照: 4hr→1day、12hr→3day、1day→6day、30day→180day(calcVec涵蓋全部11期)', async function() {
            let r4 = await wdt.calcVec(arr, 'Close')
            let r1 = await wdt.calcVec(arr, 'Close', { intervalSec: 86400 })
            let m = {}
            r4.forEach((v, i) => {
                m[v.period] = r1[i].period
            })
            assert.deepStrictEqual(m, { '4hr': '1day', '8hr': '2day', '12hr': '3day', '16hr': '4day', '20hr': '5day', '1day': '6day', '2day': '12day', '4day': '24day', '7day': '42day', '15day': '90day', '30day': '180day' })
        })

        it('多參數之表(calcIchimoku、calcKeltner、calcSupertrend)之參數不變, 標籤依代表根數(senkouB/len)換算', async function() {
            //S1: 與直接以同參數給opt.kp者之vs相同
            let ic = await wdt.calcIchimoku(arr, 'Close', { intervalSec: 86400 })
            let ic2 = await wdt.calcIchimoku(arr, 'Close', { kp: { x: { tenkan: 4, kijun: 12, senkouB: 24 } } })
            assert.strictEqual(ic[0].period, '24day')
            assert.strictEqual(ic[0].len, 24)
            assert.deepStrictEqual(ic[0].vs, ic2[0].vs)
            assert.ok(ic2[0].vs.length > 0)
            let kc = await wdt.calcKeltner(arr, 'Close', { intervalSec: 86400 })
            let kc2 = await wdt.calcKeltner(arr, 'Close', { kp: { x: { len: 6, mult: 2 } } })
            assert.strictEqual(kc[3].period, '6day')
            assert.deepStrictEqual(kc[3].vs, kc2[0].vs)
            let st = await wdt.calcSupertrend(arr, 'Close', { intervalSec: 3600 })
            let st2 = await wdt.calcSupertrend(arr, 'Close', { kp: { x: { len: 24, mult: 4 } } })
            assert.strictEqual(st[5].period, '1day')
            assert.deepStrictEqual(st[5].vs, st2[0].vs)
        })

        it('單根型態(calcCandle、calcKlr)於每根1day時標籤為1day、len為1、vs同不給時', async function() {
            for (let nm of ['calcCandle', 'calcKlr']) {
                let r = await call(nm, arr, { intervalSec: 86400 })
                let rd = await call(nm, arr)
                assert.deepStrictEqual(shapeOf(r), ['1day:1'], nm)
                assert.deepStrictEqual(r[0].vs, rd[0].vs, nm)
            }
        })

        it('每根1day時無剔除: 各calc之期數與每根4hr相同', async function() {
            let n4 = 0
            let n1 = 0
            for (let nm of names) {
                n4 += (await call(nm, arr)).length
                n1 += (await call(nm, arr, { intervalSec: 86400 })).length
            }
            assert.strictEqual(n1, n4)
            assert.strictEqual(n4, Object.values(LENS).reduce((a, b) => a + b.length, 0))
        })

        it('同一每根時長下各calc之標籤皆不重複(期數與內建表相同, 撞名即少一期), 且標籤之秒數 = len × 每根秒數', async function() {
            //S2: 期別為物件之鍵, 撞名時後者覆蓋前者使期數變少, 故以期數與len清單斷言
            let short = genOhlc(5)
            for (let iv of IVS_MORE) {
                for (let nm of names) {
                    let rrs = await call(nm, short, { intervalSec: iv })
                    assert.strictEqual(rrs.length, LENS[nm].length, `${nm} intervalSec ${iv} 期數`)
                    assert.deepStrictEqual(rrs.map((v) => v.len), LENS[nm], `${nm} intervalSec ${iv} len`)
                    rrs.forEach((v) => {
                        assert.strictEqual(rp.spanSecOf(v.period), v.len * iv, `${nm} intervalSec ${iv} ${v.period}`)
                    })
                }
            }
        })

        it('resolvePeriods: 含全部11種內建標籤之表於各每根秒數下仍為11期(標籤互異)', function() {
            //S2: 以陣列蒐集換算後之標籤, 去重前後長度相同
            let kp = { '4hr': 1, '8hr': 2, '12hr': 3, '16hr': 4, '20hr': 5, '1day': 6, '2day': 12, '4day': 24, '7day': 42, '15day': 90, '30day': 180 }
            for (let iv of IVS_MORE) {
                let r = rp.default(kp, { intervalSec: iv })
                let labels = Object.keys(kp).map((p) => rp.spanLabelOf(rp.spanSecOf(p) / 14400 * iv))
                assert.strictEqual(new Set(labels).size, labels.length, `intervalSec ${iv} 去重前後`)
                assert.deepStrictEqual(Object.keys(r), labels, `intervalSec ${iv} 標籤`)
                assert.deepStrictEqual(Object.values(r), Object.values(kp), `intervalSec ${iv} 根數`)
            }
        })

    })

    describe('S2 標籤規則(spanLabelOf / spanSecOf)', function() {

        it('單位之取法: 整日day、否則整小時hr、否則整分鐘m', function() {
            let cases = [
                [60, '1m'], [120, '2m'], [3540, '59m'], [3600, '1hr'], [5400, '90m'], [7200, '2hr'], [14400, '4hr'],
                [72000, '20hr'], [82800, '23hr'], [86400, '1day'], [90000, '25hr'], [86460, '1441m'], [129600, '36hr'],
                [172800, '2day'], [259200, '3day'], [15552000, '180day'], [31536000, '365day'],
            ]
            cases.forEach(([sec, label]) => {
                assert.strictEqual(rp.spanLabelOf(sec), label, String(sec))
                assert.strictEqual(rp.spanSecOf(label), sec, label)
            })
        })

        it('標籤與秒數一一對應: 60的1至20000倍之標籤皆不同且可解析回原秒數', function() {
            let seen = new Set()
            for (let k = 1; k <= 20000; k++) {
                let sec = 60 * k
                let label = rp.spanLabelOf(sec)
                assert.ok(!seen.has(label), label)
                seen.add(label)
                assert.strictEqual(rp.spanSecOf(label), sec)
            }
        })

        it('非60之正整數倍(非整分鐘等)無法表示, throw', function() {
            let msg = 'invalid sec: must be a positive integer multiple of 60'
            let bads = [59, 61, 90, 30, 1, 0, -60, 60.5, NaN, Infinity, -Infinity, '60', null, undefined, true, [60], {}, 60n, 2 ** 53 * 60]
            bads.forEach((v, i) => {
                assert.throws(() => rp.spanLabelOf(v), { message: msg }, `bads[${i}]`)
            })
        })

        it('spanSecOf: 非標準寫法與非字串回傳null', function() {
            let bads = ['24hr', '60m', '120m', '48hr', '01day', '0day', '1.5day', '4h', '4HR', '1Day', ' 4hr', '4hr ', '4 hr', '1d', '30s', 'none', '', '-4hr', '+4hr', '4e1hr', '9007199254740993day', 4, null, undefined, {}]
            bads.forEach((v, i) => {
                assert.strictEqual(rp.spanSecOf(v), null, `bads[${i}]`)
            })
        })

    })

    describe('S4 opt.intervalSec 無效即拋', function() {

        let bads = [0, -60, 59, 61, 90, 30, 1, 1.5, 60.5, 31536060, 31536000 * 2, 1e21, 'abc', '', ' ', 'NaN', '0x3c', '60s', Infinity, -Infinity, NaN, true, false, [], [3600], {}, 60n]

        it('resolvePeriods: throw, 訊息不含傳入之值', function() {
            let kp = { '1day': 6 }
            bads.forEach((v, i) => {
                assert.throws(() => rp.default(kp, { intervalSec: v }), { message: MSG_ISEC }, `bads[${i}]`)
            })
            assert.throws(() => rp.default(kp, { intervalSec: 'mark3600' }), (err) => err.message === MSG_ISEC && !err.message.includes('mark'))
        })

        it('各calc: reject(不同步throw), 訊息同上', async function() {
            for (let nm of names) {
                let p
                assert.doesNotThrow(() => {
                    p = call(nm, arr, { intervalSec: 61 })
                })
                await assert.rejects(p, { message: MSG_ISEC }, nm)
            }
        })

        it('有效之邊界與寫法: 60、31536000、數字字串(含前後空白)、86400.0', async function() {
            let kp = { '4hr': 1, '1day': 6 }
            assert.deepStrictEqual(rp.default(kp, { intervalSec: 60 }), { '1m': 1, '6m': 6 })
            assert.deepStrictEqual(rp.default(kp, { intervalSec: 31536000 }), { '365day': 1, '2190day': 6 })
            assert.deepStrictEqual(rp.default(kp, { intervalSec: '86400' }), { '1day': 1, '6day': 6 })
            assert.deepStrictEqual(rp.default(kp, { intervalSec: ' 3600 ' }), { '1hr': 1, '6hr': 6 })
            assert.deepStrictEqual(rp.default(kp, { intervalSec: 86400.0 }), { '1day': 1, '6day': 6 })
            assert.strictEqual(rp.chkIntervalSec('900'), 900)
        })

        it('數字字串之各種寫法皆依轉換值使用(檢測之值即使用之值, K4/K7)', function() {
            //規格: 數字字串格式同wsemi之iseint; 結果須為數值
            let exp = { '1hr': 1 }
            for (let s of ['3600', ' 3600 ', '+3600', '03600', '3600.0', '3.6e3', '3.6E3', '360e1']) {
                assert.strictEqual(rp.chkIntervalSec(s), 3600, s)
                assert.deepStrictEqual(rp.default({ '4hr': 1 }, { intervalSec: s }), exp, s)
            }
        })

        it('各calc: opt.kp有效而intervalSec無效時仍reject(檢測先於opt.kp之處理, 與opt.kp有無無關)', async function() {
            for (let nm of names) {
                await assert.rejects(call(nm, arr, { intervalSec: 61, kp: { x: 18 } }), { message: MSG_ISEC }, nm)
                await assert.rejects(call(nm, arr, { intervalSec: 'abc', kp: { x: 18 }, debug: true, funLog: () => {} }), { message: MSG_ISEC }, nm)
            }
        })

        it('兩個無效值並存時之優先順序: 必須參數(kp、period)先於opt.intervalSec; opt.intervalSec先於opt.kp', function() {
            //必須參數之檢核先於opt類參數(dspec: 報錯只用於必須參數); opt.intervalSec為給了而無效即拒之例外
            assert.throws(() => rp.default(null, { intervalSec: 61 }), { message: 'invalid kp: must be a non-empty object' })
            assert.throws(() => rp.default({ '1day': 0 }, { intervalSec: 61 }), { message: 'invalid kp[1day]: must be a positive integer or an object' })
            assert.throws(() => rp.default({ '1day': 6 }, { intervalSec: 61, kp: { a: 0 } }), { message: MSG_ISEC })
            assert.throws(() => wdt.periodInfo(3, { intervalSec: 61 }), { message: MSG_PERIOD }) //period非字串先檢
            assert.throws(() => wdt.periodInfo('x', { intervalSec: 61 }), { message: MSG_ISEC }) //period為字串時intervalSec先於標籤之解析
            assert.throws(() => wdt.periodInfo('12hr', { intervalSec: 61 }), { message: MSG_ISEC })
        })

        it('intervalSec為null/undefined視為未給(同預設)', function() {
            let kp = { '12hr': 3, '1day': 6 }
            assert.deepStrictEqual(rp.default(kp, { intervalSec: null }), kp)
            assert.deepStrictEqual(rp.default(kp, { intervalSec: undefined }), kp)
        })

        it('根數為本時kp之標籤須為4hr之整數倍之標準標籤, 否則throw(只帶標籤)', function() {
            assert.throws(() => rp.default({ '30m': 1 }, { intervalSec: 86400 }), { message: 'invalid kp[30m]: must be labeled with a time span that is a multiple of 4hr' })
            assert.throws(() => rp.default({ '24hr': 6 }, { intervalSec: 86400 }), { message: 'invalid kp[24hr]: must be labeled with a time span that is a multiple of 4hr' })
            assert.throws(() => rp.default({ 'x': 6 }, { intervalSec: 86400 }), { message: 'invalid kp[x]: must be labeled with a time span that is a multiple of 4hr' })
        })

    })

    describe('S5 已移除之opt.barsPerDay: 視為未知鍵而忽略', function() {

        //各種值: 曾為有效之換算值、曾與intervalSec矛盾之值、非預期之值
        let vals = [24, 1, 6, 48, 0.5, '24', 0.01, 0, 'abc', null, 86401]

        it('各calc: 單獨給barsPerDay時輸出同未給(逐位相同: 不換算根數、不剔除、不改標籤、不reject)', async function() {
            for (let nm of names) {
                let rd = await call(nm, arr)
                for (let v of vals) {
                    assert.deepStrictEqual(await call(nm, arr, { barsPerDay: v }), rd, `${nm} barsPerDay ${v}`)
                }
            }
        })

        it('各calc: 與intervalSec併給時輸出同只給intervalSec(含曾視為矛盾之值, 不reject)', async function() {
            for (let nm of names) {
                for (let iv of [86400, 3600, 14400]) {
                    let r = await call(nm, arr, { intervalSec: iv })
                    for (let v of vals) {
                        assert.deepStrictEqual(await call(nm, arr, { intervalSec: iv, barsPerDay: v }), r, `${nm} intervalSec ${iv} barsPerDay ${v}`)
                    }
                }
            }
        })

        it('日K線(曾以barsPerDay 1換算而剔除12hr/16hr/20hr): 不再剔除, 期數與每根4hr相同', async function() {
            let rs = await wdt.calcRsi(arr, 'Close', { barsPerDay: 1 })
            assert.deepStrictEqual(shapeOf(rs), ['12hr:3', '16hr:4', '20hr:5', '1day:6', '2day:12', '4day:24', '7day:42'])
            let rs2 = await wdt.calcRsi(arr, 'Close', { intervalSec: 86400, barsPerDay: 1 })
            assert.deepStrictEqual(shapeOf(rs2), ['3day:3', '4day:4', '5day:5', '6day:6', '12day:12', '24day:24', '42day:42'])
        })

        it('periodInfo與resolvePeriods: 忽略barsPerDay', function() {
            assert.deepStrictEqual(wdt.periodInfo('3day', { intervalSec: 86400, barsPerDay: 6 }), { period: '3day', bars: 3, spanSec: 259200 })
            assert.deepStrictEqual(wdt.periodInfo('3day', { barsPerDay: 1 }), { period: '3day', bars: 18, spanSec: 259200 })
            assert.deepStrictEqual(rp.default({ '4hr': 1 }, { intervalSec: 259200, barsPerDay: 1 / 3 }), { '3day': 1 })
            assert.deepStrictEqual(rp.default({ '4hr': 1 }, { intervalSec: 259200, barsPerDay: 0.3333 }), { '3day': 1 })
        })

        it('檢測先於其他處理: intervalSec無效時即使opt.kp有效亦以intervalSec之訊息拋出', function() {
            assert.throws(() => rp.default({ '1day': 6 }, { intervalSec: 61, kp: { '3day': 18 } }), { message: MSG_ISEC })
            assert.throws(() => rp.default({ '1day': 6 }, { intervalSec: 'x', barsPerDay: 6, kp: { '3day': 18 } }), { message: MSG_ISEC })
            assert.deepStrictEqual(rp.default({ '1day': 6 }, { intervalSec: 86400, kp: { '3day': 18 } }), { '3day': 18 })
        })

    })

    describe('S6 opt.kp 原樣採用', function() {

        it('同時給opt.intervalSec時標籤與值皆不換算; 回傳新物件', async function() {
            let kpIn = { '3day': 18, 'x': { len: 5, mult: 1 } }
            let r = rp.default({ '1day': 6 }, { kp: kpIn, intervalSec: 86400 })
            assert.deepStrictEqual(r, kpIn)
            assert.notStrictEqual(r, kpIn)
            assert.notStrictEqual(r.x, kpIn.x)
            assert.deepStrictEqual(shapeOf(await wdt.calcMa(arr, 'Close', { kp: { '3day': 18 }, intervalSec: 86400 })), ['3day:18'])
        })

        it('自訂表之標籤由呼叫端自負其義: 與intervalSec同給時不換算, periodInfo只適用於內建表(對自訂標籤之bars不等於len)', async function() {
            //S6、S7: 自訂之'1day'(6根)於每根1day時仍名'1day', 而periodInfo依標籤推得1根
            let r = await wdt.calcMa(arr, 'Close', { kp: { '1day': 6 }, intervalSec: 86400 })
            assert.deepStrictEqual(shapeOf(r), ['1day:6'])
            assert.strictEqual(wdt.periodInfo('1day', { intervalSec: 86400 }).bars, 1)
            assert.notStrictEqual(wdt.periodInfo(r[0].period, { intervalSec: 86400 }).bars, r[0].len)
            //同一根數由內建表產生時, periodInfo之bars等於len
            let rb = await wdt.calcMa(arr, 'Close', { intervalSec: 86400 })
            assert.strictEqual(rb[0].period, '6day')
            assert.strictEqual(wdt.periodInfo(rb[0].period, { intervalSec: 86400 }).bars, rb[0].len)
        })

        it('opt.kp非預期時改用內建表並依intervalSec換算標籤; opt.debug警告opt.kp', function() {
            getOptReader.resetWarned()
            let logs = []
            let funLog = (msg, meta) => {
                logs.push(meta.key)
            }
            assert.deepStrictEqual(rp.default({ '12hr': 3, '1day': 6 }, { kp: { a: 0 }, intervalSec: 86400, debug: true, funLog }), { '3day': 3, '6day': 6 })
            assert.deepStrictEqual(logs, ['kp']) //行為改變(第688項): 警告之鍵名改為getOptReader之形式(不含opt.前綴; 原為'opt.kp')
            getOptReader.resetWarned()
        })

        it('根數為本之結果為新物件, 參數物件亦複製, 不改寫輸入(凍結之kp與opt可執行)', function() {
            let kp = Object.freeze({ '1day': Object.freeze({ len: 6, mult: 2 }), '12hr': 3 })
            let opt = Object.freeze({ intervalSec: 86400 })
            let r = rp.default(kp, opt)
            assert.deepStrictEqual(r, { '6day': { len: 6, mult: 2 }, '3day': 3 })
            assert.deepStrictEqual(Object.keys(r), ['6day', '3day']) //鍵序同輸入
            assert.notStrictEqual(r['6day'], kp['1day'])
            r['6day'].len = 999
            assert.strictEqual(kp['1day'].len, 6)
        })

    })

    describe('S7 periodInfo', function() {

        it('各calc各期: bars等於len, spanSec = len × 每根秒數', async function() {
            let short = genOhlc(5)
            for (let iv of IVS_MORE) {
                for (let nm of names) {
                    let rrs = await call(nm, short, { intervalSec: iv })
                    rrs.forEach((v) => {
                        assert.deepStrictEqual(wdt.periodInfo(v.period, { intervalSec: iv }), { period: v.period, bars: v.len, spanSec: v.len * iv }, `${nm} ${iv} ${v.period}`)
                    })
                }
            }
        })

        it('跨週期以根數對應同一線型: 每根1day之3day與每根4hr之12hr同為3根; 未給intervalSec視為4hr', function() {
            assert.deepStrictEqual(wdt.periodInfo('3day', { intervalSec: 86400 }), { period: '3day', bars: 3, spanSec: 259200 })
            assert.deepStrictEqual(wdt.periodInfo('12hr'), { period: '12hr', bars: 3, spanSec: 43200 })
            assert.deepStrictEqual(wdt.periodInfo('180day', { intervalSec: '86400' }), { period: '180day', bars: 180, spanSec: 15552000 })
            assert.deepStrictEqual(wdt.periodInfo('1350m', { intervalSec: 900 }), { period: '1350m', bars: 90, spanSec: 81000 })
        })

        it('未給intervalSec時視為每根4hr: 日線之3day須給intervalSec 86400才得3根(未給得18根)', function() {
            assert.deepStrictEqual(wdt.periodInfo('3day'), { period: '3day', bars: 18, spanSec: 259200 })
            assert.deepStrictEqual(wdt.periodInfo('3day', { intervalSec: 86400 }), { period: '3day', bars: 3, spanSec: 259200 })
        })

        it('none(calcOrig之期別)回傳0', async function() {
            let ro = await wdt.calcOrig(arr, 'Close')
            assert.deepStrictEqual(wdt.periodInfo(ro[0].period), { period: 'none', bars: 0, spanSec: 0 })
            assert.deepStrictEqual(wdt.periodInfo('none', { intervalSec: 86400 }), { period: 'none', bars: 0, spanSec: 0 })
        })

        it('S7 Npct(calcDirChange之門檻標籤, N為正整數)回傳根數0、秒數0(同none): 與calcDirChange各期之len相同, 不隨intervalSec改變', async function() {
            let rrs = await wdt.calcDirChange(arr, 'Close')
            assert.deepStrictEqual(rrs.map((v) => v.period), ['4pct', '6pct', '8pct', '10pct'])
            let opts = [undefined, {}, { intervalSec: null }, { intervalSec: '86400' }, { intervalSec: '3600' }].concat(IVS_MORE.map((iv) => ({ intervalSec: iv })))
            opts.forEach((opt, j) => {
                rrs.forEach((v) => {
                    //bars等於該期輸出之len(同其他calc之S7), 且為0根0秒
                    assert.strictEqual(wdt.periodInfo(v.period, opt).bars, v.len, `opt[${j}] ${v.period} bars等於len`)
                    assert.deepStrictEqual(wdt.periodInfo(v.period, opt), { period: v.period, bars: 0, spanSec: 0 }, `opt[${j}] ${v.period} 0根0秒`)
                })
            })
            //opt.kp自訂之門檻表, 標籤符合${N}pct者亦同
            let rk = await wdt.calcDirChange(arr, 'Close', { kp: { '5pct': 5, '12pct': 12 }, intervalSec: 86400 })
            rk.forEach((v) => {
                assert.deepStrictEqual(wdt.periodInfo(v.period, { intervalSec: 86400 }), { period: v.period, bars: v.len, spanSec: 0 }, `kp ${v.period}`)
            })
            //任一正整數(無前導零)之Npct
            for (let p of ['1pct', '2pct', '9pct', '10pct', '11pct', '19pct', '99pct', '100pct', '250pct', '1000000pct', `9${'0'.repeat(40)}pct`]) {
                assert.deepStrictEqual(wdt.periodInfo(p), { period: p, bars: 0, spanSec: 0 }, p)
                assert.deepStrictEqual(wdt.periodInfo(p, { intervalSec: 60 }), { period: p, bars: 0, spanSec: 0 }, `${p} 每根60秒`)
            }
        })

        it('S7 Npct之接受集合: 於n(0~200) × 單位(day、hr、m、pct、無)之格上逐格核對 ⇒ 只有n為正整數且單位為pct者回0根0秒, 其餘維持既有之接受與拒絕', function() {
            let nAcc = 0
            let nRej = 0
            let nPct = 0
            for (let n = 0; n <= 200; n++) {
                for (let u of ['day', 'hr', 'm', 'pct', '', 'PCT', 'Pct', 'pcts', 'p', '%']) {
                    for (let lead of ['', '0', '00', '+', '-', ' ']) {
                        let p = `${lead}${n}${u}`
                        //期望: pct且為無前導零之正整數 ⇒ 0根0秒; 否則依既有之標準標籤規則(spanSecOf, 本檔S2已逐一驗證)
                        let expPct = u === 'pct' && lead === '' && n >= 1
                        let sec = rp.spanSecOf(p)
                        let expStd = sec !== null && sec % 14400 === 0
                        let got = null
                        try {
                            got = wdt.periodInfo(p)
                        }
                        catch (err) {
                            assert.strictEqual(err.message, MSG_PERIOD, `${p} 之訊息`)
                        }
                        if (expPct) {
                            assert.deepStrictEqual(got, { period: p, bars: 0, spanSec: 0 }, `${p} 應收`)
                            nPct++
                            nAcc++
                        }
                        else if (expStd) {
                            assert.deepStrictEqual(got, { period: p, bars: sec / 14400, spanSec: sec }, `${p} 既有之標準標籤`)
                            nAcc++
                        }
                        else {
                            assert.strictEqual(got, null, `${p} 應拒`)
                            nRej++
                        }
                    }
                }
            }
            //鑑別前提: 各類格數皆非零
            assert.strictEqual(nPct, 200, `Npct 共 ${nPct} 格`)
            assert.ok(nAcc > nPct, `既有之標準標籤亦有被收者 ${nAcc}`)
            assert.ok(nRej > 1000, `被拒者 ${nRej}`)
        })

        it('S7 Npct之拒絕寫法: 0pct、前導零、小數、無數字、大小寫、前後空白或換行、符號、指數、全形數字、其餘單位或尾綴 ⇒ throw(訊息同既有、不含傳入之值)', function() {
            let bads = ['0pct', '00pct', '01pct', '007pct', '4.5pct', '4.0pct', '.5pct', '4.pct', 'pct', 'Pct', 'PCT', '4PCT', '4Pct', '4pCt', ' 4pct', '4pct ', '4 pct', '4pct\n', '\n4pct', '4pct\r\n', '\t4pct', '-4pct', '+4pct', '4pct%', '%4pct', '4%', '4pc', '4pct2', '4pctpct', 'pct4', 'x4pct', '4xpct', '4-pct', '4_pct', '4,0pct', '1e1pct', '0x4pct', '4e0pct', '4pcts', '4cpt', '４pct', '٤pct', 'NaNpct', 'Infinitypct', 'undefinedpct', 'nullpct', '4 pct', '4 pct', '4pct​']
            bads.forEach((p) => {
                assert.throws(() => wdt.periodInfo(p), { message: MSG_PERIOD }, JSON.stringify(p))
                assert.throws(() => wdt.periodInfo(p, { intervalSec: 86400 }), { message: MSG_PERIOD }, `${JSON.stringify(p)} 於日線`)
                assert.throws(() => wdt.periodInfo(p, { intervalSec: 60 }), { message: MSG_PERIOD }, `${JSON.stringify(p)} 於每根60秒`)
            })
            //非字串之期別(含數值4、陣列['4pct']、物件)仍先拒
            for (let p of [4, 4.5, ['4pct'], { period: '4pct' }, null, undefined, true, '']) {
                assert.throws(() => wdt.periodInfo(p), { message: MSG_PERIOD })
            }
        })

        it('S7 Npct: opt.intervalSec給了而無效時仍throw(同none, 先於標籤之判斷, 訊息不含傳入之值)', function() {
            for (let v of [0, 59, 61, 90, -60, 1.5, 31536060, 'abc', '', 'mark', NaN, Infinity, true, [], {}]) {
                assert.throws(() => wdt.periodInfo('4pct', { intervalSec: v }), (err) => err.message === MSG_ISEC && !err.message.includes('mark'), `4pct intervalSec ${String(v)}`)
                assert.throws(() => wdt.periodInfo('10pct', { intervalSec: v }), { message: MSG_ISEC }, `10pct intervalSec ${String(v)}`)
            }
            //period無效時, 於有效之intervalSec下以period之訊息拒
            assert.throws(() => wdt.periodInfo('0pct', { intervalSec: 86400 }), { message: MSG_PERIOD })
        })

        it('無效之period或intervalSec throw, 訊息不含傳入之值', function() {
            let bads = [['24hr', {}], ['3day', { intervalSec: 172800 }], ['90m', { intervalSec: 3600 }], ['2hr'], ['x'], [''], [3], [null], [undefined], [{}], ['mark12hr']]
            bads.forEach(([p, opt], i) => {
                assert.throws(() => wdt.periodInfo(p, opt), { message: MSG_PERIOD }, `bads[${i}]`)
            })
            assert.throws(() => wdt.periodInfo('12hr', { intervalSec: 61 }), { message: MSG_ISEC })
            assert.throws(() => wdt.periodInfo('none', { intervalSec: 'mark' }), (err) => err.message === MSG_ISEC && !err.message.includes('mark'))
        })

    })

    describe('S8 dataConvert / dataCalibrate 經optMethod傳入intervalSec(入口乾式檢核先於計算與寫檔)', function() {

        let fdRoot = fileURLToPath(new URL('./_tmp/unit-intervalSec/', import.meta.url))
        let fd1 = fdRoot + 'iv86400/'
        let fd4 = fdRoot + 'iv4hr/'

        before(function() {
            fs.mkdirSync(fd1, { recursive: true })
            fs.mkdirSync(fd4, { recursive: true })
        })

        after(function() {
            fs.rmSync(fdRoot, { recursive: true, force: true })
            try {
                fs.rmdirSync(fileURLToPath(new URL('./_tmp/', import.meta.url))) //test/_tmp已空時一併移除(非空則保留)
            }
            catch (err) {}
        })

        it('輸出檔名之期別為換算後之標籤, 內容與不給時同根數之期相同', async function() {
            let a = genOhlc(300)
            let kp = { ma: wdt.calcMa }
            let run = (optMethod, fd) => {
                let methods = [{ method: 'ma', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod }]
                return wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, a, kp, fd, { keysIn: ['Close'] })
            }
            await run({ intervalSec: 86400 }, fd1)
            await run({}, fd4)
            let fs1 = fs.readdirSync(fd1).sort()
            let fs4 = fs.readdirSync(fd4).sort()
            let exp1 = ['6day', '12day', '24day', '42day', '90day', '180day'].map((p) => `price_ohlc_Close_param_ma_${p}.json`).sort()
            let exp4 = ['1day', '2day', '4day', '7day', '15day', '30day'].map((p) => `price_ohlc_Close_param_ma_${p}.json`).sort()
            assert.deepStrictEqual(fs1, exp1)
            assert.deepStrictEqual(fs4, exp4)
            let pairs = [['6day', '1day'], ['12day', '2day'], ['24day', '4day'], ['42day', '7day'], ['90day', '15day'], ['180day', '30day']]
            pairs.forEach(([p1, p4]) => {
                let c1 = fs.readFileSync(`${fd1}price_ohlc_Close_param_ma_${p1}.json`, 'utf8')
                let c4 = fs.readFileSync(`${fd4}price_ohlc_Close_param_ma_${p4}.json`, 'utf8')
                assert.strictEqual(c1, c4, `${p1} vs ${p4}`)
            })
        })

        it('dataCalibrate: optMethodInit/optMethodRef併入intervalSec並以opt.params排除後, 每次呼叫calcFn皆帶intervalSec', async function() {
            let seen = []
            let calcFn = async (a, keyIn, om) => {
                seen.push({ ...om })
                return wdt.calcMa(a, 'Close', om)
            }
            let a = genOhlc(300)
            let rs = await wdt.dataCalibrate(calcFn, a, a, ['param'], { intervalSec: 86400, norm: 0 }, { params: ['norm'], optMethodRef: { intervalSec: 86400 } })
            assert.ok(seen.length > 5)
            assert.ok(seen.every((om) => om.intervalSec === 86400))
            assert.strictEqual(rs.optMethod.intervalSec, 86400)
        })

        //runDc, 以ma、rsi兩method呼叫dataConvert寫入指定夾(夾先建立且為空)
        let a300 = genOhlc(300)
        let kpDc = { ma: wdt.calcMa, rsi: wdt.calcRsi }
        let runDc = (om1, om2, fd) => {
            fs.mkdirSync(fd, { recursive: true })
            let methods = [
                { method: 'ma', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod: om1 },
                { method: 'rsi', deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }], optMethod: om2 },
            ]
            return wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, a300, kpDc, fd, { keysIn: ['Close'] })
        }

        it('dataConvert: 第2個method之intervalSec無效 ⇒ reject(訊息同calc)且輸出夾為空(檢測先於寫檔)', async function() {
            //S8, S9: 第1個method有效(其檔在修正前會先寫出)
            let bads = [61, 'abc', 31536060, 0, -60, 1.5, '', true]
            for (let i = 0; i < bads.length; i++) {
                let fdA = fdRoot + `badSecond${i}/`
                await assert.rejects(runDc({ intervalSec: 86400 }, { intervalSec: bads[i] }, fdA), { message: MSG_ISEC }, `bads[${i}]`)
                assert.deepStrictEqual(fs.readdirSync(fdA), [], `bads[${i}]`)
            }
        })

        it('dataConvert: 同一次呼叫內各method之intervalSec不一致(86400與3600、86400與未給) ⇒ reject且輸出夾為空; 訊息之索引為第一個不一致者', async function() {
            //S9: dspec V19, 陣列元素之索引寫實際索引
            let fdB = fdRoot + 'mixed/'
            await assert.rejects(runDc({ intervalSec: 86400 }, { intervalSec: 3600 }, fdB), { message: MSG_MISMATCH(1) })
            assert.deepStrictEqual(fs.readdirSync(fdB), [])
            await assert.rejects(runDc({ intervalSec: 86400 }, {}, fdB), { message: MSG_MISMATCH(1) })
            await assert.rejects(runDc(undefined, { intervalSec: '86400' }, fdB), { message: MSG_MISMATCH(1) })
            await assert.rejects(runDc({ intervalSec: 14400 }, { intervalSec: 3600 }, fdB), { message: MSG_MISMATCH(1) })
            assert.deepStrictEqual(fs.readdirSync(fdB), [])
        })

        it('dataConvert: 各method皆一致(14400與未給視為一致)時, 輸出與皆未給時逐位相同; 皆為86400時標籤換算', async function() {
            let fdC0 = fdRoot + 'sameNone/'
            let fdC1 = fdRoot + 'same14400/'
            let fdC2 = fdRoot + 'same86400/'
            let r0 = await runDc(undefined, {}, fdC0)
            let r1 = await runDc({ intervalSec: 14400 }, {}, fdC1)
            let r2 = await runDc({ intervalSec: 86400 }, { intervalSec: '86400' }, fdC2)
            assert.deepStrictEqual(r1, r0)
            let f0 = fs.readdirSync(fdC0).sort()
            assert.deepStrictEqual(fs.readdirSync(fdC1).sort(), f0)
            f0.forEach((fn) => {
                assert.ok(fs.readFileSync(fdC1 + fn).equals(fs.readFileSync(fdC0 + fn)), fn)
            })
            assert.strictEqual(f0.length, 6 + 7)
            let f2 = fs.readdirSync(fdC2).sort()
            assert.strictEqual(f2.length, 6 + 7)
            assert.ok(f2.includes('price_ohlc_Close_RSI_rsi_3day.json'))
            assert.ok(f2.includes('price_ohlc_Close_param_ma_180day.json'))
            assert.deepStrictEqual(r2.map((v) => v.avg), r0.map((v) => v.avg)) //根數不變故統計相同
        })

        it('dataCalibrate: optMethodInit或optMethodRef之intervalSec無效 ⇒ 未呼叫calcFn即reject; barsPerDay視為未知鍵不影響', async function() {
            let n = 0
            let calcFn = async (a, keyIn, om) => {
                n++
                return wdt.calcMa(a, 'Close', om)
            }
            await assert.rejects(wdt.dataCalibrate(calcFn, a300, a300, ['param'], { intervalSec: 61, norm: 0 }, { params: ['norm'] }), { message: MSG_ISEC })
            await assert.rejects(wdt.dataCalibrate(calcFn, a300, a300, ['param'], { norm: 0 }, { params: ['norm'], optMethodRef: { intervalSec: 'abc' } }), { message: MSG_ISEC })
            assert.strictEqual(n, 0)
            //barsPerDay(已移除)不再與intervalSec核對: 不reject
            let rs = await wdt.dataCalibrate(calcFn, a300, a300, ['param'], { intervalSec: 86400, barsPerDay: 6, norm: 0 }, { params: ['norm'] })
            assert.ok(n > 0)
            assert.strictEqual(rs.optMethod.intervalSec, 86400)
        })

        it('dataCalibrate: optMethodInit或optMethodRef之intervalSec為讀取即拋錯之存取器 ⇒ 未呼叫calcFn即reject固定訊息(不洩漏拋出之訊息; 第688項)', async function() {
            let n = 0
            let calcFn = async (a, keyIn, om) => {
                n++
                return wdt.calcMa(a, 'Close', om)
            }
            let thrower = {
                enumerable: true,
                get() {
                    throw new Error('SECRET-boom')
                },
            }
            let init = { norm: 0 }
            Object.defineProperty(init, 'intervalSec', thrower)
            let ref = {}
            Object.defineProperty(ref, 'intervalSec', thrower)
            await assert.rejects(wdt.dataCalibrate(calcFn, a300, a300, ['param'], init, { params: ['norm'] }), (e) => e.message === MSG_ISEC)
            await assert.rejects(wdt.dataCalibrate(calcFn, a300, a300, ['param'], { norm: 0 }, { params: ['norm'], optMethodRef: ref }), (e) => e.message === MSG_ISEC)
            assert.strictEqual(n, 0)
        })

        describe('S9 dataConvert之入口檢核先於任何計算與寫檔(V17): 任一無效 ⇒ reject、輸出夾為空、calc與funAddKeysIn未被呼叫', function() {

            let a = genOhlc(300)
            let calls = 0
            let adds = 0
            let seq = 0
            let kpC = {
                ma: async (arr, keyIn, om) => {
                    calls++
                    return wdt.calcMa(arr, keyIn, om)
                },
                rsi: async (arr, keyIn, om) => {
                    calls++
                    return wdt.calcRsi(arr, keyIn, om)
                },
            }

            //m1, 第1個method(有效): 其檔於修正前會先寫出
            let m1 = () => {
                return { method: 'ma', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod: {} }
            }
            //m2, 第2個method(有效)
            let m2 = (patch = {}) => {
                return { method: 'rsi', deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }], optMethod: {}, ...patch }
            }

            //runCase, 執行dataConvert(寫檔模式)並回傳{ err, calls, adds, files, nConsole }; nConsole為執行期間console.log、warn、error、info、debug之呼叫次數(檢核失敗之處置不得以console輸出輸入, 見expectRejected)
            let runCase = async (methods, optX = {}) => {
                calls = 0
                adds = 0
                let fd = fdRoot + `v17_${seq++}/`
                fs.mkdirSync(fd, { recursive: true })
                let funAddKeysIn = (v) => {
                    adds++
                    return v
                }
                let opt = { keysIn: ['Close'], funAddKeysIn, ...optX }
                let err = null
                let nConsole = 0
                let orgs = {}
                let names = ['log', 'warn', 'error', 'info', 'debug']
                names.forEach((k) => {
                    orgs[k] = console[k]
                    console[k] = () => {
                        nConsole++
                    }
                })
                try {
                    await wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, a, kpC, fd, opt)
                }
                catch (e) {
                    err = e
                }
                finally {
                    names.forEach((k) => {
                        console[k] = orgs[k]
                    })
                }
                return { err, calls, adds, files: fs.readdirSync(fd), nConsole }
            }

            //expectRejected, 斷言以指定訊息拒絕且無任何副作用(含不以console輸出, 跨套件規格V20與〈診斷輸出與遮罩〉)
            let expectRejected = (r, msg, tag) => {
                assert.ok(r.err !== null, `${tag}: 應reject`)
                assert.strictEqual(r.err.message, msg, `${tag}: 訊息`)
                assert.deepStrictEqual(r.files, [], `${tag}: 輸出夾須為空`)
                assert.strictEqual(r.calls, 0, `${tag}: calc不得被呼叫`)
                assert.strictEqual(r.adds, 0, `${tag}: funAddKeysIn不得被呼叫`)
                assert.strictEqual(r.nConsole, 0, `${tag}: 不得以console輸出`)
            }

            it('對照: 兩個method皆有效時正常寫檔(確認下列拒絕案之夾為空非因設定錯誤)', async function() {
                let r = await runCase([m1(), m2()])
                assert.strictEqual(r.err, null)
                assert.strictEqual(r.files.length, 6 + 7)
                assert.strictEqual(r.calls, 2)
                assert.strictEqual(r.adds, 300)
            })

            //行為改變(Gitea 本輪第688項,V19、V20): 各檢核失敗之訊息改為固定詞彙(只含位置與期望之種類, 不含輸入值), 且不以console輸出輸入; 舊訊息為`invalid m[...]`等(方括號內為輸入值)
            it('第2個method非物件 ⇒ invalid methods[1]: must be a non-empty object(含給了intervalSec時仍為此訊息; 不含輸入值)', async function() {
                expectRejected(await runCase([m1(), null]), 'invalid methods[1]: must be a non-empty object', 'null')
                expectRejected(await runCase([m1(), 5]), 'invalid methods[1]: must be a non-empty object', '5')
                expectRejected(await runCase([m1(), 'x']), 'invalid methods[1]: must be a non-empty object', 'x')
                let withSec = m1()
                withSec.optMethod = { intervalSec: 86400 }
                expectRejected(await runCase([withSec, null]), 'invalid methods[1]: must be a non-empty object', 'null+intervalSec')
            })

            it('第2個method之method無效或不在kp ⇒ invalid methods[1].method: must be a non-empty string / must be a key of kp(不含輸入值)', async function() {
                expectRejected(await runCase([m1(), m2({ method: 5 })]), 'invalid methods[1].method: must be a non-empty string', 'method:5')
                expectRejected(await runCase([m1(), m2({ method: undefined })]), 'invalid methods[1].method: must be a non-empty string', 'method:undefined')
                expectRejected(await runCase([m1(), m2({ method: 'zzz' })]), 'invalid methods[1].method: must be a key of kp', 'method:zzz')
            })

            it('第2個method之deals無效 ⇒ invalid methods[1].deals: must be a non-empty array(不含輸入值)', async function() {
                expectRejected(await runCase([m1(), m2({ deals: undefined })]), 'invalid methods[1].deals: must be a non-empty array', 'deals:undefined')
                expectRejected(await runCase([m1(), m2({ deals: [] })]), 'invalid methods[1].deals: must be a non-empty array', 'deals:[]')
                expectRejected(await runCase([m1(), m2({ deals: 'x' })]), 'invalid methods[1].deals: must be a non-empty array', 'deals:x')
            })

            it('第2個method之deal.keyOut或deal.nm無效 ⇒ invalid deal.keyOut: must be a non-empty string、invalid deal.nm: must be a non-empty object(不含輸入值)', async function() {
                expectRejected(await runCase([m1(), m2({ deals: [{ nm: { avg: 50, std: 10 } }] })]), 'invalid deal.keyOut: must be a non-empty string', 'keyOut:undefined')
                expectRejected(await runCase([m1(), m2({ deals: [{ keyOut: 5, nm: { avg: 50, std: 10 } }] })]), 'invalid deal.keyOut: must be a non-empty string', 'keyOut:5')
                expectRejected(await runCase([m1(), m2({ deals: [{ keyOut: 'RSI' }] })]), 'invalid deal.nm: must be a non-empty object', 'nm:undefined')
                expectRejected(await runCase([m1(), m2({ deals: [{ keyOut: 'RSI', nm: 'x' }] })]), 'invalid deal.nm: must be a non-empty object', 'nm:x')
                //同一method之第2個deal無效, 第1個deal有效
                expectRejected(await runCase([m1(), m2({ deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }, { keyOut: 'RSI', nm: null }] })]), 'invalid deal.nm: must be a non-empty object', 'deal[1].nm:null')
            })

            it('第2個method之intervalSec無效 ⇒ 訊息同calc; 與第1個method不一致 ⇒ invalid methods[1]...', async function() {
                expectRejected(await runCase([m1(), m2({ optMethod: { intervalSec: 61 } })]), 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000', 'intervalSec:61')
                expectRejected(await runCase([m1(), m2({ optMethod: { intervalSec: 86400 } })]), MSG_MISMATCH(1), 'mismatch')
            })

            it('三個method: 索引為第一個與先前不一致者(第2個不一致即索引1; 第3個不一致即索引2)', async function() {
                let withSec = (sec) => {
                    return m2({ optMethod: { intervalSec: sec } })
                }
                let m3 = (sec) => {
                    return { method: 'ma', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod: { intervalSec: sec } }
                }
                expectRejected(await runCase([m3(86400), withSec('86400'), m3(3600)]), MSG_MISMATCH(2), 'third')
                expectRejected(await runCase([m3(86400), withSec(3600), m3(3600)]), MSG_MISMATCH(1), 'second')
            })

            it('keysIn之元素非字串 ⇒ invalid opt.keysIn[1]: must be a non-empty string(先於計算與寫檔; 不含輸入值)', async function() {
                expectRejected(await runCase([m1(), m2()], { keysIn: ['Close', 5] }), 'invalid opt.keysIn[1]: must be a non-empty string', 'keysIn:5')
            })

            it('deal.keyIn有指定而不在keysIn內者不會被處理, 故不檢核(與修正前相同); 在keysIn內者照檢核', async function() {
                //Open不在keysIn(['Close'])內: 其deal之keyOut/nm無效亦不拒絕
                let skip = m2({ deals: [{ keyIn: 'Open', keyOut: 5, nm: 'x' }, { keyOut: 'RSI', nm: { avg: 50, std: 10 } }] })
                let r = await runCase([m1(), skip])
                assert.strictEqual(r.err, null)
                assert.strictEqual(r.files.length, 6 + 7)
                //Close在keysIn內: 照檢核
                let hit = m2({ deals: [{ keyIn: 'Close', keyOut: 'RSI', nm: 'x' }] })
                expectRejected(await runCase([m1(), hit]), 'invalid deal.nm: must be a non-empty object', 'keyIn:Close')
            })

            it('opt.denyOutput為true時亦先檢核(calc與funAddKeysIn未被呼叫)', async function() {
                expectRejected(await runCase([m1(), null], { denyOutput: true }), 'invalid methods[1]: must be a non-empty object', 'denyOutput')
            })

            it('第1個method無效而其後有效者亦拒(檢核涵蓋每一個method, 不只第2個以後)', async function() {
                expectRejected(await runCase([null, m2()]), 'invalid methods[0]: must be a non-empty object', 'first null')
                expectRejected(await runCase([m1(), m2()].map((v, i) => (i === 0 ? { ...v, method: 'zzz' } : v))), 'invalid methods[0].method: must be a key of kp', 'first method zzz')
                expectRejected(await runCase([{ ...m1(), deals: [{ keyOut: 'param' }] }, m2()]), 'invalid deal.nm: must be a non-empty object', 'first nm')
                expectRejected(await runCase([{ ...m1(), optMethod: { intervalSec: 61 } }, m2()]), 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000', 'first intervalSec')
            })

            it('同一method之第1個deal無效而其後有效者亦拒(檢核涵蓋每一個deal)', async function() {
                let bad = m2({ deals: [{ keyOut: 'RSI', nm: 'x' }, { keyOut: 'RSI', nm: { avg: 50, std: 10 } }] })
                expectRejected(await runCase([m1(), bad]), 'invalid deal.nm: must be a non-empty object', 'deal[0].nm')
            })

            it('同一method內多個deal依陣列順序處理(回傳依序、各依自己之avg/std)', async function() {
                //規格(dataConvert JSDoc): 對每個deal依其keyOut取值並以(值-avg)/std正規化; 回傳之avg為正規化後全期攤平序列之平均, 故第1個deal(avg 50, std 10)之avg = (第2個deal(avg 0, std 1)之avg - 50) / 10
                let fd = fdRoot + 'dealsOrder/'
                fs.mkdirSync(fd, { recursive: true })
                let methods = [
                    { method: 'rsi', deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }, { keyOut: 'RSI', nm: { avg: 0, std: 1 } }], optMethod: {} },
                ]
                let rs = await wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, a, kpC, fd, { keysIn: ['Close'], denyOutput: true })
                assert.strictEqual(rs.length, 2)
                assert.ok(Math.abs(rs[1].avg) > 1, '第2個deal之avg應為RSI本身(量級遠大於0)')
                assertNear(rs[0].avg, (rs[1].avg - 50) / 10, 1e-9, 'avg')
                assertNear(rs[0].std, rs[1].std / 10, 1e-9, 'std')
            })

            it('正常輸出: 依各deal之avg/std做z-score, 回傳順序為keysIn × methods × deals, 檔內容為(值-avg)/std', async function() {
                //規格(dataConvert JSDoc): 以(值-avg)/std正規化; 雙層迴圈 keysIn(外) × methods(內) × deals; deal.keyIn有指定則僅處理keyIn相符者
                let fd = fdRoot + 'zscore/'
                fs.mkdirSync(fd, { recursive: true })
                let methods = [
                    { method: 'rsi', deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }], optMethod: { intervalSec: 86400 } },
                    { method: 'ma', deals: [{ keyIn: 'Open', keyOut: 'param', nm: { avg: 100, std: 4 } }, { keyIn: 'Close', keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod: { intervalSec: 86400 } },
                ]
                let rs = await wdt.dataConvert('t', 'SYM', '1day', 'price', 'ohlc', methods, a, kpC, fd, { keysIn: ['Close', 'Open'] })
                assert.deepStrictEqual(rs.map((v) => `${v.keyIn}/${v.method}/${v.keyOut}`), ['Close/rsi/RSI', 'Close/ma/param', 'Open/rsi/RSI', 'Open/ma/param'])
                //rsi(Close, avg 50, std 10)之第3day期: (RSI-50)/10
                let rrs = await wdt.calcRsi(a, 'Close', { intervalSec: 86400 })
                let p3 = rrs.find((v) => v.period === '3day')
                let rows = JSON.parse(fs.readFileSync(fd + 'price_ohlc_Close_RSI_rsi_3day.json', 'utf8'))
                assert.ok(rows.length > 0)
                assert.strictEqual(rows.length, p3.vs.length)
                rows.forEach((row, i) => {
                    assert.strictEqual(row.time, p3.vs[i].time)
                    assertNear(row.param, (p3.vs[i].RSI - 50) / 10, 1e-12, `rsi row ${i}`)
                })
                //ma(Open, avg 100, std 4)之第6day期: (值-100)/4; ma(Close, avg 0, std 1)之第6day期: 值本身
                let mo = (await wdt.calcMa(a, 'Open', { intervalSec: 86400 })).find((v) => v.period === '6day')
                let mc = (await wdt.calcMa(a, 'Close', { intervalSec: 86400 })).find((v) => v.period === '6day')
                let rowsO = JSON.parse(fs.readFileSync(fd + 'price_ohlc_Open_param_ma_6day.json', 'utf8'))
                let rowsC = JSON.parse(fs.readFileSync(fd + 'price_ohlc_Close_param_ma_6day.json', 'utf8'))
                assert.strictEqual(rowsO.length, mo.vs.length)
                assert.strictEqual(rowsC.length, mc.vs.length)
                rowsO.forEach((row, i) => {
                    assertNear(row.param, (mo.vs[i].param - 100) / 4, 1e-12, `ma Open row ${i}`)
                })
                rowsC.forEach((row, i) => {
                    assertNear(row.param, mc.vs[i].param, 1e-12, `ma Close row ${i}`)
                })
            })
        })

    })

})
