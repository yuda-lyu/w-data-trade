import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcAtr = (() => {

    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
    }

    let caAtr = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //plusClose: 偏移 close 為穩定分母 (cp = c + plusClose), 用於 atrRatioMod
        //  原 atrRatio = atr / close, index OHLC 之 close 可 ≈0 → ratio 爆
        //  atrRatioMod = atr / (c + plusClose), 用 diviProt 額外保護 |分母| < 0.00001 之邊界
        //  atr 本身 ≥0 不需偏移
        let plusClose = get(opt, 'plusClose', 0)

        //n
        let n = size(arr)

        //check
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //計算每根K棒的True Range(從i=1開始, 因需要前一根Close)
        let trs = new Array(n).fill(0)
        for (let i = 1; i < n; i++) {

            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let cPrev = arr[i - 1][kClose]

            //check
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(cPrev)) {
                throw new Error(`invalid cPrev[${cPrev}]`)
            }

            //TR = max(H-L, |H-Cprev|, |L-Cprev|)
            let tr1 = Math.abs(h - l)
            let tr2 = Math.abs(h - cPrev)
            let tr3 = Math.abs(l - cPrev)
            let tr = Math.max(tr1, tr2, tr3)
            trs[i] = tr

        }

        //種子ATR: 用前len根TR的SMA
        let sumTr = 0
        for (let i = 1; i <= len; i++) {
            sumTr += trs[i]
        }
        let atrPrev = sumTr / len

        //rs
        let rs = []

        //第一筆ATR(index=len)
        {
            let close = arr[len][kClose]
            let atr = atrPrev
            let atrRatio = close !== 0 ? atr / close : 0
            let atrRatioMod = diviProt(atr, close + plusClose)

            //trRank: 當前TR在過去len期中的百分位
            let currentTr = trs[len]
            let countLess = 0
            for (let j = 1; j <= len; j++) {
                if (trs[j] < currentTr) countLess++
            }
            let trRank = countLess / len

            //push
            rs.push({
                time: arr[len][kTime],
                atr,
                atrRatio,
                atrRatioMod,
                atrChange: 0, //第一筆無前值可比
                trRank,
            })
        }

        //後續ATR, 使用Wilder's smoothing: ATR = (ATR_prev * (n-1) + TR) / n
        for (let i = len + 1; i < n; i++) {

            let close = arr[i][kClose]
            let atr = (atrPrev * (len - 1) + trs[i]) / len
            let atrRatio = close !== 0 ? atr / close : 0
            let atrRatioMod = diviProt(atr, close + plusClose)
            let atrChange = atrPrev !== 0 ? (atr - atrPrev) / atrPrev : 0

            //trRank: 當前TR在過去len期中的百分位
            let currentTr = trs[i]
            let countLess = 0
            for (let j = i - len + 1; j <= i; j++) {
                if (trs[j] < currentTr) countLess++
            }
            let trRank = countLess / len

            //push
            rs.push({
                time: arr[i][kTime],
                atr,
                atrRatio,
                atrRatioMod,
                atrChange,
                trRank,
            })

            atrPrev = atr

        }
        // console.log('rs', rs)

        return rs
    }

    let caAtrs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caAtr
            let rs = caAtr(arr, len, opt)

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

    let calcAtr = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,...},
        //   ...
        // ]

        //caAtrs
        let rs = caAtrs(arr, opt)

        return rs
    }

    return calcAtr
})()


export default calcAtr
