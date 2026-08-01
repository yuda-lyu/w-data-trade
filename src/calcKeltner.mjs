import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcKeltner = (() => {

    //Keltner Channel 各 period 對應 (len, mult) 配對 (4hr K 線)
    //len  = EMA 與 ATR 共用之平滑期數 (n × 4hr)
    //mult = ATR 通道厚度倍數 (k)
    //設計原則: 經典 Linda Raschke (20,10,2) 對應於 1day(6,2). Keltner 經典 k=2, 區間 1.5~3
    //錨點: 1day=(6,2) 對應 Raschke 標準
    let kp = {
        '12hr': { len: 3, mult: 1.5 },
        '16hr': { len: 4, mult: 1.5 },
        '20hr': { len: 5, mult: 1.5 },
        '1day': { len: 6, mult: 2 },
        '2day': { len: 12, mult: 2 },
        '4day': { len: 24, mult: 2 },
        '7day': { len: 42, mult: 2.5 },
        '15day': { len: 90, mult: 2.5 },
        '30day': { len: 180, mult: 3 },
    }

    let caKeltner = (arr, len, mult, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }
        if (!isNumber(mult)) {
            throw new Error(`mult is not a number`)
        }

        //plusMiddle: 偏移 middle (EMA close) 為穩定 kcWidth 分母, 用於 kcWidthMod
        //  原 kcWidth = bandWidth / middle, index OHLC 之 middle 可 ≈0 或負 → ratio 爆
        //  kcWidthMod = bandWidth / (middle + plusMiddle), 用 diviProt 額外保護 |分母|<0.00001 邊界
        //  bandWidth = upper-lower ≥0 不需偏移
        //  middle 直接命名 (不沿用 plusClose) 因 middle 是 EMA(close), 跟 c 隔一層, 直接對應 middle 較清晰
        let plusMiddle = get(opt, 'plusMiddle', 0)

        //n
        let n = size(arr)

        //check, 須夠根數同時供 EMA 種子 (前 len 筆) 與 ATR 種子 (TR 從 i=1 起算共 len 筆)
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //計算各根 TR (從 i=1 開始, 需要前一根 Close), 對齊 calcAtr 風格
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

        //ATR 種子: 前 len 根 TR 的 SMA, 第一筆 ATR 對應 index = len (對齊 calcAtr)
        let sumTr = 0
        for (let i = 1; i <= len; i++) {
            sumTr += trs[i]
        }
        let atrPrev = sumTr / len

        //EMA 種子: 前 len 根 Close 的 SMA, 第一筆 EMA 對應 index = len - 1 (對齊 caEma)
        let sumClose = 0
        for (let i = 0; i < len; i++) {
            let c = arr[i][kClose]
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }
            sumClose += c
        }
        let ema0 = sumClose / len
        let alpha = 2 / (len + 1)

        //先 forward EMA 到 index = len (與 ATR 第一筆對齊)
        let cAtLen = arr[len][kClose]
        if (!isNumber(cAtLen)) {
            throw new Error(`invalid c[${cAtLen}]`)
        }
        let emaPrev = cAtLen * alpha + ema0 * (1 - alpha)

        //rs
        let rs = []

        //第一筆 Keltner: 對應 index = len (此時 EMA 與 ATR 皆已就緒)
        {
            let c = cAtLen
            let middle = emaPrev
            let upper = middle + mult * atrPrev
            let lower = middle - mult * atrPrev
            let bandWidth = upper - lower
            let kcPctB = bandWidth !== 0 ? (c - lower) / bandWidth : 0.5
            let kcWidth = middle !== 0 ? bandWidth / middle : 0
            let middlep = middle + plusMiddle
            let kcWidthMod = diviProt(bandWidth, middlep)

            rs.push({
                time: arr[len][kTime],
                kcPctB,
                kcWidth,
                kcWidthMod,
            })
        }

        //後續: EMA + ATR 遞推
        for (let i = len + 1; i < n; i++) {

            let c = arr[i][kClose]
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //EMA 遞推 (對齊 caEma 公式)
            let ema = c * alpha + emaPrev * (1 - alpha)

            //ATR 遞推 (Wilder smoothing, 對齊 calcAtr 公式)
            let atr = (atrPrev * (len - 1) + trs[i]) / len

            //Keltner 通道
            let middle = ema
            let upper = middle + mult * atr
            let lower = middle - mult * atr
            let bandWidth = upper - lower
            let kcPctB = bandWidth !== 0 ? (c - lower) / bandWidth : 0.5
            let kcWidth = middle !== 0 ? bandWidth / middle : 0
            let middlep = middle + plusMiddle
            let kcWidthMod = diviProt(bandWidth, middlep)

            rs.push({
                time: arr[i][kTime],
                kcPctB,
                kcWidth,
                kcWidthMod,
            })

            //next iter
            emaPrev = ema
            atrPrev = atr

        }
        // console.log('rs', rs)

        return rs
    }

    let caKeltners = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (cfg, period) => {

            //caKeltner
            let rs = caKeltner(arr, cfg.len, cfg.mult, opt)

            //push
            rrs.push({
                period,
                len: cfg.len,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcKeltner = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,...},
        //   ...
        // ]

        //caKeltners
        let rs = caKeltners(arr, opt)

        return rs
    }

    return calcKeltner
})()


export default calcKeltner
