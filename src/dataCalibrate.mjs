import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import keys from 'lodash-es/keys.js'
import size from 'lodash-es/size.js'
import every from 'lodash-es/every.js'
import each from 'lodash-es/each.js'
import sum from 'lodash-es/sum.js'
import range from 'lodash-es/range.js'
import sumBy from 'lodash-es/sumBy.js'
import mean from 'lodash-es/mean.js'
import uniq from 'lodash-es/uniq.js'
import isfun from 'wsemi/src/isfun.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import iseint from 'wsemi/src/iseint.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import { readIntervalSec } from './resolvePeriods.mjs'


//各opt鍵之預設值(與getOptReader之警告用之預設描述)
const MAGS_DEF = [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3]
const THRESHOLD_DEF = 0.15
const THRESHOLD_ABS_DEF = 0.01

//MSG_PARAMS、MSG_KEY_IN, opt.params與opt.keyIn給了而無效(含讀取拋錯)時之固定訊息(不含輸入值)
const MSG_PARAMS = 'invalid opt.params: must be a non-empty array of non-empty strings'
const MSG_KEY_IN = 'invalid opt.keyIn: must be a non-empty string'


//readKey, 讀opt之鍵: opt為物件或函數才讀(否則視為未給); 讀取拋錯照拋, 由呼叫端轉為固定訊息(K3之例外鍵: 讀取拋錯視為給了而無效, 不可如getOptReader視為未給)
let readKey = (opt, key) => {
    return ((typeof opt === 'object' && opt !== null) || typeof opt === 'function') ? opt[key] : undefined
}


