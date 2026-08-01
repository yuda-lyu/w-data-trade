import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcSupertrend = (() => {

    //Supertrend 各 period 對應 (len, mult) 配對 (4hr K 線)
    //len  = ATR 平滑期數 (n × 4hr)
    //mult = ATR 通道厚度倍數 (k)
    //設計原則: period 越長 → ATR 反應越平滑 + 通道越厚, 兩者同向降翻轉敏感度
    //錨點: 1day=(6,3) 對應 Olivier Seban 原版 (10,3); 4day=(24,4) 對應 d12 grid 最佳 (20,4)
    let kp = {
        '12hr': { len: 3, mult: 2 },
        '16hr': { len: 4, mult: 2 },
        '20hr': { len: 5, mult: 2.5 },
        '1day': { len: 6, mult: 3 },
        '2day': { len: 12, mult: 3 },
        '4day': { len: 24, mult: 4 },
        '7day': { len: 42, mult: 4 },
        '15day': { len: 90, mult: 5 },
        '30day': { len: 180, mult: 5 },
    }

    let caSupertrend = (arr, len, mult, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }
        if (!isNumber(mult)) {
            throw new Error(`mult is not a number`)
        }

        //n
        let n = size(arr)

        //check
        if (n < len + 1) {
            return []
        }

        //plusClose
        let plusClose = get(opt, 'plusClose', 0)

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //計算各根 TR (從 i=1 開始, 需要前一根 Close)
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

        //種子 ATR: 前 len 根 TR 的 SMA (對齊 calcAtr 風格)
        let sumTr = 0
        for (let i = 1; i <= len; i++) {
            sumTr += trs[i]
        }
        let atrPrev = sumTr / len

        //rs
        let rs = []

        //遞推狀態
        let finalUpperPrev = null
        let finalLowerPrev = null
        let closePrev = arr[len - 1][kClose] //「前一根 Close」用於 finalBand 重置判斷
        let dirPrev = null

        for (let i = len; i < n; i++) {

            //當前根 ATR (Wilder smoothing): i=len 用種子, 之後遞推
            let atrNow
            if (i === len) {
                atrNow = atrPrev
            }
            else {
                atrNow = (atrPrev * (len - 1) + trs[i]) / len
            }

            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let c = arr[i][kClose]

            //check
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //basic 通道
            let hl2 = (h + l) / 2
            let basicUpper = hl2 + mult * atrNow
            let basicLower = hl2 - mult * atrNow

            //final upper (鎖死: 只能下移或上根穿越時重置)
            let finalUpper
            if (finalUpperPrev === null) {
                finalUpper = basicUpper
            }
            else {
                if (basicUpper < finalUpperPrev || closePrev > finalUpperPrev) {
                    finalUpper = basicUpper
                }
                else {
                    finalUpper = finalUpperPrev
                }
            }

            //final lower (鎖死: 只能上移或上根跌破時重置)
            let finalLower
            if (finalLowerPrev === null) {
                finalLower = basicLower
            }
            else {
                if (basicLower > finalLowerPrev || closePrev < finalLowerPrev) {
                    finalLower = basicLower
                }
                else {
                    finalLower = finalLowerPrev
                }
            }

            //direction: 沿續前根, 收盤穿越對側通道時翻轉
            let dir
            if (dirPrev === null) {
                //初始化: close <= finalUpper → 視為空頭起點; 否則多頭
                dir = c <= finalUpper ? -1 : 1
            }
            else {
                dir = dirPrev
                if (dirPrev === 1 && c < finalLower) {
                    dir = -1
                }
                else if (dirPrev === -1 && c > finalUpper) {
                    dir = 1
                }
            }

            //ST 線: 多頭用 finalLower (下方支撐), 空頭用 finalUpper (上方壓力)
            let line = dir === 1 ? finalLower : finalUpper

            //stDistance = (Close - line) / Close  (原版, 保留供日後對比)
            //多頭: Close > line → 正值 (buffer 大小); 空頭: Close < line → 負值
            let stDistance = c !== 0 ? (c - line) / c : 0

            //stDistanceMod = (Close+plusClose - line) / (Close+plusClose)
            //  plusClose=0 時退化成原版 (c-line)/c (price 預設用法)
            //  plusClose>0 時把 Close 偏移正方向, 對 index OHLC (close 可 ≈0 或負) 修正除法爆炸
            //  diviProt 額外保護: |分母| < 0.00001 時 floor 至 ±0.00001 (保留 sign)
            let cp = c + plusClose
            let stDistanceMod = diviProt(cp - line, cp)

            //push (內含方向(sign) + 強度(magnitude), 對齊 d05 DE 搜門檻架構)
            rs.push({
                time: arr[i][kTime],
                stDistance,
                stDistanceMod,
            })

            //next iter
            finalUpperPrev = finalUpper
            finalLowerPrev = finalLower
            closePrev = c
            dirPrev = dir
            atrPrev = atrNow

        }
        // console.log('rs', rs)

        return rs
    }

    let caSupertrends = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (cfg, period) => {

            //caSupertrend
            let rs = caSupertrend(arr, cfg.len, cfg.mult, opt)

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

    let calcSupertrend = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,...},
        //   ...
        // ]

        //caSupertrends
        let rs = caSupertrends(arr, opt)

        return rs
    }

    return calcSupertrend
})()


export default calcSupertrend
