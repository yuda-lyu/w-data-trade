import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import calcMa from '../src/calcMa.mjs'
import calcVec from '../src/calcVec.mjs'
import calcRsi from '../src/calcRsi.mjs'
import { genOhlc } from './unit-setup.mjs'


//共用層: dataConvert 對拍所需之資料、method 設定與雜湊(unit-dataConvert.test.mjs 取用)
//注意: 本檔不含 describe/it, 不被 runner 當測試檔


//NEW_FIELDS, dataConvert 回傳列於 1.0.66 以後新增之欄位(對拍舊版時去除)
let NEW_FIELDS = ['n', 'median', 'q25', 'q75', 'periods']


//sha, sha256 十六進位
let sha = (buf) => createHash('sha256').update(buf).digest('hex')


//synCalc, 合成之 calc: 各期之尺度與個數皆不同(含 0 根之期與 1 根之期), 各筆之值逐筆相異, 含重尾(每 7 筆一個遠離值)
//  keyOut 為 X 與 Y; 期別 a、b、c 之尺度為 1、25、700 倍
let SYN_PERIODS = [
    { period: 'a', len: 1, mul: 1, n: 40, off: 3 },
    { period: 'b', len: 2, mul: 25, n: 30, off: -2 },
    { period: 'c', len: 3, mul: 700, n: 21, off: 5 },
    { period: 'd', len: 4, mul: 1, n: 0, off: 0 },
    { period: 'e', len: 5, mul: 9, n: 1, off: 1 },
]
let synCalc = async (arr, keyIn, optMethod) => {
    return SYN_PERIODS.map((p, k) => {
        let vs = []
        for (let i = 0; i < p.n; i++) {
            let tail = i % 7 === 0 ? 6 : 0 //重尾
            let x = p.mul * (p.off + Math.sin(i * 1.37 + k) + tail + i * 0.001)
            vs.push({ time: `t${k}_${i}`, X: x, Y: x * 0.5 + p.mul * Math.cos(i * 0.91 + k) })
        }
        return { period: p.period, len: p.len, vs }
    })
}


//KP, 對拍用之 method 對應表
let KP = { ma: calcMa, vec: calcVec, rsi: calcRsi, syn: synCalc }


//methodsOf, 對拍用之 methods(各 deal 之 nm 皆未給 byPeriod)
let methodsOf = (optMethod = {}) => {
    return [
        { method: 'vec', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod },
        { method: 'ma', deals: [{ keyIn: 'Open', keyOut: 'param', nm: { avg: 100, std: 4 } }, { keyIn: 'Close', keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod },
        { method: 'rsi', deals: [{ keyOut: 'RSI', nm: { avg: 50, std: 10 } }], optMethod },
        { method: 'syn', deals: [{ keyOut: 'X', nm: { avg: 3, std: 7 } }, { keyOut: 'Y', nm: { avg: 0, std: 1 } }], optMethod },
    ]
}


//runParityCase, 以指定之 dataConvert 函數跑一組對拍案並回傳 { files: { 檔名: sha256 }, manifest: sha256(檔名清單與各檔雜湊), rows: sha256(回傳列去除新增欄位後之 JSON) }
//  fd 為輸出夾(須存在且為空); id: 'write'(寫檔)、'deny'(denyOutput)、'funAdd'(funAddKeysIn 與 keysIn 兩欄位)、'day'(optMethod.intervalSec 86400)
let runParityCase = async (dataConvertFn, fd, id) => {
    let arr = genOhlc(600)
    let opt = { keysIn: ['Close', 'Open'] }
    let optMethod = {}
    if (id === 'deny') {
        opt.denyOutput = true
    }
    if (id === 'funAdd') {
        opt.funAddKeysIn = (v) => ({ ...v, Open: v.Open * 2 })
    }
    if (id === 'day') {
        optMethod = { intervalSec: 86400 }
    }
    let rs = await dataConvertFn('t', 'SYM', id === 'day' ? '1day' : '4hr', 'price', 'ohlc', methodsOf(optMethod), arr, KP, fd, opt)
    let files = {}
    for (let fn of fs.readdirSync(fd).sort()) {
        files[fn] = sha(fs.readFileSync(path.join(fd, fn)))
    }
    let manifest = sha(JSON.stringify(files))
    let rowsOld = rs.map((r) => {
        let o = { ...r }
        for (let k of NEW_FIELDS) {
            delete o[k]
        }
        return o
    })
    return { files, manifest, rows: sha(JSON.stringify(rowsOld)), nRows: rs.length }
}


export {
    NEW_FIELDS,
    SYN_PERIODS,
    sha,
    synCalc,
    KP,
    methodsOf,
    runParityCase
}
