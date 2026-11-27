import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as acorn from 'acorn'
import wdt from '../src/WDataTrade.mjs'
import pickValue from '../src/pickValue.mjs'
import dataCalibrate from '../src/dataCalibrate.mjs'
import { genOhlc } from './unit-setup.mjs'


//規格來源: 跨套件規格〈輸入參數之檢測機制〉V19(訊息格式 `invalid <名稱>: must be <種類描述>`)、V20(訊息與 console 皆不回顯輸入值; 名稱以位置定位, 陣列帶索引)與排程第 694 項
//  E1 各 calc 逐根檢核 K 線欄位(`isNumber`)之訊息為 `invalid arr[i].<欄名>: must be a number`: i 為持有無效值之那一根(前一根之欄位用 i - 1), 不含輸入值, 不呼叫輸入值之 toString(符號、BigInt、toString 拋錯之物件亦同), 不以 console 輸出
//  E2 `pickValue` 之量級防呆訊息為 `invalid arr[i][key]: must be a number with an absolute value of at most 1e15`
//  E3 `dataCalibrate` 之 pairs 元素之訊息為 `invalid pairs[i].keyOutSrc|keyOutRef: must be a non-empty string`
//  E4 src 內不得有 console 之使用(排程第 694 項件 2: 原 `calcMacd` 之 4 行除錯輸出)
//  E5 src 內 `new Error(...)` 之實參只能為字串字面值、`MSG_*` 常數或樣板字串, 樣板內之運算式只能為位置(索引、鍵名)且逐檔釘住(新增、消失皆使測試失敗, 迫使逐項審查); `throw` 之對象只能為 `new Error(...)`
//  掃描器本身有盲點自測(夾具字串, 見〈E5 掃描器自測〉), 且先對已知正例驗過再採信空結果


let SENT = 'SENT-9f2c41'
let rootSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')


//BADS, 非數值之各種輸入(lodash isNumber 為 false 者): 含不得被呼叫 toString 之物件與符號、BigInt
let BADS = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['字串', () => SENT],
    ['數字字串', () => '123.5'],
    ['布林', () => true],
    ['陣列', () => [SENT]],
    ['物件', () => ({ k: SENT })],
    ['toString拋錯之物件', () => ({
        toString() {
            throw new Error(`boom-${SENT}`)
        },
    })],
    ['符號', () => Symbol(SENT)],
    ['BigInt', () => 10n],
]


//mute, 執行 fn 期間攔截 console 全部方法, 回傳 { r, outs }
let mute = async (fn) => {
    let names = Object.keys(console).filter((k) => typeof console[k] === 'function')
    let orgs = {}
    let outs = []
    names.forEach((k) => {
        orgs[k] = console[k]
        console[k] = (...a) => {
            outs.push([k, a])
        }
    })
    let r = { err: null, val: null }
    try {
        r.val = await fn()
    }
    catch (e) {
        r.err = e
    }
    finally {
        names.forEach((k) => {
            console[k] = orgs[k]
        })
    }
    return { r, outs }
}


