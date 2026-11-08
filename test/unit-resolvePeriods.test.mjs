import assert from 'assert'
import resolvePeriods, { BARS_PER_DAY_BASE, BARS_PER_DAY_MAX, SCALE_KEYS, barLabelOf, resetWarned } from '../src/resolvePeriods.mjs'


//規格來源: src/resolvePeriods.mjs 之 JSDoc 與 README〈週期換算〉
//  1. 內建週期表以4hr K線為基準(每日6根), opt.barsPerDay(每日根數)對基準6之比值等比換算各期根數並四捨五入(.5進位), 換算後不足1根之期剔除, 全部剔除時throw
//  2. 參數物件只換算len/tenkan/kijun/senkouB, 其餘欄位(如mult)不換算; 任一根數欄不足1根即剔除該期
//  3. 單根型態之表(僅一期且根數為1)不換算根數, 只把標籤改為該K線週期之標籤
//  4. opt.barsPerDay未給或為6時原樣回傳(與既有輸出完全相同); opt.kp給予時直接採用該表不換算
//  5. 輸入檢核(dspec〈輸入參數之檢測機制〉): kp為必須參數, 無效throw; opt.barsPerDay/opt.kp為opt類參數, 非預期之輸入視為未給改用預設, opt.debug為true時警告; 訊息不含傳入之值
//  6. 相鄰週期四捨五入後同根數者不去重, 標籤維持時間語意


//deepFreeze, 供檢驗不改寫呼叫端之輸入
let deepFreeze = (o) => {
    Object.values(o).forEach((v) => {
        if (v !== null && typeof v === 'object') {
            deepFreeze(v)
        }
    })
    return Object.freeze(o)
}

//capture, 以funLog收集警告
let capture = () => {
    let logs = []
    let funLog = (msg, meta) => {
        logs.push({ msg, meta })
    }
    return { logs, funLog }
}


