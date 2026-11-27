import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import isenum from 'wsemi/src/isenum.mjs'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import diviProt from './diviProt.mjs'
import resolvePeriods from './resolvePeriods.mjs'


/**
 * 計算各週期之Supertrend(Olivier Seban ATR通道趨勢指標)
 *
 * 各週期kp值為{len,mult}物件，len為ATR平滑期數(根數，任何每根時長下不變)，mult為ATR通道厚度倍數；資料筆數n小於len+1時，該期vs為空陣列
 * TR(真實區間)=max(|High-Low|,|High-前一根Close|,|Low-前一根Close|)，ATR種子為第1至len根TR之算術平均，其後以Wilder平滑遞推(atr=(atr*(len-1)+TR)/len)
 * basicUpper=(High+Low)/2+mult*ATR，basicLower=(High+Low)/2-mult*ATR
 * finalUpper僅在basicUpper較前值小或前一根Close高於前值時更新為basicUpper，否則鎖死沿用前值；finalLower僅在basicLower較前值大或前一根Close低於前值時更新為basicLower，否則鎖死沿用前值
 * 方向dir沿續前一根，多頭且Close跌破finalLower時翻空，空頭且Close突破finalUpper時翻多；首根依Close是否小於等於finalUpper判定初始方向
 * ST線line：多頭取finalLower，空頭取finalUpper
 * stDistance=(Close-line)/Close，Close=0時給0
 * stDistanceMod=diviProt(Close+opt.plusClose-line, Close+opt.plusClose)，opt.plusClose=0時退化為stDistance；diviProt對分母絕對值小於0.00001時會鎖定為±0.00001(保留正負號)以避免除以0爆炸
 * 各期第1筆對應輸入之第len根，其後逐根對齊至最後一根
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcSupertrend.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time、High、Low、Close等欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，目前未實際使用(內部固定採用High、Low、Close)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.intervalSec=14400] 輸入每根K線之秒數，60之正整數倍且至多31536000(數值或數字字串)，各期根數不變(根數為本)，期別標籤為根數×每根秒數之時間跨度(例：每根1day時3根之期為'3day')，預設14400(每根4hr，標籤與根數皆同內建表)，無效時reject
 * @param {Object} [opt.kp] 輸入直接採用之週期表物件，鍵為週期標籤，值為正整數根數或參數物件，給予時不換算，預設採內建週期表，非預期之輸入視為未給
 * @param {Boolean} [opt.debug=false] 輸入是否於opt.kp、opt.plusClose出現非預期輸入(視為未給、改用預設)時輸出警告布林值，須恰為true才生效，警告為固定詞彙、不含傳入之值，同一個鍵每個行程只警告一次，預設false
 * @param {Function} [opt.funLog] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設未給
 * @param {Number|String} [opt.plusClose=0] 輸入stDistanceMod計算時對Close之偏移量，用以避免Close接近0時除法爆炸，須為有效數字(有限數值或數字字串，數字字串轉為數值使用)，預設0，非預期之輸入(含NaN、Infinity、非數字字串、布林、物件)視為未給而改用預設
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,stDistance,stDistanceMod}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Open: 10, High: 10, Low: 10, Close: 10 },
 *     { time: '2020-01-01T04:00:00', Open: 10, High: 12, Low: 10, Close: 12 },
 *     { time: '2020-01-01T08:00:00', Open: 12, High: 12, Low: 11, Close: 11 },
 *     { time: '2020-01-01T12:00:00', Open: 11, High: 13, Low: 11, Close: 13 },
 * ]
 *
 * calcSupertrend(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   period: '12hr',
 *         //   len: 3,
 *         //   vs: [ { time: '2020-01-01T12:00:00', stDistance: -0.17948717948717954, stDistanceMod: -0.17948717948717954 } ]
 *         // }
 *     })
 *
 */
let calcSupertrend = (() => {

    //Supertrend 各 period 對應 (len, mult) 配對 (根數; 標籤以每根4hr寫定)
    //len  = ATR 平滑期數 (n 根; 每根4hr時為 n × 4hr)
    //mult = ATR 通道厚度倍數 (k)
    //設計原則: period 越長 → ATR 反應越平滑 + 通道越厚, 兩者同向降翻轉敏感度
    //錨點: 1day=(6,3) 對應 Olivier Seban 原版 (10,3); 4day=(24,4) 對應 d12 grid 最佳 (20,4)
    let KP = { //內建週期表(值為根數; 標籤以每根4hr寫定: '12hr'=3根、'1day'=6根), 實際週期表由resolvePeriods依opt.intervalSec(根數不變、標籤換算)或opt.kp決定
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

    //plusClose, 由caSupertrends經getOptReader讀取一次(見其處)
    let caSupertrend = (arr, len, mult, plusClose) => {

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

        //kp, 週期表(resolvePeriods: opt.intervalSec根數不變、標籤依根數×每根時長換算, 未給時同內建表; opt.kp直接採用)
        let kp = resolvePeriods(KP, opt)

        //plusClose, opt各鍵經getOptReader讀取一次(給了即檢測, 非預期之輸入視為未給而改用預設, opt.debug為true時警告); 檢測通過之數字字串轉為數值後使用
        let rd = getOptReader('w-data-trade calcSupertrend', opt)
        let plusClose = Number(rd('plusClose', 0, (v) => isenum(v), 'a valid number', '0'))

        //rrs
        let rrs = []
        each(kp, (cfg, period) => {

            //caSupertrend
            let rs = caSupertrend(arr, cfg.len, cfg.mult, plusClose)

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