//ROWS, 各 calc 逐根檢核之站點: spec[欄名] = 持有無效值之索引 k 之清單(皆為該欄於該 calc 實際被檢核之索引; 訊息之索引須等於 k)
//  n 為資料根數; 各清單之取法: 區間兩端與中間(某些欄之第 0 根不被檢核, 如 calcAtr 之 High、Low)
let ROWS = [
    { calc: 'calcAdx', n: 40, spec: { High: [0, 1, 20, 39], Low: [0, 1, 20, 39], Close: [0, 20, 38] } },
    { calc: 'calcAtr', n: 40, spec: { High: [1, 20, 39], Low: [1, 20, 39], Close: [0, 20, 38] } },
    { calc: 'calcAts', n: 40, spec: { QuoteAssetVolume: [0, 20, 39], NumberOfTrades: [0, 20, 39] } },
    { calc: 'calcBbpb', n: 40, spec: { Close: [0, 20, 39] } },
    { calc: 'calcCandle', n: 40, spec: { Open: [1, 20, 39], High: [1, 20, 39], Low: [1, 20, 39], Close: [1, 20, 39] } },
    { calc: 'calcCvd', n: 40, spec: { Volumn: [0, 20, 39], TakerBuyBaseAssetVolume: [0, 20, 39] } },
    { calc: 'calcDonchian', n: 40, spec: { High: [7, 20, 39], Low: [7, 20, 39], Close: [7, 20, 39] } },
    { calc: 'calcIchimoku', n: 400, spec: { Close: [399] } },
    { calc: 'calcKdj', n: 40, spec: { High: [0, 20, 39], Low: [0, 20, 39], Close: [0, 20, 39] } },
    { calc: 'calcKeltner', n: 40, spec: { High: [1, 20, 39], Low: [1, 20, 39], Close: [0, 7, 20, 38, 39] } },
    { calc: 'calcMfi', n: 40, spec: { High: [0, 20, 39], Low: [0, 20, 39], Close: [0, 20, 39], Volumn: [0, 20, 39] } },
    { calc: 'calcObv', n: 40, spec: { Close: [0, 20, 39], Volumn: [1, 20, 39] } },
    { calc: 'calcRsi', n: 40, spec: { Close: [0, 3, 20, 39] } },
    { calc: 'calcSupertrend', n: 40, spec: { High: [1, 20, 39], Low: [1, 20, 39], Close: [0, 20, 38, 39] } },
    { calc: 'calcVortex', n: 40, spec: { High: [0, 1, 20, 39], Low: [0, 1, 20, 39], Close: [0, 20, 38] } },
    { calc: 'calcVwap', n: 40, spec: { High: [0, 1, 20, 39], Low: [0, 1, 20, 39], Close: [0, 20, 38, 39], Volumn: [0, 20, 39] } },
]