describe('resolvePeriods', function() {

    beforeEach(function() {
        resetWarned()
    })

    describe('常數與標籤', function() {

        it('常數: 基準每日6根、上限86400、換算欄位為len/tenkan/kijun/senkouB', function() {
            //規格1, 2
            assert.strictEqual(BARS_PER_DAY_BASE, 6)
            assert.strictEqual(BARS_PER_DAY_MAX, 86400)
            assert.deepStrictEqual(SCALE_KEYS, ['len', 'tenkan', 'kijun', 'senkouB'])
        })

        it('barLabelOf: 6/24/48/1/96/288/2/4/3/12/1440 等常見每日根數', function() {
            //規格3: 整日Nday、整小時Nhr、整分鐘Nm
            assert.strictEqual(barLabelOf(6), '4hr')
            assert.strictEqual(barLabelOf(24), '1hr')
            assert.strictEqual(barLabelOf(48), '30m')
            assert.strictEqual(barLabelOf(1), '1day')
            assert.strictEqual(barLabelOf(96), '15m')
            assert.strictEqual(barLabelOf(288), '5m')
            assert.strictEqual(barLabelOf(2), '12hr')
            assert.strictEqual(barLabelOf(4), '6hr')
            assert.strictEqual(barLabelOf(3), '8hr')
            assert.strictEqual(barLabelOf(12), '2hr')
            assert.strictEqual(barLabelOf(1440), '1m')
        })

        it('barLabelOf: 小於1之每日根數(多日K線)、整秒、非整分鐘', function() {
            assert.strictEqual(barLabelOf(0.5), '2day')
            assert.strictEqual(barLabelOf(1 / 7), '7day') //浮點誤差不影響
            assert.strictEqual(barLabelOf(86400), '1s')
            assert.strictEqual(barLabelOf(7), '12343s') //86400/7=12342.857秒, 非整分鐘改用秒
        })

        it('barLabelOf: 數字字串視同數值(檢測之值即使用之值)', function() {
            assert.strictEqual(barLabelOf('24'), '1hr')
            assert.strictEqual(barLabelOf(' 48 '), '30m')
        })

        it('barLabelOf: 無效輸入throw, 訊息不含傳入之值', function() {
            let msg = 'invalid barsPerDay: must be a positive number up to 86400'
            let vs = [0, -1, 'x', '', null, undefined, Infinity, NaN, 86401, true, [], {}, 24n]
            vs.forEach((v) => {
                assert.throws(() => barLabelOf(v), { message: msg }, String(typeof v))
            })
            assert.throws(() => barLabelOf('secret99'), (err) => !err.message.includes('secret99') && err.message === msg)
        })

    })

    describe('恆等(未給或barsPerDay=6時原樣回傳)', function() {

        it('未給/空opt/barsPerDay=6(數值、數字字串)皆回傳相同內容之新物件, 鍵序不變', function() {
            //規格4
            let kp = { '12hr': 3, '1day': 6, '7day': 42 }
            let opts = [undefined, {}, null, { barsPerDay: 6 }, { barsPerDay: '6' }, { barsPerDay: ' 6 ' }, { barsPerDay: 6.0 }, { barsPerDay: null }, { barsPerDay: undefined }, { kp: null }]
            opts.forEach((opt, i) => {
                let r = resolvePeriods(kp, opt)
                assert.deepStrictEqual(r, kp, `opts[${i}]`)
                assert.notStrictEqual(r, kp)
                assert.deepStrictEqual(Object.keys(r), ['12hr', '1day', '7day'])
            })
        })

        it('參數物件亦複製, 改動結果不牽動輸入', function() {
            let kp = { '1day': { len: 6, mult: 2 } }
            let r = resolvePeriods(kp)
            assert.deepStrictEqual(r, kp)
            assert.notStrictEqual(r['1day'], kp['1day'])
            r['1day'].len = 999
            assert.strictEqual(kp['1day'].len, 6)
        })

        it('單根型態之表於基準週期仍為{ 4hr: 1 }', function() {
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }), { '4hr': 1 })
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }, { barsPerDay: 6 }), { '4hr': 1 })
        })

    })

    describe('等比換算與四捨五入', function() {

        it('1hr(24根/日)×4、30m(48根/日)×8、5m(288根/日)×48', function() {
            //規格1
            let kp = { '12hr': 3, '20hr': 5, '1day': 6, '7day': 42 }
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 24 }), { '12hr': 12, '20hr': 20, '1day': 24, '7day': 168 })
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 48 }), { '12hr': 24, '20hr': 40, '1day': 48, '7day': 336 })
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 288 }), { '12hr': 144, '20hr': 240, '1day': 288, '7day': 2016 })
        })

        it('6hr K線(4根/日): 3×(4/6)=2, 5×(4/6)=3.33→3, 6×(4/6)=4', function() {
            assert.deepStrictEqual(resolvePeriods({ '12hr': 3, '20hr': 5, '1day': 6 }, { barsPerDay: 4 }), { '12hr': 2, '20hr': 3, '1day': 4 })
        })

        it('.5邊界進位(21÷6=3.5→4, 45÷6=7.5→8), 不因浮點誤差而捨去', function() {
            assert.deepStrictEqual(resolvePeriods({ '7day': 42, 'a': 21, 'b': 45 }, { barsPerDay: 1 }), { '7day': 7, 'a': 4, 'b': 8 })
            assert.deepStrictEqual(resolvePeriods({ '7day': 42, '15day': 90, '1day': 6 }, { barsPerDay: 0.5 }), { '7day': 4, '15day': 8 })
            //每日13根: 27×13÷6精確為58.5, 先除後乘(27×(13/6))於浮點得58.49999999999999而誤捨去, 須先乘後除
            assert.deepStrictEqual(resolvePeriods({ 'a': 27, 'b': 51, 'c': 57 }, { barsPerDay: 13 }), { 'a': 59, 'b': 111, 'c': 124 })
        })

        it('非整數每日根數(7根/日): 3→3.5→4, 5→5.83→6, 6→7, 42→49', function() {
            assert.deepStrictEqual(resolvePeriods({ '12hr': 3, '20hr': 5, '1day': 6, '7day': 42 }, { barsPerDay: 7 }), { '12hr': 4, '20hr': 6, '1day': 7, '7day': 49 })
        })

        it('相鄰週期換算後同根數者保留(不去重), 標籤維持時間語意', function() {
            //規格6
            assert.deepStrictEqual(resolvePeriods({ '12hr': 3, '16hr': 4, '20hr': 5, '1day': 6 }, { barsPerDay: 2 }), { '12hr': 1, '16hr': 1, '20hr': 2, '1day': 2 })
        })

        it('barsPerDay為數字字串時使用轉換值(檢測之值即使用之值)', function() {
            let kp = { '1day': 6, '7day': 42 }
            let r24 = resolvePeriods(kp, { barsPerDay: 24 })
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: '24' }), r24)
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: ' 24 ' }), r24)
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: '2.4e1' }), r24)
        })

        it('上限86400(1秒K線)可用', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { barsPerDay: 86400 }), { '1day': 86400 })
        })

    })

    describe('剔除與全剔除', function() {

        it('不足1根之期剔除: 日K線(1根/日)剔除12hr/16hr/20hr', function() {
            //規格1
            let kp = { '12hr': 3, '16hr': 4, '20hr': 5, '1day': 6, '7day': 42 }
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 1 }), { '1day': 1, '7day': 7 })
        })

        it('邊界: 恰為1根者保留(6×1÷6=1), 0.83根者剔除', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6, '20hr': 5 }, { barsPerDay: 1 }), { '1day': 1 })
        })

        it('全部剔除throw, 訊息不含傳入之值', function() {
            //規格1
            let msg = 'invalid opt.barsPerDay: must keep at least one period of at least 1 bar'
            assert.throws(() => resolvePeriods({ '12hr': 3 }, { barsPerDay: 1 }), { message: msg })
            assert.throws(() => resolvePeriods({ '1day': 6, '2day': 12 }, { barsPerDay: 0.01 }), { message: msg })
            assert.throws(() => resolvePeriods({ '1day': { len: 6, mult: 2 } }, { barsPerDay: 0.01 }), { message: msg })
            assert.throws(() => resolvePeriods({ '12hr': 3 }, { barsPerDay: '0.0123' }), (err) => err.message === msg && !err.message.includes('0.0123'))
        })

    })

    describe('參數物件', function() {

        it('只換算len/tenkan/kijun/senkouB, mult不變且欄位鍵序不變', function() {
            //規格2
            let r = resolvePeriods({ '1day': { len: 6, mult: 1.5 } }, { barsPerDay: 24 })
            assert.deepStrictEqual(r, { '1day': { len: 24, mult: 1.5 } })
            assert.deepStrictEqual(Object.keys(r['1day']), ['len', 'mult'])
            assert.deepStrictEqual(resolvePeriods({ '4day': { tenkan: 4, kijun: 12, senkouB: 24 } }, { barsPerDay: 12 }), { '4day': { tenkan: 8, kijun: 24, senkouB: 48 } })
        })

        it('任一根數欄不足1根即剔除該期(tenkan 4÷6不足1根)', function() {
            let kp = { '4day': { tenkan: 4, kijun: 12, senkouB: 24 }, '7day': { tenkan: 7, kijun: 21, senkouB: 42 } }
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 1 }), { '7day': { tenkan: 1, kijun: 4, senkouB: 7 } })
            assert.deepStrictEqual(resolvePeriods({ '12hr': { len: 3, mult: 2 }, '7day': { len: 42, mult: 2.5 } }, { barsPerDay: 1 }), { '7day': { len: 7, mult: 2.5 } })
        })

    })

    describe('單根型態', function() {

        it('僅一期且根數為1之表只改標籤', function() {
            //規格3
            let kp = { '4hr': 1 }
            let m = { 24: '1hr', 48: '30m', 1: '1day', 96: '15m', 288: '5m', 2: '12hr', 4: '6hr' }
            Object.keys(m).forEach((b) => {
                assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: Number(b) }), { [m[b]]: 1 }, `barsPerDay ${b}`)
            })
        })

        it('非單根型態者不套用: 單期但根數非1、多期含1者照常換算', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { barsPerDay: 24 }), { '1day': 24 })
            assert.deepStrictEqual(resolvePeriods({ '8hr': 2 }, { barsPerDay: 24 }), { '8hr': 8 })
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1, '8hr': 2 }, { barsPerDay: 24 }), { '4hr': 4, '8hr': 8 })
        })

    })

    describe('opt.kp 直接採用', function() {

        it('數值與參數物件原樣採用(新物件), 不換算, 優先於barsPerDay', function() {
            //規格4
            let kpIn = { '3day': 18, 'x': { len: 5, mult: 1 } }
            let r = resolvePeriods({ '1day': 6 }, { kp: kpIn, barsPerDay: 24 })
            assert.deepStrictEqual(r, kpIn)
            assert.notStrictEqual(r, kpIn)
            assert.notStrictEqual(r.x, kpIn.x)
            //barsPerDay=0.01會使內建表全剔除, 但opt.kp優先故不throw
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { '3day': 18 }, barsPerDay: 0.01 }), { '3day': 18 })
        })

        it('數字字串轉為數值(檢測之值即使用之值), 非根數欄位原樣保留', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { '3day': '18', 'x': { len: ' 5 ', mult: 'keep' } } }), { '3day': 18, 'x': { len: 5, mult: 'keep' } })
        })

        it('非預期之opt.kp視為未給, 改用內建表(含barsPerDay換算)', function() {
            //規格5
            let kp = { '1day': 6, '7day': 42 }
            let bads = [
                {}, 'x', 5, true, [1], [],
                { a: 0 }, { a: -1 }, { a: 1.5 }, { a: 'x' }, { a: '' }, { a: '-' }, { a: 'NP' }, { a: 'true' }, { a: '0x10' }, { a: NaN }, { a: null }, { a: true }, { a: Infinity }, { a: 10n }, { a: [1] },
                { a: { len: 0 } }, { a: { len: 1.5 } }, { a: { len: 'x' } }, { a: { tenkan: -1 } }, { a: { kijun: null } }, { a: { senkouB: Infinity } },
                { good: 3, bad: 0 },
            ]
            bads.forEach((bad, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, { kp: bad }), kp, `bads[${i}]`)
                assert.deepStrictEqual(resolvePeriods(kp, { kp: bad, barsPerDay: 24 }), { '1day': 24, '7day': 168 }, `bads[${i}] with barsPerDay`)
            })
        })

        it('opt.kp為null/undefined視為未給', function() {
            let kp = { '1day': 6 }
            assert.deepStrictEqual(resolvePeriods(kp, { kp: null }), kp)
            assert.deepStrictEqual(resolvePeriods(kp, { kp: undefined }), kp)
        })

    })

    describe('輸入檢核', function() {

        it('kp(必須參數)非非空物件throw, 訊息不含傳入之值', function() {
            let msg = 'invalid kp: must be a non-empty object'
            let vs = [null, undefined, {}, [], 'x', 5, true, () => {}]
            vs.forEach((v) => {
                assert.throws(() => resolvePeriods(v), { message: msg })
                assert.throws(() => resolvePeriods(v, { barsPerDay: 24 }), { message: msg })
            })
            assert.throws(() => resolvePeriods('secret99'), (err) => !err.message.includes('secret99'))
        })

        it('kp之值非正整數或物件throw, 訊息只帶週期標籤', function() {
            let vs = ['x', 0, 1.5, -1, null, [1], true, Infinity]
            vs.forEach((v) => {
                assert.throws(() => resolvePeriods({ '1day': v }), { message: 'invalid kp[1day]: must be a positive integer or an object' })
            })
        })

        it('opt.barsPerDay非預期之輸入視為未給, 改用預設(不換算)', function() {
            //規格5
            let kp = { '1day': 6, '7day': 42 }
            let bads = [0, -1, -24, 'abc', '', ' ', '-', 'NP', 'true', '0x18', '1,024', 'Infinity', Infinity, -Infinity, NaN, true, false, [], [24], {}, Object(24), 24n, 86401, '1e400', '1e-400']
            bads.forEach((bad, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: bad }), kp, `bads[${i}]`)
            })
        })

        it('opt非物件視為未給(不throw)', function() {
            let kp = { '1day': 6 }
            let bads = [5, 'abc', true, [], () => {}, 24n]
            bads.forEach((bad, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, bad), kp, `bads[${i}]`)
            })
        })

        it('不改寫呼叫端之輸入(kp與opt凍結後仍可執行)', function() {
            let kp = deepFreeze({ '1day': 6, 'x': { len: 6, mult: 2 } })
            let opt = deepFreeze({ barsPerDay: 24 })
            assert.deepStrictEqual(resolvePeriods(kp, opt), { '1day': 24, 'x': { len: 24, mult: 2 } })
            let optKp = deepFreeze({ kp: { '3day': 18, 'y': { len: 5 } } })
            assert.deepStrictEqual(resolvePeriods(kp, optKp), { '3day': 18, 'y': { len: 5 } })
        })

    })

    describe('opt.debug 警告', function() {

        it('barsPerDay非預期且debug為true: 經funLog輸出固定詞彙警告, 不含傳入之值, 每個鍵只警告一次', function() {
            let { logs, funLog } = capture()
            let kp = { '1day': 6 }
            let r1 = resolvePeriods(kp, { barsPerDay: 'abc123', debug: true, funLog })
            let r2 = resolvePeriods(kp, { barsPerDay: 'abc123', debug: true, funLog })
            assert.deepStrictEqual(r1, kp)
            assert.deepStrictEqual(r2, kp)
            assert.strictEqual(logs.length, 1)
            assert.strictEqual(logs[0].msg, '[w-data-trade resolvePeriods] invalid opt.barsPerDay: must be a positive number up to 86400, using default 6')
            assert.deepStrictEqual(logs[0].meta, { fn: 'resolvePeriods', reason: 'invalid', key: 'opt.barsPerDay' })
            assert.ok(!logs[0].msg.includes('abc123'))
        })

        it('opt.kp非預期且debug為true: 警告不含傳入之值; barsPerDay與kp各自警告', function() {
            let { logs, funLog } = capture()
            resolvePeriods({ '1day': 6 }, { kp: { secretLabel: 0 }, barsPerDay: 0, debug: true, funLog })
            assert.strictEqual(logs.length, 2)
            assert.deepStrictEqual(logs.map((v) => v.meta.key), ['opt.kp', 'opt.barsPerDay'])
            assert.ok(/^\[w-data-trade resolvePeriods\] invalid opt\.kp: must be a non-empty object/.test(logs[0].msg))
            assert.ok(logs.every((v) => !v.msg.includes('secretLabel')))
        })

        it('debug非true(未給/false/字串/1)不警告', function() {
            let { logs, funLog } = capture()
            let ds = [undefined, false, 'true', 1, null, {}]
            ds.forEach((debug) => {
                resolvePeriods({ '1day': 6 }, { barsPerDay: 'abc', kp: 'x', debug, funLog })
            })
            assert.strictEqual(logs.length, 0)
        })

        it('輸入有效時debug為true也不警告', function() {
            let { logs, funLog } = capture()
            resolvePeriods({ '1day': 6 }, { barsPerDay: 24, kp: undefined, debug: true, funLog })
            resolvePeriods({ '1day': 6 }, { kp: { '3day': 18 }, debug: true, funLog })
            assert.strictEqual(logs.length, 0)
        })

        it('未給funLog時改用console.warn; funLog拋錯一律忽略; resetWarned後可再警告', function() {
            let kp = { '1day': 6 }
            let warns = []
            let orig = console.warn
            console.warn = (msg) => {
                warns.push(msg)
            }
            try {
                resolvePeriods(kp, { barsPerDay: 'abc', debug: true })
                assert.strictEqual(warns.length, 1)
                assert.ok(warns[0].startsWith('[w-data-trade resolvePeriods] invalid opt.barsPerDay'))
                resolvePeriods(kp, { barsPerDay: 'abc', debug: true })
                assert.strictEqual(warns.length, 1)
                resetWarned()
                resolvePeriods(kp, { barsPerDay: 'abc', debug: true })
                assert.strictEqual(warns.length, 2)
            }
            finally {
                console.warn = orig
            }
            resetWarned()
            let thrower = () => {
                throw new Error('boom')
            }
            assert.deepStrictEqual(resolvePeriods(kp, { barsPerDay: 'abc', debug: true, funLog: thrower }), kp)
        })

    })

})