/**
 * 校正calc函式之optMethod: 搜尋參數，使來源側(src)各keyOut之z-score分布形狀對齊參考側(ref)對應keyOut
 *
 * 本專案用例: src=溢價指數(index) OHLC，ref=價格(price) OHLC，校正index系變換偏移量
 * 搜尋為逐維座標下降: 每維先粗掃(現值+0+正負mags量級)，再以粗掃最佳為中心做倍率細化與微調
 * 防churn: 需(score0-scoreBest)/score0 > threshold，且(score0-scoreBest) > thresholdAbs，兩者皆達門檻才採納搜尋結果，否則optMethod維持optMethodInit
 * opt.params與opt.keyIn決定搜尋之參數與傳入calcFn之欄位，屬跨套件規格K3之例外：給了而無效即reject固定訊息(不含輸入值)、不改用預設；其餘opt鍵經wsemi之getOptReader宣告(K3、K4、V11)：非預期之opt輸入視為未給、改用預設
 * optMethodInit與opt.optMethodRef之intervalSec(每根秒數，見resolvePeriods)給了而無效時，於任何計算(calcFn之呼叫)之前即reject(訊息同calc)；未給時行為與既有相同；intervalSec為固定之每根時長，不是校正參數，須以opt.params排除(預設params為optMethodInit全部鍵)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-dataCalibrate.test.mjs Github}
 * @function
 * @param {Function} calcFn 輸入指標計算函式，簽章為(arr,keyIn,optMethod)=>rrs(各期{period,vs:[{time,...keyOuts}]}之陣列，可回傳Promise)
 * @param {Array} arrSrc 輸入來源側(src)之K線陣列
 * @param {Array} arrRef 輸入參考側(ref)之K線陣列
 * @param {Array} pairs 輸入兩側keyOut對應表，元素為{keyOutSrc,keyOutRef}物件或字串(代表兩側同名之縮寫)，元素之keyOutSrc、keyOutRef須為非空字串，否則reject固定訊息`invalid pairs[i].keyOutSrc: must be a non-empty string`或`invalid pairs[i].keyOutRef: must be a non-empty string`(i為元素之索引，不含輸入值)
 * @param {Object} optMethodInit 輸入現行optMethod(搜尋起點與防churn比較基準)，params中不存在之鍵搜尋時以0起算
 * @param {Object} [opt={}] 輸入設定物件，預設{}；每鍵只讀一次、給了即檢測。params與keyIn外之各鍵：非預期之輸入(型別或範圍不符)視為未給而改用預設、不reject，opt.debug恰為true時每個鍵每個行程警告一次(固定詞彙、不含傳入之值，出口為opt.funLog或console.warn)，鍵之讀取拋錯視為未給，數字類檢測通過之數字字串轉為數值後使用；params與keyIn屬K3之例外，給了而無效即reject(見各鍵)
 * @param {Array} [opt.params=keys(optMethodInit)] 輸入要校正之參數名陣列，預設為optMethodInit全部鍵；未給(undefined、null)取預設，給了須為非空陣列且元素皆為非空字串，否則(含鍵或元素之讀取拋錯)於任何計算之前reject `invalid opt.params: must be a non-empty array of non-empty strings`
 * @param {String} [opt.keyIn='none'] 輸入傳入calcFn之keyIn，預設'none'；未給(undefined、null)取預設，給了須為非空字串，否則(含鍵之讀取拋錯)於任何計算之前reject `invalid opt.keyIn: must be a non-empty string`
 * @param {Object} [opt.optMethodRef={}] 輸入參考側呼叫calcFn所用之optMethod，須為物件(可為空物件)，預設{}
 * @param {Array} [opt.mags=[1e-4,3e-4,1e-3,3e-3,0.01,0.03,0.1,0.3]] 輸入粗掃量級階梯(正值，內部自動含正負與0)，須為陣列(可為空陣列)且元素皆為有效數字(數字字串轉為數值)
 * @param {Number|String} [opt.threshold=0.15] 輸入採納門檻(相對改善比例)，須為有效數字，預設0.15
 * @param {Number|String} [opt.thresholdAbs=0.01] 輸入採納門檻(絕對改善量)，須為有效數字，預設0.01
 * @param {Number|String} [opt.nSweep] 輸入逐維掃描輪數，須為不小於0之整數(0為不搜尋)，預設單參數為1輪，多參數為2輪
 * @param {Function} [opt.funLog] 輸入搜尋進度回呼函式(msg)，可選；opt.debug為true時亦為警告之出口(以(msg, { fn, reason, key })呼叫，fn為'w-data-trade dataCalibrate')
 * @returns {Promise} 回傳Promise，resolve為{adopt,optMethod,optMethodBest,score0,scoreBest,nEval,detail}，adopt為是否採納搜尋結果之布林值，optMethod為依防churn判定之最終值(adopt=false時即optMethodInit)，optMethodBest為搜尋所得最佳值(不論是否採納)，score0為起始參數之目標函數值，scoreBest為搜尋所得最佳目標函數值，nEval為calcFn對arrSrc之實際評估次數，detail為各pair於最終optMethod下之形狀對照陣列，各元素為{keyOutSrc,keyOutRef,dist,pNearZeroSrc,pNearZeroRef}
 * @example
 *
 * let mkArr = (n) => {
 *     let arr = []
 *     for (let i = 0; i < n; i++) {
 *         arr.push({ time: `t${i}`, u: Math.sin(i * 1.7) })
 *     }
 *     return arr
 * }
 *
 * let calcFn = async (arr, keyIn, optMethod) => {
 *     let a = optMethod.a !== undefined ? optMethod.a : 0
 *     let vs = arr.map((v) => {
 *         let x = v.u + a * v.u * v.u
 *         return { time: v.time, X: x }
 *     })
 *     return [{ period: 'p1', len: 1, vs }]
 * }
 *
 * let arr = mkArr(400)
 *
 * dataCalibrate(calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
 *     .then((r) => {
 *         console.log(r)
 *         // => {
 *         //   adopt: true,
 *         //   optMethod: { a: 0.1 },
 *         //   optMethodBest: { a: 0.1 },
 *         //   score0: 0.0478199962161957,
 *         //   scoreBest: 0,
 *         //   nEval: 26,
 *         //   detail: [
 *         //     { keyOutSrc: 'X', keyOutRef: 'X', dist: 0, pNearZeroSrc: 0.0425, pNearZeroRef: 0.0425 }
 *         //   ]
 *         // }
 *     })
 *
 */