describe('固定訊息(排程第 694 項件 1、2: V19、V20)', function() {

    describe('E1 各 calc 逐根檢核 K 線欄位之訊息', function() {

        ROWS.forEach(({ calc, n, spec }) => {
            it(`${calc}: 欄位非數值 ⇒ reject 固定訊息 invalid arr[i].欄名: must be a number(i 為持有無效值之根)、不含輸入值、不呼叫 toString、不以 console 輸出`, async function() {
                let base = genOhlc(n)
                let nCase = 0
                for (let [field, ks] of Object.entries(spec)) {
                    for (let k of ks) {
                        for (let [tag, mk] of BADS) {
                            let arr = base.map((v) => ({ ...v }))
                            arr[k][field] = mk()
                            let { r, outs } = await mute(() => wdt[calc](arr, 'Close'))
                            let exp = `invalid arr[${k}].${field}: must be a number`
                            let label = `${calc} ${field}[${k}] ${tag}`
                            assert.ok(r.err !== null, `${label}: 應 reject`)
                            assert.ok(r.err.message === exp, `${label}: 訊息(實際 ${r.err.message})`)
                            assert.ok(!r.err.message.includes(SENT), `${label}: 訊息不含輸入值`)
                            assert.ok(outs.length === 0, `${label}: 不得以 console 輸出(實際 ${outs.length} 則)`)
                            nCase++
                        }
                    }
                }
                assert.ok(nCase > 0)
            })
        })

        it('calcKeltner: 恰 len + 1 根且最末根之 Close 無效 ⇒ 由 arr[len] 之檢核攔下(索引為 len)', async function() {
            //該站(`cAtLen`)只於 n = len + 1 時可達: 其前之逐根檢核涵蓋 arr[0..n-2], 本案之無效值在 arr[n-1]
            let len = (await wdt.calcKeltner(genOhlc(60), 'Close'))[0].len
            let arr = genOhlc(len + 1)
            arr[len].Close = null
            let { r, outs } = await mute(() => wdt.calcKeltner(arr, 'Close'))
            assert.ok(r.err !== null && r.err.message === `invalid arr[${len}].Close: must be a number`, `訊息(實際 ${r.err && r.err.message})`)
            assert.strictEqual(outs.length, 0)
        })

        it('有效資料不受影響(各 calc 之合法輸入不 reject、不以 console 輸出)', async function() {
            for (let { calc, n } of ROWS) {
                let { r, outs } = await mute(() => wdt[calc](genOhlc(n), 'Close'))
                assert.ok(r.err === null, `${calc} 不應 reject`)
                assert.ok(Array.isArray(r.val) && r.val.length > 0, `${calc} 應有結果`)
                assert.ok(outs.length === 0, `${calc} 不得以 console 輸出`)
            }
        })

        it('calcMacd: 有效與各種無效輸入皆不以 console 輸出(原 4 行除錯輸出已移除)', async function() {
            let arr = genOhlc(120)
            let cases = [arr, genOhlc(10), [], null, undefined, 'x', [{ time: 't', Close: SENT }], arr.map((v, i) => (i === 30 ? { ...v, Close: null } : v))]
            for (let [i, a] of cases.entries()) {
                let { outs } = await mute(() => wdt.calcMacd(a, 'Close'))
                assert.ok(outs.length === 0, `case ${i}: 不得以 console 輸出`)
            }
        })

    })

    describe('E2 pickValue 量級防呆之訊息', function() {

        let MSG = (i) => `invalid arr[${i}][key]: must be a number with an absolute value of at most 1e15`

        it('越界之值於 arr[i] ⇒ 訊息帶實際索引 i(含被剔除之列之後)、不含輸入值', function() {
            let arr = [
                { time: 't0', Close: 1 },
                { time: 't1', Close: 'x' }, //被剔除(非數值)仍佔索引
                { time: 5, Close: 7 }, //被剔除(time 非字串)仍佔索引
                { time: 't3', Close: 1e16 },
            ]
            assert.throws(() => pickValue(arr, 'Close'), { message: MSG(3) })
            let arr2 = [{ time: 't0', Close: 2 }, { time: 't1', Close: '-1e20' }]
            assert.throws(() => pickValue(arr2, 'Close'), { message: MSG(1) })
            let arr3 = [{ time: 't0', Close: Infinity }]
            assert.throws(() => pickValue(arr3, 'Close'), { message: MSG(0) })
        })

        it('訊息不含越界之值(數字、數字字串、±Infinity 皆然)', function() {
            for (let v of [1e16, -1e16, '1234567890123456789', '1e16', Infinity, -Infinity]) {
                let err = null
                try {
                    pickValue([{ time: 't0', Close: v }], 'Close')
                }
                catch (e) {
                    err = e
                }
                assert.ok(err !== null, '應拋錯')
                assert.ok(err.message === MSG(0), `訊息(實際 ${err.message})`)
                assert.ok(!/\d{4}|Infinity/.test(err.message.replace('1e15', '')), '訊息不含越界之值')
            }
        })

    })

    describe('E3 dataCalibrate 之 pairs 元素之訊息', function() {

        let calcFn = async () => []
        let arr = [{ time: 't', u: 1 }]

        it('keyOutSrc、keyOutRef 無效(含符號、toString 拋錯之物件)⇒ reject 固定訊息、含元素索引、不含輸入值、calcFn 未被呼叫', async function() {
            let called = 0
            let fn = async () => {
                called++
                return []
            }
            //非字串之各種輸入(字串與數字字串為有效之非空字串, 不在此列)
            for (let [tag, mk] of BADS.filter(([t]) => t !== '字串' && t !== '數字字串')) {
                let r1 = await mute(() => dataCalibrate(fn, arr, arr, ['X', { keyOutSrc: mk(), keyOutRef: 'X' }], { a: 0 }))
                assert.ok(r1.r.err !== null && r1.r.err.message === 'invalid pairs[1].keyOutSrc: must be a non-empty string', `Src ${tag}(實際 ${r1.r.err && r1.r.err.message})`)
                assert.ok(!r1.r.err.message.includes(SENT) && r1.outs.length === 0, `Src ${tag}: 不含輸入值、不以 console 輸出`)
                let r2 = await mute(() => dataCalibrate(fn, arr, arr, [{ keyOutSrc: 'X', keyOutRef: mk() }], { a: 0 }))
                assert.ok(r2.r.err !== null && r2.r.err.message === 'invalid pairs[0].keyOutRef: must be a non-empty string', `Ref ${tag}(實際 ${r2.r.err && r2.r.err.message})`)
                assert.ok(!r2.r.err.message.includes(SENT) && r2.outs.length === 0, `Ref ${tag}: 不含輸入值、不以 console 輸出`)
            }
            assert.strictEqual(called, 0)
            //空字串亦為無效
            let r3 = await mute(() => dataCalibrate(calcFn, arr, arr, [{ keyOutSrc: '', keyOutRef: 'X' }], { a: 0 }))
            assert.strictEqual(r3.r.err.message, 'invalid pairs[0].keyOutSrc: must be a non-empty string')
        })

    })

})


