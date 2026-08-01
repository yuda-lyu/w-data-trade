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
import haskey from 'wsemi/src/haskey.mjs'


//校正 calc 之 optMethod: 搜尋參數, 使來源側(src)各 keyOut 之 z-score 分布形狀對齊參考側(ref)對應 keyOut
//  本專案用例: src=溢價指數(index) OHLC, ref=價格(price) OHLC, 校正 index 系變換偏移量
//  calcFn: 指標計算函式(arr, keyIn, optMethod) => rrs(各期 { period, vs: [{ time, ...keyOuts }] })
//  arrSrc, arrRef: 來源側與參考側之 K 線陣列
//  pairs: 兩側 keyOut 對應表, 元素為 { keyOutSrc, keyOutRef } 或字串(兩側同名之縮寫); 目標函數對全部 pair 取平均
//  optMethodInit: 現行 optMethod(搜尋起點 + 防churn基準); params 中不存在之鍵以 0 起算
//  opt:
//    params: 要校正之參數名陣列, 預設 optMethodInit 全部鍵
//    keyIn: 傳入 calcFn 之 keyIn, 預設 'none'
//    optMethodRef: 參考側 optMethod, 預設 {}
//    mags: 粗掃量級階梯(正值, 內部自動含正負與 0), 預設 [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3]
//    threshold: 採納門檻(相對改善), 預設 0.15; 另須絕對改善 > thresholdAbs(預設 0.01), 未達則維持現值
//    nSweep: 逐維掃描輪數, 預設單參數 1 輪, 多參數 2 輪
//    funLog: 進度回呼(msg), 可選
//  回傳 { adopt, optMethod, optMethodBest, score0, scoreBest, nEval, detail }
//    optMethod: 依防churn判定之最終值(adopt=false 即 optMethodInit); optMethodBest: 搜尋所得最佳值(不論採納與否)
//    detail: 各 pair 於最終 optMethod 下之形狀對照 { keyOutSrc, keyOutRef, dist, pNearZeroSrc, pNearZeroRef }

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
    let ps = map(pairs, (p) => {
        if (isestr(p)) {
            return { keyOutSrc: p, keyOutRef: p }
        }
        let keyOutSrc = get(p, 'keyOutSrc')
        let keyOutRef = get(p, 'keyOutRef')
        if (!isestr(keyOutSrc)) {
            throw new Error(`invalid pair.keyOutSrc[${keyOutSrc}]`)
        }
        if (!isestr(keyOutRef)) {
            throw new Error(`invalid pair.keyOutRef[${keyOutRef}]`)
        }
        return { keyOutSrc, keyOutRef }
    })

    //opt
    let params = get(opt, 'params', keys(optMethodInit))
    let keyIn = get(opt, 'keyIn', 'none')
    let optMethodRef = get(opt, 'optMethodRef', {})
    let mags = get(opt, 'mags', [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3])
    let threshold = get(opt, 'threshold', 0.15)
    let thresholdAbs = get(opt, 'thresholdAbs', 0.01)
    let nSweep = get(opt, 'nSweep', size(params) > 1 ? 2 : 1)
    let funLog = get(opt, 'funLog', null)
    let log = (msg) => {
        if (isfun(funLog)) {
            funLog(msg)
        }
    }

    //check
    if (!isearr(params) || !every(params, isestr)) {
        throw new Error(`invalid opt.params[${params}]`)
    }
    if (!isestr(keyIn)) {
        throw new Error(`invalid opt.keyIn[${keyIn}]`)
    }

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