let dataCalibrate = async (calcFn, arrSrc, arrRef, pairs, optMethodInit, opt = {}) => {

    //check
    if (!isfun(calcFn)) {
        throw new Error(`invalid calcFn`)
    }
    if (!isearr(arrSrc)) {
        throw new Error(`invalid arrSrc`)
    }
    if (!isearr(arrRef)) {
        throw new Error(`invalid arrRef`)
    }
    if (!isearr(pairs)) {
        throw new Error(`invalid pairs`)
    }
    if (!iseobj(optMethodInit)) {
        throw new Error(`invalid optMethodInit`)
    }

    //ps: 正規化 pairs(字串縮寫展開)並逐元素檢核
    //  pairs為必須參數, 各元素無效即拒; 訊息為固定詞彙(位置與期望之種類, 不含輸入值; 跨套件規格V19、V20)
    let ps = map(pairs, (p, i) => {
        if (isestr(p)) {
            return { keyOutSrc: p, keyOutRef: p }
        }
        let keyOutSrc = get(p, 'keyOutSrc')
        let keyOutRef = get(p, 'keyOutRef')
        if (!isestr(keyOutSrc)) {
            throw new Error(`invalid pairs[${i}].keyOutSrc: must be a non-empty string`)
        }
        if (!isestr(keyOutRef)) {
            throw new Error(`invalid pairs[${i}].keyOutRef: must be a non-empty string`)
        }
        return { keyOutSrc, keyOutRef }
    })

    //opt, 除params與keyIn外之各鍵經getOptReader讀取(每鍵只讀一次; 給了即檢測, 非預期之輸入視為未給而改用預設, opt.debug為true時警告; 跨套件規格K3、K4、V11)
    //  數字類檢測通過之數字字串轉為數值後使用(K4); 陣列類於檢測時取一份快照, 其後只用快照(檢測之值即使用之值)
    let rd = getOptReader('w-data-trade dataCalibrate', opt)

    //params與keyIn決定搜尋之參數與傳入calcFn之欄位, 屬跨套件規格K3之例外(決定資料口徑之opt): 未給(undefined、null)取預設; 給了而無效即拒, 不改用預設(改用預設會得到看似成功之空輸出)
    //  鍵或元素之讀取拋錯(存取器、陷阱、已撤銷之Proxy)視為給了而無效; 各讀一次, 其後只用讀得之值(檢測之值即使用之值)
    //params, 非空陣列且元素皆為非空字串, 預設為optMethodInit全部鍵; 陣列取快照(isearr對長度1之陣列會另讀v[0], 故不用)
    let params = keys(optMethodInit)
    let paramsRaw
    let paramsSnap = null
    try {
        paramsRaw = readKey(opt, 'params')
        if (isarr(paramsRaw)) {
            paramsSnap = Array.from(paramsRaw)
        }
    }
    catch (err) {
        throw new Error(MSG_PARAMS) //讀取拋錯, 訊息固定(不含拋出之訊息)
    }
    if (paramsRaw !== undefined && paramsRaw !== null) {
        if (paramsSnap === null || paramsSnap.length === 0 || !every(paramsSnap, isestr)) {
            throw new Error(MSG_PARAMS)
        }
        params = paramsSnap
    }

    //keyIn, 非空字串, 預設'none'
    let keyIn
    try {
        keyIn = readKey(opt, 'keyIn')
    }
    catch (err) {
        throw new Error(MSG_KEY_IN)
    }
    if (keyIn === undefined || keyIn === null) {
        keyIn = 'none'
    }
    else if (!isestr(keyIn)) {
        throw new Error(MSG_KEY_IN)
    }

    //optMethodRef, 一般物件(可為空物件)
    let optMethodRef = rd('optMethodRef', {}, isobj, 'an object', 'an empty object')

    //mags, 數字陣列(可為空陣列), 元素之數字字串轉為數值
    let mags = MAGS_DEF
    let magsSnap = null
    rd('mags', null, (v) => {
        if (!isarr(v)) {
            return false
        }
        let a = Array.from(v)
        if (!every(a, (x) => isenum(x))) {
            return false
        }
        magsSnap = map(a, Number)
        return true
    }, 'an array of valid numbers', 'the built-in steps')
    if (magsSnap !== null) {
        mags = magsSnap
    }

    //threshold、thresholdAbs, 有效數字
    let threshold = Number(rd('threshold', THRESHOLD_DEF, (v) => isenum(v), 'a valid number', `${THRESHOLD_DEF}`))
    let thresholdAbs = Number(rd('thresholdAbs', THRESHOLD_ABS_DEF, (v) => isenum(v), 'a valid number', `${THRESHOLD_ABS_DEF}`))

    //nSweep, 不小於0之整數, 預設為params多於1個時2輪、否則1輪
    let nSweepDef = size(params) > 1 ? 2 : 1
    let nSweep = Number(rd('nSweep', nSweepDef, (v) => iseint(v, { min: 0 }), 'an integer >= 0', 'the number of params > 1 ? 2 : 1'))

    //funLog, 進度輸出函數(以(msg)呼叫); opt.debug為true時亦為警告之出口(以(msg, { fn, reason, key })呼叫)
    let funLog = rd('funLog', null, isfun, 'a function', 'none')
    let log = (msg) => {
        if (isfun(funLog)) {
            funLog(msg)
        }
    }

    //check, optMethodInit與optMethodRef之intervalSec(每根秒數)先行檢核, 給了而無效即拒(與calc同一檢核, 先於任何計算)
    each([optMethodInit, optMethodRef], (om) => {
        readIntervalSec(om)
    })

    //pool: 跑 calc 後彙集指定 keyOut 之全期有限值
    let pool = (rrs, keyOut) => {
        let vs = []
        each(rrs, (v) => {
            each(v.vs, (m) => {
                let x = m[keyOut]
                if (Number.isFinite(x)) {
                    vs.push(x)
                }
            })
        })
        return vs
    }

    //zshape: 自解 avg/std 轉 z-score 後取形狀特徵(十分位 + |z|<0.1 佔比)
    let zshape = (vs) => {
        let n = size(vs)
        if (n < 100) {
            return null
        }
        let avg = sum(vs) / n
        let std = Math.sqrt(sum(map(vs, (x) => (x - avg) ** 2)) / n)
        if (!(std > 0)) {
            return null
        }
        let zs = map(vs, (x) => (x - avg) / std)
        zs.sort((a, b) => a - b)
        let qs = map(range(1, 10), (i) => zs[Math.floor(n * i / 10)]) //十分位
        let pNearZero = sumBy(zs, (z) => Math.abs(z) < 0.1 ? 1 : 0) / n
        return { qs, pNearZero }
    }

    //dist: 兩形狀距離 = 十分位平均絕對差 + |z|<0.1 佔比差
    let dist = (a, b) => {
        if (!a || !b) {
            return Infinity
        }
        let dq = mean(map(a.qs, (q, i) => Math.abs(q - b.qs[i])))
        return dq + Math.abs(a.pNearZero - b.pNearZero)
    }

    //ref 側參考形狀(僅算一次)
    let refShapes = {}
    if (true) {
        let rrs = await calcFn(arrRef, keyIn, optMethodRef)
        each(ps, (p) => {
            refShapes[p.keyOutRef] = zshape(pool(rrs, p.keyOutRef))
        })
    }

    //score: 候選 optMethod 之目標函數(各 pair 距離平均), 含快取
    let nEval = 0
    let cache = new Map()
    let score = async (om) => {
        let k = JSON.stringify(map(params, (p) => om[p]))
        if (cache.has(k)) {
            return cache.get(k)
        }
        nEval++
        let s = null
        try {
            let rrs = await calcFn(arrSrc, keyIn, om)
            let ds = map(ps, (p) => dist(zshape(pool(rrs, p.keyOutSrc)), refShapes[p.keyOutRef]))
            s = mean(ds)
        }
        catch (err) {
            s = Infinity
        }
        if (!Number.isFinite(s)) {
            s = Infinity
        }
        cache.set(k, s)
        return s
    }

    //best: 搜尋起點(params 中不存在之鍵以 0 起算)
    let best = { ...optMethodInit }
    each(params, (p) => {
        if (!haskey(best, p)) {
            best[p] = 0
        }
    })

    //搜尋: 逐維座標下降, 每維三階段(粗網格跨數量級 → 倍率細化 → 微調)
    let s0 = await score(best)
    let sBest = s0
    for (let sweep = 1; sweep <= nSweep; sweep++) {
        for (let p of params) {

            //cands: 現值 + 0 + 正負粗網格
            let cands = [best[p], 0]
            each(mags, (m) => {
                cands.push(m, -m)
            })

            //粗掃
            let vBest = best[p]
            for (let v of uniq(cands)) {
                let s = await score({ ...best, [p]: v })
                if (s < sBest) {
                    sBest = s
                    vBest = v
                }
            }

            //倍率細化 + 微調(以粗掃最佳為中心)
            if (vBest !== 0) {
                for (let ratios of [[0.3, 0.5, 0.7, 1.5, 2, 3], [0.85, 0.9, 1.1, 1.2]]) {
                    let vC = vBest
                    for (let r of ratios) {
                        let v = vC * r
                        let s = await score({ ...best, [p]: v })
                        if (s < sBest) {
                            sBest = s
                            vBest = v
                        }
                    }
                }
            }

            best[p] = vBest
            log(`sweep${sweep} ${p}: ${vBest} (score ${sBest.toFixed(4)}, eval ${nEval})`)

        }
    }

    //防churn: 相對與絕對改善皆達門檻才採納
    let adopt = (s0 - sBest) / s0 > threshold && (s0 - sBest) > thresholdAbs
    let optMethod = adopt ? { ...best } : { ...optMethodInit }

    //detail: 最終 optMethod 下各 pair 形狀對照
    let detail = []
    if (true) {
        let rrs = await calcFn(arrSrc, keyIn, optMethod)
        each(ps, (p) => {
            let si = zshape(pool(rrs, p.keyOutSrc))
            let sp = refShapes[p.keyOutRef]
            detail.push({
                keyOutSrc: p.keyOutSrc,
                keyOutRef: p.keyOutRef,
                dist: dist(si, sp),
                pNearZeroSrc: si ? si.pNearZero : null,
                pNearZeroRef: sp ? sp.pNearZero : null,
            })
        })
    }

    return { adopt, optMethod, optMethodBest: { ...best }, score0: s0, scoreBest: sBest, nEval, detail }
}


export default dataCalibrate