//scanSrc, 以 acorn 解析 src 內各檔, 蒐集: Error 之實參(種類與樣板內運算式之原文)、console 之使用、throw 之對象種類
let scanCode = (code) => {
    let ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
    let errArgs = [] //{ kind, exprs }
    let consoles = 0
    let throws = [] //{ kind }
    let walk = (node, parent, key) => {
        if (node === null || typeof node !== 'object') {
            return
        }
        if (Array.isArray(node)) {
            node.forEach((c) => walk(c, parent, key))
            return
        }
        if (typeof node.type !== 'string') {
            return
        }
        if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && /^(Error|TypeError|RangeError|SyntaxError|EvalError|ReferenceError|URIError|AggregateError)$/.test(node.callee.name)) {
            let a = node.arguments[0]
            if (a === undefined) {
                errArgs.push({ kind: 'None', exprs: [] })
            }
            else if (a.type === 'TemplateLiteral') {
                errArgs.push({ kind: 'Template', exprs: a.expressions.map((e) => code.slice(e.start, e.end)) })
            }
            else if (a.type === 'Literal' && typeof a.value === 'string') {
                errArgs.push({ kind: 'Literal', exprs: [] })
            }
            else if (a.type === 'Identifier' && /^MSG_[A-Z_]+$/.test(a.name)) {
                errArgs.push({ kind: 'Const', exprs: [] })
            }
            else {
                errArgs.push({ kind: `Other:${a.type}`, exprs: [] })
            }
        }
        if (node.type === 'Identifier' && node.name === 'console') {
            let isProp = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed
            let isKey = parent && parent.type === 'Property' && key === 'key' && !parent.computed
            if (!isProp && !isKey) {
                consoles++
            }
        }
        if (node.type === 'ThrowStatement') {
            throws.push({ kind: node.argument.type === 'NewExpression' ? 'New' : `Other:${node.argument.type}` })
        }
        for (let k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') {
                continue
            }
            walk(node[k], node, k)
        }
    }
    walk(ast, null, null)
    return { errArgs, consoles, throws }
}


//EXPRS, 各檔 `new Error(樣板)` 內運算式之清單(釘住: 皆為位置: 索引 i、i - 1、j、len(arr[...] 之索引)、物件之鍵名 period(`resolvePeriods` 之 kp 為物件, 鍵名為位置, V20 之①)); 新增或消失皆使測試失敗
let EXPRS = {
    'calcAdx.mjs': ['i', 'i', 'i - 1', 'i - 1', 'i - 1'],
    'calcAtr.mjs': ['i', 'i', 'i - 1'],
    'calcAts.mjs': ['i', 'i'],
    'calcBbpb.mjs': ['i'],
    'calcCandle.mjs': ['i', 'i', 'i', 'i'],
    'calcCvd.mjs': ['i', 'i'],
    'calcDonchian.mjs': ['j', 'j', 'i'],
    'calcIchimoku.mjs': ['i'],
    'calcKdj.mjs': ['i', 'i', 'i'],
    'calcKeltner.mjs': ['i', 'i', 'i - 1', 'i', 'len', 'i'],
    'calcMfi.mjs': ['i', 'i', 'i', 'i'],
    'calcObv.mjs': ['i', 'i - 1', 'i'],
    'calcRsi.mjs': ['i - 1', 'i'],
    'calcSupertrend.mjs': ['i', 'i', 'i - 1', 'i'],
    'calcVortex.mjs': ['i', 'i', 'i - 1', 'i - 1', 'i - 1'],
    'calcVwap.mjs': ['i', 'i', 'i - 1', 'i', 'i', 'i', 'i'],
    'dataCalibrate.mjs': ['i', 'i'],
    'dataConvert.mjs': ['i', 'i', 'i', 'i', 'i', 'i'],
    'pickValue.mjs': ['i'],
    'resolvePeriods.mjs': ['period', 'period'],
}


