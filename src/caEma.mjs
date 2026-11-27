import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import meanBy from 'lodash-es/meanBy.js'
import getOptReader from 'wsemi/src/getOptReader.mjs'


/**
 * 計算指數移動平均EMA(Exponential Moving Average)序列
 *
 * 平滑係數alpha=2/(len+1)；種子ema0為輸入前len筆value之簡單算術平均，對應輸出第0筆，其time為vs[len-1].time
 * 第0筆物件僅有{time,param}(無value/diff/ratio，為既有現象)；第1筆起(對應輸入索引len起)物件為{time,value,diff,ratio,param}，diff為ema減現值，ratio為diff除以現值(現值為0時給0)
 * 輸入vs筆數不足len時回傳空陣列；len非數值時拋出例外
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-caEma.test.mjs Github}
 * @function
 * @param {Array} vs 輸入數值序列，各元素為{time,value}
 * @param {Number} len 輸入計算所用之期數(K線根數)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.norm=false] 輸入是否將param改為(EMA-現值)/現值布林值，預設false；只收true與false(不收1、0、'true'、'y'等)，非預期之輸入視為未給而改用預設，opt.debug恰為true時警告一次(固定詞彙、不含傳入之值，出口為opt.funLog或console.warn)
 * @param {Boolean} [opt.debug=false] 輸入是否於opt.norm出現非預期輸入時輸出警告布林值，須恰為true才生效，預設false
 * @param {Function} [opt.funLog] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設未給
 * @returns {Array} 回傳各筆結果陣列，第0筆為{time,param}，其後各筆為{time,value,diff,ratio,param}
 * @example
 *
 * let vs = [
 *     { time: '2020-01-01T00:00:00', value: 1 },
 *     { time: '2020-01-01T04:00:00', value: 2 },
 *     { time: '2020-01-01T08:00:00', value: 3 },
 *     { time: '2020-01-01T12:00:00', value: 4 },
 * ]
 *
 * let rs = caEma(vs, 2)
 * console.log(rs)
 * // => [
 * //   { time: '2020-01-01T04:00:00', param: 1.5 },
 * //   { time: '2020-01-01T08:00:00', value: 2.5, diff: -0.5, ratio: -0.16666666666666666, param: 2.5 },
 * //   { time: '2020-01-01T12:00:00', value: 3.5, diff: -0.5, ratio: -0.125, param: 3.5 }
 * // ]
 *
 */
let caEma = (vs, len, opt = {}) => {

    //check
    if (!isNumber(len)) {
        throw new Error(`len is not a number`)
    }

    //norm, 經getOptReader讀取(給了即檢測, 非預期之輸入視為未給而改用預設, opt.debug為true時警告); 布林只收true與false
    let rd = getOptReader('w-data-trade caEma', opt)
    let norm = rd('norm', false, (v) => typeof v === 'boolean', 'a boolean', 'false')

    //n
    let n = size(vs)

    //check
    if (n < len) {
        return []
    }

    //smoothing factor
    let alpha = 2 / (len + 1)

    //rs
    let rs = []

    //ema0
    let ema0 = meanBy(vs.slice(0, len), 'value')

    //先算出第一筆 EMA（用前 len 筆做簡單平均）
    if (true) {

        //diffEma
        let diffEma = ema0 - vs[len - 1].value //ema-現在

        //ratioDiffEma
        let ratioDiffEma = 0
        if (vs[len - 1].value !== 0) {
            ratioDiffEma = diffEma / vs[len - 1].value
        }

        //param
        let param = ema0
        if (norm) {
            param = ratioDiffEma
        }

        //r
        let r = {
            time: vs[len - 1].time,
            param,
        }

        //push
        rs.push(r)

    }

    //從第 len 筆之後開始套用 EMA 公式
    let emaPrev = ema0
    for (let i = len; i < n; i++) {

        //ema
        let ema = vs[i].value * alpha + emaPrev * (1 - alpha)

        //diffEma
        let diffEma = ema - vs[i].value //ema-現在

        //ratioDiffEma
        let ratioDiffEma = 0
        if (vs[i].value !== 0) {
            ratioDiffEma = diffEma / vs[i].value
        }

        //r
        let r = {
            time: vs[i].time,
            value: ema,
            diff: diffEma,
            ratio: ratioDiffEma,
        }

        //param
        let param = r.value
        if (norm) {
            param = r.ratio
        }

        //push
        rs.push({
            ...r,
            param,
        })

        //update
        emaPrev = ema

    }

    return rs
}


export default caEma
