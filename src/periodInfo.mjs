import isestr from 'wsemi/src/isestr.mjs'
import { INTERVAL_SEC_BASE, spanSecOf, readIntervalSec } from './resolvePeriods.mjs'


//RE_PCT, 門檻標籤(calcDirChange之期別)之格式: 正整數(無前導零)接pct
let RE_PCT = /^[1-9][0-9]*pct$/


/**
 * 查詢期別標籤(參數鍵名之末段)所代表之根數與時間跨度秒數
 *
 * 根數為本(opt.intervalSec)下，各calc之期別標籤 = 根數 × 每根秒數之時間跨度(見resolvePeriods)，故由標籤與每根秒數即可反推根數；跨週期時以根數對應同一線型(例：每根1day之'3day'與每根4hr之'12hr'皆為3根)
 * 根數即各calc輸出之len：多數為視窗根數，calcMacd為(12,26,9)之倍率，calcIchimoku為senkouB，calcKeltner、calcSupertrend為len
 * period為'none'(calcOrig之期別)時回傳根數0、秒數0
 * period為`${N}pct`(N為正整數、無前導零，如'4pct'、'10pct'；calcDirChange內建門檻表之標籤，N為門檻百分比，非時間跨度)時亦回傳根數0、秒數0(同'none'，無根數視窗，與其len相同，且不隨opt.intervalSec改變；opt.intervalSec給了而無效時仍throw)；'0pct'、'01pct'、'4.5pct'、'pct'、'4PCT'、'-4pct'等其餘寫法不收，throw
 * 只收期別標籤(參數鍵名以'_'分隔之最後一段)，不收完整鍵名
 * opt.intervalSec未給時視為每根4hr：每根1day之標籤須給opt.intervalSec為86400才得正確根數(例：'3day'未給時得18根，給86400時得3根)
 * 只適用於各calc之內建週期表所產生之標籤；不適用於自訂週期表opt.kp(自訂週期表之標籤由呼叫端自負其義，原樣採用，不保證等於根數×每根時長)所產生之標籤
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-intervalSec.test.mjs Github}
 * @function
 * @param {String} period 輸入期別標籤字串，為'none'、`${N}pct`(正整數N、無前導零，如'4pct')或標準標籤(如'12hr'、'3day'、'90m'，規則見spanLabelOf)且其秒數須為每根秒數之整數倍，無效時throw
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.intervalSec=14400] 輸入每根K線之秒數，60之正整數倍且至多31536000(數值或數字字串)，預設14400(4hr)，無效時throw
 * @returns {Object} 回傳{period,bars,spanSec}，bars為根數，spanSec為時間跨度秒數(= bars × 每根秒數)
 * @example
 *
 * console.log(periodInfo('3day', { intervalSec: 86400 }))
 * // => { period: '3day', bars: 3, spanSec: 259200 }
 *
 * console.log(periodInfo('12hr'))
 * // => { period: '12hr', bars: 3, spanSec: 43200 }
 *
 * //未給intervalSec時視為每根4hr, 每根1day之標籤須給intervalSec: 86400
 * console.log(periodInfo('3day'))
 * // => { period: '3day', bars: 18, spanSec: 259200 }
 *
 * console.log(periodInfo('none'))
 * // => { period: 'none', bars: 0, spanSec: 0 }
 *
 * //calcDirChange之門檻標籤(門檻百分比, 無根數視窗), 與intervalSec無關
 * console.log(periodInfo('4pct', { intervalSec: 86400 }))
 * // => { period: '4pct', bars: 0, spanSec: 0 }
 *
 */
let periodInfo = (period, opt = {}) => {

    //check
    if (!isestr(period)) {
        throw new Error(`invalid period: must be 'none' or a period label whose time span is a multiple of opt.intervalSec`)
    }

    //intervalSec, 給了而無效即拋(K3之例外); 未給視為每根4hr
    let intervalSec = readIntervalSec(opt)
    if (intervalSec === null) {
        intervalSec = INTERVAL_SEC_BASE
    }

    //none, calcOrig之期別
    if (period === 'none') {
        return { period, bars: 0, spanSec: 0 }
    }

    //pct, calcDirChange之門檻標籤(門檻百分比, 無根數視窗, 同none)
    if (RE_PCT.test(period)) {
        return { period, bars: 0, spanSec: 0 }
    }

    //sec
    let sec = spanSecOf(period)
    if (sec === null || sec % intervalSec !== 0) {
        throw new Error(`invalid period: must be 'none' or a period label whose time span is a multiple of opt.intervalSec`)
    }

    return {
        period,
        bars: sec / intervalSec,
        spanSec: sec,
    }
}


export default periodInfo