describe('src 之原始碼掃描(排程第 694 項件 1、2)', function() {

    let files = fs.readdirSync(rootSrc).filter((f) => f.endsWith('.mjs')).sort()
    let scans = {}
    files.forEach((f) => {
        scans[f] = scanCode(fs.readFileSync(path.join(rootSrc, f), 'utf8'))
    })

    describe('E5 掃描器自測(盲點寫法各一正例)', function() {

        it('Error 實參: 樣板之運算式、字面值、MSG_ 常數、其他(字串相加、函數呼叫、成員、變數)皆被分類', function() {
            let s = scanCode([
                `let a = new Error(\`x \${i} y \${j - 1}\`)`,
                `let b = new Error('lit')`,
                `let c = new Error(MSG_ABC)`,
                `let d = new Error('a' + v)`,
                `let e = new Error(String(v))`,
                `let f = new Error(err.message)`,
                `let g = new TypeError(msg)`,
                `let h = new Error()`,
                `let k = new Error(\`\${v}\`)`,
            ].join('\n'))
            assert.deepStrictEqual(s.errArgs.map((v) => v.kind), ['Template', 'Literal', 'Const', 'Other:BinaryExpression', 'Other:CallExpression', 'Other:MemberExpression', 'Other:Identifier', 'None', 'Template'])
            assert.deepStrictEqual(s.errArgs[0].exprs, ['i', 'j - 1'])
            assert.deepStrictEqual(s.errArgs[8].exprs, ['v'])
        })

        it('console: 呼叫、別名、解構、括號存取皆計入; 屬性名與物件鍵名不計', function() {
            let s = scanCode([
                `console.log('a')`,
                `let c = console`,
                `let { log } = console`,
                `console['warn']('x')`,
                `let o = { console: 1 }`,
                `let p = o.console`,
                `// console.log(1)`,
                `/* console.log(2) */`,
                `let s = 'console.log(3)'`,
            ].join('\n'))
            assert.strictEqual(s.consoles, 4)
        })

        it('throw: new 以外之對象(變數、呼叫、成員)被分類', function() {
            let s = scanCode('function f() { throw new Error("a") }\nfunction g(e) { throw e }\nfunction h(e) { throw wrap(e) }\nfunction k(e) { throw e.cause }')
            assert.deepStrictEqual(s.throws.map((v) => v.kind), ['New', 'Other:Identifier', 'Other:CallExpression', 'Other:MemberExpression'])
        })

    })

    it('掃描範圍: src 內 .mjs 檔 35 個、其中含 new Error 者皆已掃到(先驗已知正例再採信空結果)', function() {
        assert.strictEqual(files.length, 35, `掃描檔數(實際 ${files.length})`)
        assert.ok(scans['calcAtr.mjs'].errArgs.length >= 4, 'calcAtr 應掃到 Error 站點')
        assert.deepStrictEqual(scans['calcAtr.mjs'].errArgs.filter((v) => v.kind === 'Template' && v.exprs.length > 0).map((v) => v.exprs[0]), ['i', 'i', 'i - 1'])
        assert.ok(scans['dataConvert.mjs'].errArgs.length >= 10)
    })

    it('E4 src 內無 console 之使用(含別名、解構、括號存取; 註解與 JSDoc 範例不計)', function() {
        let bad = files.filter((f) => scans[f].consoles > 0).map((f) => `${f}:${scans[f].consoles}`)
        assert.deepStrictEqual(bad, [])
    })

    it('E5 `new Error(...)` 之實參只能為字串字面值、MSG_* 常數或樣板字串', function() {
        let bad = []
        files.forEach((f) => {
            scans[f].errArgs.forEach((a) => {
                if (!['Template', 'Literal', 'Const'].includes(a.kind)) {
                    bad.push(`${f}:${a.kind}`)
                }
            })
        })
        assert.deepStrictEqual(bad, [])
    })

    it('E5 樣板之運算式逐檔釘住(皆為位置: 索引或鍵名; 不得為輸入值)', function() {
        let got = {}
        files.forEach((f) => {
            let ex = []
            scans[f].errArgs.forEach((a) => {
                if (a.kind === 'Template') {
                    ex.push(...a.exprs)
                }
            })
            if (ex.length > 0) {
                got[f] = ex.sort()
            }
        })
        let exp = {}
        Object.keys(EXPRS).forEach((f) => {
            exp[f] = [...EXPRS[f]].sort()
        })
        assert.deepStrictEqual(got, exp)
    })

    it('E5 `throw` 之對象一律為 new Error(...)(不重拋他處之錯誤、不拋非 Error 之值)', function() {
        let bad = []
        files.forEach((f) => {
            scans[f].throws.forEach((t) => {
                if (t.kind !== 'New') {
                    bad.push(`${f}:${t.kind}`)
                }
            })
        })
        assert.deepStrictEqual(bad, [])
    })

})
