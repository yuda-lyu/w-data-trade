import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcVwap = (() => {

    //Rolling VWAP 各 period 對應 len (4hr K 線)
    //len = rolling window 期數 (n × 4hr) — VWAP 與內部 ATR 共用
    //經典 N=80 落在 12day 附近, 對應到 7day(42) 與 15day(90) 之間, 由 DE 自行挑選最佳
    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
        '15day': 90, // 15 days = 90 * 4 hours
        '30day': 180, // 30 days = 180 * 4 hours
    }

    let caVwap = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check, 需 len+1 根 (前 len 根供 VWAP 視窗 + ATR 種子, +1 根為第一筆輸出)
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'
        let kVolumn = 'Volumn'

        //計算各根 TR (從 i=1 開始, 需要前一根 Close), 對齊 calcAtr
        let trs = new Array(n).fill(0)
        for (let i = 1; i < n; i++) {
            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let cPrev = arr[i - 1][kClose]
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(cPrev)) {
                throw new Error(`invalid cPrev[${cPrev}]`)
            }
            let tr = Math.max(Math.abs(h - l), Math.abs(h - cPrev), Math.abs(l - cPrev))
            trs[i] = tr
        }

        //計算各根 typical price × volume, 與 volume (供 rolling sum)
        let tpvs = new Array(n).fill(0)
        let vols = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let c = arr[i][kClose]
            let v = arr[i][kVolumn]
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }
            if (!isNumber(v)) {
                throw new Error(`invalid v[${v}]`)
            }
            let tp = (h + l + c) / 3
            tpvs[i] = tp * v
            vols[i] = v
        }

        //ATR 種子: 前 len 根 TR 的 SMA, 第一筆 ATR 對應 index = len (對齊 calcAtr)
        let sumTr = 0
        for (let i = 1; i <= len; i++) {
            sumTr += trs[i]
        }
        let atrPrev = sumTr / len

        //VWAP 初始 rolling sum: 累加 [0, len-1] 共 len 筆
        let sumTpv = 0
        let sumVol = 0
        for (let i = 0; i < len; i++) {
            sumTpv += tpvs[i]
            sumVol += vols[i]
        }
        //此時 sumTpv/sumVol 對應 i=len-1 之 VWAP, 但第一筆輸出對齊 i=len, 故下方需先滑動視窗

        //rs
        let rs = []

        //第一筆: i=len (與 ATR 對齊)
        {
            //視窗從 [0, len-1] 滑到 [1, len]
            sumTpv = sumTpv - tpvs[0] + tpvs[len]
            sumVol = sumVol - vols[0] + vols[len]

            let c = arr[len][kClose]
            let vwap = sumVol !== 0 ? sumTpv / sumVol : c
            let atr = atrPrev

            let vwapDist = c !== 0 ? (c - vwap) / c : 0
            let vwapDistATR = atr !== 0 ? (c - vwap) / atr : 0

            rs.push({
                time: arr[len][kTime],
                vwapDist,
                vwapDistATR,
            })
        }

        //後續: i=len+1 起, rolling VWAP + Wilder ATR 同步遞推
        for (let i = len + 1; i < n; i++) {

            //rolling VWAP 視窗滑動 [i-len+1, i]
            sumTpv = sumTpv - tpvs[i - len] + tpvs[i]
            sumVol = sumVol - vols[i - len] + vols[i]

            //Wilder ATR 遞推 (對齊 calcAtr 公式)
            let atr = (atrPrev * (len - 1) + trs[i]) / len

            let c = arr[i][kClose]
            let vwap = sumVol !== 0 ? sumTpv / sumVol : c
            let vwapDist = c !== 0 ? (c - vwap) / c : 0
            let vwapDistATR = atr !== 0 ? (c - vwap) / atr : 0

            rs.push({
                time: arr[i][kTime],
                vwapDist,
                vwapDistATR,
            })

            atrPrev = atr

        }
        // console.log('rs', rs)

        return rs
    }

    let caVwaps = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caVwap
            let rs = caVwap(arr, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcVwap = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,...},
        //   ...
        // ]

        //caVwaps
        let rs = caVwaps(arr, opt)

        return rs
    }

    return calcVwap
})()


export default calcVwap
