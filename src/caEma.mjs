import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import meanBy from 'lodash-es/meanBy.js'


let caEma = (vs, len, opt = {}) => {

    //check
    if (!isNumber(len)) {
        throw new Error(`len is not a number`)
    }

    //norm
    let norm = get(opt, 'norm', false)

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
